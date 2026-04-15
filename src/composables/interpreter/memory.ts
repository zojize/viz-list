import type { LayoutNode } from './layout'
import type { AddressSpace, Allocation, CppPrimitiveType, CppType, CppValue, MemoryRegion, PointerType } from './types'
import { alignOf, alignUp, sizeOf } from './layout'
import { MEMORY_SIZE, NULL_ADDRESS, NullPointerError, StackOverflowError, UseAfterFreeError } from './types'

export interface MemoryManager {
  space: AddressSpace
  registerStructLayout: (name: string, layout: LayoutNode) => void
  alloc: (type: CppType, region: MemoryRegion, init?: CppValue) => number
  allocStruct: (name: string, region: MemoryRegion) => number
  allocArray: (elementType: CppType, length: number, region: MemoryRegion) => number
  free: (address: number) => void
  readScalar: (address: number, type: CppPrimitiveType | PointerType) => number | boolean
  writeScalar: (address: number, type: CppPrimitiveType | PointerType, value: number | boolean) => void
  fieldAddress: (structBase: number, fieldName: string) => { type: CppType, address: number }
  elementAddress: (arrayBase: number, index: number) => { type: CppType, address: number }
  /**
   * Like elementAddress but uses the provided array CppType for stride/element info
   *  instead of looking up the allocation. Use for multi-dimensional arrays where the
   *  inner array shares the same base address as the outer.
   */
  elementAddressTyped: (arrayBase: number, index: number, arrayType: { type: 'array', of: CppType, size: number }) => { type: CppType, address: number }
  findAllocation: (address: number) => Allocation | undefined
  describeByte: (address: number) => {
    allocation: Allocation
    path: (string | number)[]
    leafType: CppType
    isPadding: boolean
  } | undefined
  reset: () => void
}

