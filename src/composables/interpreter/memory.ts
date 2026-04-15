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
  findAllocation: (address: number) => Allocation | undefined
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
    if (init !== undefined && typeof type === 'string') {
      writeScalarImpl(base, type, init as number | boolean)
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

  function allocArray(elementType: CppType, length: number, region: MemoryRegion): number {
    const elemSize = sizeOf(elementType, resolveStruct)
    const elemAlign = alignOf(elementType, resolveStruct)
    const stride = alignUp(elemSize, elemAlign)
    const size = stride * length
    const base = reserve(size, elemAlign, region)
    // Build array layout inline (small).
    let element: LayoutNode
    if (typeof elementType === 'string')
      element = { kind: 'scalar', type: elementType, size: elemSize }
    else if (elementType.type === 'pointer')
      element = { kind: 'scalar', type: elementType, size: 4 }
    else if (elementType.type === 'struct')
      element = resolveStruct(elementType.name)
    else throw new Error('Arrays of arrays not supported (use multi-dim via nested structs)')
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
    const a = allocations.get(structBase)
    if (!a || a.layout.kind !== 'struct')
      throw new Error(`fieldAddress: no struct at ${structBase}`)
    const field = a.layout.fields.find(f => f.name === fieldName)
    if (!field)
      throw new Error(`Unknown field: ${fieldName}`)
    return { type: fieldNodeToType(field.node), address: structBase + field.offset }
  }

  function elementAddress(arrayBase: number, index: number): { type: CppType, address: number } {
    const a = allocations.get(arrayBase)
    if (!a || a.layout.kind !== 'array')
      throw new Error(`elementAddress: no array at ${arrayBase}`)
    if (index < 0 || index >= a.layout.length)
      throw new Error(`Array index out of bounds: ${index}`)
    return {
      type: fieldNodeToType(a.layout.element),
      address: arrayBase + index * a.layout.stride,
    }
  }

  function fieldNodeToType(n: LayoutNode): CppType {
    if (n.kind === 'scalar')
      return n.type
    if (n.kind === 'array')
      return { type: 'array', of: fieldNodeToType(n.element), size: n.length }
    return { type: 'struct', name: n.structName }
  }

  function findAllocation(address: number): Allocation | undefined {
    for (const a of allocations.values()) {
      if (address >= a.base && address < a.base + a.size)
        return a
    }
    return undefined
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
    findAllocation,
    reset,
  }
}
