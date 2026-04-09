import type { AddressSpace, CppType, CppValue, MemoryCell, MemoryRegion } from './types'
import { MEMORY_SIZE, NULL_ADDRESS, StackOverflowError } from './types'

function defaultValue(type: CppType): CppValue {
  if (typeof type === 'string') {
    switch (type) {
      case 'int':
      case 'float':
      case 'double':
      case 'char':
      case 'void':
        return 0
      case 'bool':
        return false
    }
  }
  switch (type.type) {
    case 'pointer':
      return { type: 'pointer', address: NULL_ADDRESS }
    case 'array':
      return { type: 'array', base: 0, length: 0 }
    case 'struct':
      return { type: 'struct', name: type.name, base: 0 }
  }
}

export interface MemoryManager {
  space: AddressSpace
  alloc: (type: CppType, value: CppValue, region: MemoryRegion) => number
  allocStruct: (
    name: string,
    fieldDefs: Record<string, CppType>,
    region: MemoryRegion,
  ) => number
  allocArray: (
    elementType: CppType,
    size: number,
    region: MemoryRegion,
  ) => number
  read: (address: number) => MemoryCell
  write: (address: number, value: CppValue) => void
  free: (address: number) => void
  readField: (
    structBase: number,
    fieldName: string,
    fieldDefs: Record<string, CppType>,
  ) => [CppType, number]
  reset: () => void
}

function makeNullCell(): MemoryCell {
  return {
    address: NULL_ADDRESS,
    type: 'int',
    value: 0,
    region: 'global',
    dead: true,
  }
}

export function createAddressSpace(): MemoryManager {
  const space: AddressSpace = {
    cells: new Map(),
    stackTop: 1,
    heapBottom: MEMORY_SIZE - 1,
  }

  // Install NULL cell at address 0
  space.cells.set(NULL_ADDRESS, makeNullCell())

  function checkCollision(stackNeed: number, heapNeed: number) {
    // stackTop is the next free stack address (grows up).
    // heapBottom is the next free heap address (grows down).
    // Available space = heapBottom - stackTop + 1. Collision when need > available.
    const available = space.heapBottom - space.stackTop + 1
    if (stackNeed + heapNeed > available)
      throw new StackOverflowError(`Out of memory: stack (${space.stackTop}) collided with heap (${space.heapBottom})`)
  }

  /** Allocate N contiguous addresses from the stack (growing up) or heap (growing down). */
  function allocRegion(count: number, region: MemoryRegion): number {
    if (region === 'heap') {
      checkCollision(0, count)
      const base = space.heapBottom
      space.heapBottom -= count
      return base - count + 1 // lowest address of the block
    }
    else {
      // stack or global — grow upward
      checkCollision(count, 0)
      const base = space.stackTop
      space.stackTop += count
      return base
    }
  }

  function alloc(type: CppType, value: CppValue, region: MemoryRegion): number {
    const address = allocRegion(1, region)
    space.cells.set(address, { address, type, value, region, dead: false })
    return address
  }

  function allocStruct(
    name: string,
    fieldDefs: Record<string, CppType>,
    region: MemoryRegion,
  ): number {
    const fields = Object.entries(fieldDefs)
    const totalSize = 1 + fields.length // header + fields
    const base = allocRegion(totalSize, region)

    // Header cell
    space.cells.set(base, {
      address: base,
      type: { type: 'struct', name },
      value: { type: 'struct', name, base },
      region,
      dead: false,
    })
    // Field cells at base+1, base+2, ...
    for (let i = 0; i < fields.length; i++) {
      const [, fieldType] = fields[i]
      const fieldAddress = base + 1 + i
      space.cells.set(fieldAddress, {
        address: fieldAddress,
        type: fieldType,
        value: defaultValue(fieldType),
        region,
        dead: false,
      })
    }
    return base
  }

  function allocArray(
    elementType: CppType,
    size: number,
    region: MemoryRegion,
  ): number {
    const totalSize = 1 + size // header + elements
    const base = allocRegion(totalSize, region)

    // Header cell
    space.cells.set(base, {
      address: base,
      type: { type: 'array', of: elementType, size },
      value: { type: 'array', base, length: size },
      region,
      dead: false,
    })
    // Element cells at base+1 through base+size
    for (let i = 0; i < size; i++) {
      const elemAddress = base + 1 + i
      space.cells.set(elemAddress, {
        address: elemAddress,
        type: elementType,
        value: defaultValue(elementType),
        region,
        dead: false,
      })
    }
    return base
  }

  function read(address: number): MemoryCell {
    const cell = space.cells.get(address)
    if (!cell)
      throw new Error(`Invalid address: ${address}`)
    return cell
  }

  function write(address: number, value: CppValue): void {
    const cell = space.cells.get(address)
    if (!cell)
      throw new Error(`Invalid address: ${address}`)
    cell.value = value
  }

  function free(address: number): void {
    const cell = space.cells.get(address)
    if (!cell)
      throw new Error(`Invalid address: ${address}`)
    cell.dead = true
  }

  function readField(
    structBase: number,
    fieldName: string,
    fieldDefs: Record<string, CppType>,
  ): [CppType, number] {
    const fields = Object.keys(fieldDefs)
    const index = fields.indexOf(fieldName)
    if (index === -1)
      throw new Error(`Unknown field: ${fieldName}`)
    const fieldAddress = structBase + 1 + index
    return [fieldDefs[fieldName], fieldAddress]
  }

  function reset(): void {
    space.cells.clear()
    space.stackTop = 1
    space.heapBottom = MEMORY_SIZE - 1
    space.cells.set(NULL_ADDRESS, makeNullCell())
  }

  return { space, alloc, allocStruct, allocArray, read, write, free, readField, reset }
}