export function createAddressSpace(): MemoryManager {
  const buffer = new Uint8Array(MEMORY_SIZE)
  const view = new DataView(buffer.buffer)
  const allocations = new Map<number, Allocation>()
  const structLayoutCache = new Map<string, LayoutNode>()
  const space: AddressSpace = {
    buffer,
    view,
    allocations,
    stackTop: 1,
    heapBottom: MEMORY_SIZE,
    version: 0,
  }

  // NULL marker — single byte at address 0, permanently dead.
  allocations.set(NULL_ADDRESS, {
    base: 0,
    size: 1,
    region: 'global',
    dead: true,
    layout: { kind: 'scalar', type: 'int', size: 1 },
  })

  function bumpVersion() {
    space.version++
  }

  function resolveStruct(name: string): LayoutNode {
    const l = structLayoutCache.get(name)
    if (!l)
      throw new Error(`Unknown struct: ${name}`)
    return l
  }

  function checkCollision(needed: number, region: MemoryRegion) {
    const available = space.heapBottom - space.stackTop
    if (needed > available)
      throw new StackOverflowError(`Out of memory (${region}): need ${needed}, have ${available}`)
  }

  function reserveStack(size: number, align: number): number {
    space.stackTop = alignUp(space.stackTop, align)
    checkCollision(size, 'stack')
    const base = space.stackTop
    space.stackTop += size
    return base
  }

  function reserveHeap(size: number, align: number): number {
    const unaligned = space.heapBottom - size
    const base = unaligned & ~(align - 1)
    if (base < space.stackTop)
      throw new StackOverflowError(`Out of memory (heap): aligned base ${base} below stackTop ${space.stackTop}`)
    space.heapBottom = base
    return base
  }

  function reserve(size: number, align: number, region: MemoryRegion): number {
    return region === 'heap'
      ? reserveHeap(size, align)
      : reserveStack(size, align)
  }

  function registerStructLayout(name: string, layout: LayoutNode) {
    structLayoutCache.set(name, layout)
  }

  function alloc(type: CppType, region: MemoryRegion, init?: CppValue): number {
    const size = sizeOf(type, resolveStruct)
    const align = alignOf(type, resolveStruct)
    const base = reserve(size, align, region)
    let layout: LayoutNode
    if (typeof type === 'string') {
      layout = { kind: 'scalar', type, size }
    }
    else if (type.type === 'pointer') {
      layout = { kind: 'scalar', type, size }
    }
    else if (type.type === 'array') {
      throw new Error('Use allocArray for arrays')
    }
    else {
      layout = resolveStruct(type.name)
    }
    allocations.set(base, { base, size, region, dead: false, layout })
    if (init !== undefined) {
      if (typeof type === 'string') {
        writeScalarImpl(base, type, init as number | boolean)
      }
      else if (type.type === 'pointer') {
        const addr = typeof init === 'object' && init !== null && 'address' in init
          ? (init as { address: number }).address
          : init as number
        writeScalarImpl(base, type, addr)
      }
    }
    bumpVersion()
    return base
  }

  function allocStruct(name: string, region: MemoryRegion): number {
    const layout = resolveStruct(name)
    const base = reserve(layout.size, alignOfLayout(layout), region)
    allocations.set(base, { base, size: layout.size, region, dead: false, layout })
    bumpVersion()
    return base
  }

  /** Build an array LayoutNode without allocating memory (used for nested arrays). */
  function buildArrayLayout(elementType: CppType, length: number): Extract<LayoutNode, { kind: 'array' }> {
    let element: LayoutNode
    if (typeof elementType === 'string')
      element = { kind: 'scalar', type: elementType, size: sizeOf(elementType) }
    else if (elementType.type === 'pointer')
      element = { kind: 'scalar', type: elementType, size: 4 }
    else if (elementType.type === 'struct')
      element = resolveStruct(elementType.name)
    else if (elementType.type === 'array')
      element = buildArrayLayout(elementType.of, elementType.size)
    else
      throw new Error(`buildArrayLayout: unsupported element type ${JSON.stringify(elementType)}`)
    const elemAlign = alignOf(elementType, resolveStruct)
    const stride = alignUp(element.size, elemAlign)
    return { kind: 'array', element, length, stride, size: stride * length }
  }

  function allocArray(elementType: CppType, length: number, region: MemoryRegion): number {
    const elemSize = sizeOf(elementType, resolveStruct)
    const elemAlign = alignOf(elementType, resolveStruct)
    const stride = alignUp(elemSize, elemAlign)
    const size = stride * length
    const base = reserve(size, elemAlign, region)
    // Build array layout inline (small).
    let element: LayoutNode
    if (typeof elementType === 'string') {
      element = { kind: 'scalar', type: elementType, size: elemSize }
    }
    else if (elementType.type === 'pointer') {
      element = { kind: 'scalar', type: elementType, size: 4 }
    }
    else if (elementType.type === 'struct') {
      element = resolveStruct(elementType.name)
    }
    else if (elementType.type === 'array') {
      // Multi-dimensional array: recursively build inner layout without allocating.
      element = buildArrayLayout(elementType.of, elementType.size)
    }
    else {
      throw new Error(`allocArray: unsupported element type ${JSON.stringify(elementType)}`)
    }
    const layout: LayoutNode = { kind: 'array', element, length, stride, size }
    allocations.set(base, { base, size, region, dead: false, layout })
    bumpVersion()
    return base
  }

  function free(address: number) {
    const a = allocations.get(address)
    if (!a)
      throw new Error(`free: no allocation at ${address}`)
    a.dead = true
    bumpVersion()
  }

  function readScalar(address: number, type: CppPrimitiveType | PointerType): number | boolean {
    if (address === NULL_ADDRESS)
      throw new NullPointerError()
    if (address < 0 || address + sizeOfScalar(type) > MEMORY_SIZE)
      throw new Error(`Out of bounds read at ${address}`)
    const alloc = findAllocation(address)
    if (!alloc || alloc.dead)
      throw new UseAfterFreeError(address)
    return readScalarImpl(address, type)
  }

  function writeScalar(address: number, type: CppPrimitiveType | PointerType, value: number | boolean) {
    if (address === NULL_ADDRESS)
      throw new NullPointerError()
    if (address < 0 || address + sizeOfScalar(type) > MEMORY_SIZE)
      throw new Error(`Out of bounds write at ${address}`)
    const alloc = findAllocation(address)
    if (!alloc || alloc.dead)
      throw new UseAfterFreeError(address)
    writeScalarImpl(address, type, value)
    bumpVersion()
  }

  function readScalarImpl(address: number, type: CppPrimitiveType | PointerType): number | boolean {
    if (typeof type !== 'string')
      return view.getInt32(address, true) // pointer
    switch (type) {
      case 'char': return view.getInt8(address)
      case 'bool': return view.getUint8(address) !== 0
      case 'int': return view.getInt32(address, true)
      case 'float': return view.getFloat32(address, true)
      case 'double': return view.getFloat64(address, true)
      case 'void': return 0
    }
  }

  function writeScalarImpl(address: number, type: CppPrimitiveType | PointerType, value: number | boolean) {
    if (typeof type !== 'string') {
      view.setInt32(address, value as number, true)
      return
    }
    switch (type) {
      case 'char':
        view.setInt8(address, value as number)
        break
      case 'bool':
        view.setUint8(address, value ? 1 : 0)
        break
      case 'int':
        view.setInt32(address, value as number, true)
        break
      case 'float':
        view.setFloat32(address, value as number, true)
        break
      case 'double':
        view.setFloat64(address, value as number, true)
        break
      case 'void':
        break
    }
  }

  function sizeOfScalar(type: CppPrimitiveType | PointerType): number {
    if (typeof type !== 'string')
      return 4
    return sizeOf(type)
  }

  function alignOfLayout(l: LayoutNode): number {
    if (l.kind === 'scalar') {
      if (typeof l.type === 'string') {
        switch (l.type) {
          case 'double': return 8
          case 'int': case 'float': return 4
          default: return 1
        }
      }
      return 4
    }
    if (l.kind === 'array')
      return alignOfLayout(l.element)
    let a = 1
    for (const f of l.fields) {
      const fa = alignOfLayout(f.node)
      if (fa > a)
        a = fa
    }
    return a
  }

  function fieldAddress(structBase: number, fieldName: string): { type: CppType, address: number } {
    // Fast path: structBase is the base of a top-level struct allocation.
    const direct = allocations.get(structBase)
    if (direct && direct.layout.kind === 'struct') {
      const field = direct.layout.fields.find(f => f.name === fieldName)
      if (!field)
        throw new Error(`Unknown field: ${fieldName}`)
      return { type: fieldNodeToType(field.node), address: structBase + field.offset }
    }

    // Slow path: structBase is an inline struct field within a larger allocation.
    const owner = findAllocation(structBase)
    if (!owner)
      throw new Error(`fieldAddress: no struct at ${structBase}`)
    const offset = structBase - owner.base
    const structNode = findStructNodeAtOffset(owner.layout, offset)
    if (!structNode)
      throw new Error(`fieldAddress: no struct at offset ${offset} in allocation at ${owner.base}`)
    const field = structNode.fields.find(f => f.name === fieldName)
    if (!field)
      throw new Error(`Unknown field: ${fieldName}`)
    return { type: fieldNodeToType(field.node), address: structBase + field.offset }
  }

  function findStructNodeAtOffset(
    layout: LayoutNode,
    offset: number,
  ): Extract<LayoutNode, { kind: 'struct' }> | null {
    if (layout.kind === 'struct' && offset === 0)
      return layout
    if (layout.kind === 'struct') {
      for (const f of layout.fields) {
        if (offset === f.offset && f.node.kind === 'struct')
          return f.node
        if (offset >= f.offset && offset < f.offset + f.node.size)
          return findStructNodeAtOffset(f.node, offset - f.offset)
      }
    }
    if (layout.kind === 'array') {
      // Walk into the element that contains `offset`, e.g. for struct Pt arr[3],
      // offset 8 (= arr[1]) falls into element index 1 at intra-element offset 0.
      const elemIdx = Math.floor(offset / layout.stride)
      const intoElem = offset - elemIdx * layout.stride
      if (elemIdx >= 0 && elemIdx < layout.length)
        return findStructNodeAtOffset(layout.element, intoElem)
    }
    return null
  }

  function elementAddress(arrayBase: number, index: number): { type: CppType, address: number } {
    // Find the allocation that owns this address.
    const owner = findAllocation(arrayBase)
    if (!owner)
      throw new Error(`elementAddress: no array at ${arrayBase}`)

    // Navigate the layout to find the array node that starts at arrayBase.
    const offset = arrayBase - owner.base
    const arrNode = findArrayNodeAtOffset(owner.layout, offset)
    if (!arrNode)
      throw new Error(`elementAddress: no array at offset ${offset} in allocation at ${owner.base}`)
    if (index < 0 || index >= arrNode.length)
      throw new Error(`Array index out of bounds: ${index}`)
    return {
      type: fieldNodeToType(arrNode.element),
      address: arrayBase + index * arrNode.stride,
    }
  }

  /**
   * Walk `layout` to find the innermost array node whose base sits at `offset`
   * bytes from the allocation base.
   *
   * For a plain array at offset 0 → returns that array node (index into it).
   * For a 2D array `int a[3][3]` at offset 0 → returns the outer node; for
   * row-1 at offset 12 → returns the inner-array node for that row.
   * For a struct field that is an array → returns the field's array node.
   */
  function findArrayNodeAtOffset(
    layout: LayoutNode,
    offset: number,
  ): Extract<LayoutNode, { kind: 'array' }> | null {
    if (layout.kind === 'array') {
      if (offset === 0)
        return layout
      // offset falls inside an element
      const elemIdx = Math.floor(offset / layout.stride)
      const intoElem = offset - elemIdx * layout.stride
      if (intoElem === 0 && layout.element.kind === 'array')
        return layout.element
      if (layout.element.kind === 'array' || layout.element.kind === 'struct')
        return findArrayNodeAtOffset(layout.element, intoElem)
      return null
    }
    if (layout.kind === 'struct') {
      for (const f of layout.fields) {
        if (offset === f.offset && f.node.kind === 'array')
          return f.node
        if (offset >= f.offset && offset < f.offset + f.node.size)
          return findArrayNodeAtOffset(f.node, offset - f.offset)
      }
    }
    return null
  }

  function fieldNodeToType(n: LayoutNode): CppType {
    if (n.kind === 'scalar')
      return n.type
    if (n.kind === 'array')
      return { type: 'array', of: fieldNodeToType(n.element), size: n.length }
    return { type: 'struct', name: n.structName }
  }

  function describeByte(address: number) {
    const alloc = findAllocation(address)
    if (!alloc)
      return undefined
    const offset = address - alloc.base
    const path: (string | number)[] = []
    const walk = (node: LayoutNode, nodeOffset: number): {
      leafType: CppType
      isPadding: boolean
    } => {
      const relative = offset - nodeOffset
      if (node.kind === 'scalar') {
        if (relative >= node.size)
          return { leafType: 'char', isPadding: true }
        return { leafType: node.type, isPadding: false }
      }
      if (node.kind === 'array') {
        const idx = Math.floor(relative / node.stride)
        const intoElem = relative - idx * node.stride
        if (intoElem >= node.element.size) {
          // Stride padding between elements (only possible for weirdly-sized structs).
          return { leafType: 'char', isPadding: true }
        }
        path.push(idx)
        return walk(node.element, nodeOffset + idx * node.stride)
      }
      // struct
      for (const f of node.fields) {
        const end = f.offset + f.node.size
        if (relative < f.offset)
          return { leafType: 'char', isPadding: true }
        if (relative < end) {
          path.push(f.name)
          return walk(f.node, nodeOffset + f.offset)
        }
      }
      // beyond last field = tail padding
      return { leafType: 'char', isPadding: true }
    }
    const { leafType, isPadding } = walk(alloc.layout, 0)
    return { allocation: alloc, path, leafType, isPadding }
  }

  function findAllocation(address: number): Allocation | undefined {
    for (const a of allocations.values()) {
      if (address >= a.base && address < a.base + a.size)
        return a
    }
    return undefined
  }

  function elementAddressTyped(
    arrayBase: number,
    index: number,
    arrayType: { type: 'array', of: CppType, size: number },
  ): { type: CppType, address: number } {
    const elemSize = sizeOf(arrayType.of, resolveStruct)
    const elemAlign = alignOf(arrayType.of, resolveStruct)
    const stride = alignUp(elemSize, elemAlign)
    if (index < 0 || index >= arrayType.size)
      throw new Error(`Array index out of bounds: ${index}`)
    return {
      type: arrayType.of,
      address: arrayBase + index * stride,
    }
  }

  function reset() {
    buffer.fill(0)
    allocations.clear()
    structLayoutCache.clear()
    space.stackTop = 1
    space.heapBottom = MEMORY_SIZE
    space.version = 0
    allocations.set(NULL_ADDRESS, {
      base: 0,
      size: 1,
      region: 'global',
      dead: true,
      layout: { kind: 'scalar', type: 'int', size: 1 },
    })
  }

  return {
    space,
    registerStructLayout,
    alloc,
    allocStruct,
    allocArray,
    free,
    readScalar,
    writeScalar,
    fieldAddress,
    elementAddress,
    elementAddressTyped,
    findAllocation,
    describeByte,
    reset,
  }
}
