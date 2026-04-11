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
  structFieldOffset: (fieldName: string, fieldDefs: Record<string, CppType>) => number
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

/** Compute the number of cells a field type occupies (inline arrays expand) */
function fieldCellCount(type: CppType): number {
  if (typeof type === 'object' && type.type === 'array')
    return 1 + type.size // header + elements
  return 1
}

/** Compute the cell offset of fieldName within a struct (accounting for inline arrays) */
export function structFieldOffset(fieldName: string, fieldDefs: Record<string, CppType>): number {
  let offset = 0
  for (const [name, type] of Object.entries(fieldDefs)) {
    if (name === fieldName)
      return offset
    offset += fieldCellCount(type)
  }
  return -1
}

/** Compute the total number of cells a struct occupies (header + all fields) */
export function structTotalSize(fieldDefs: Record<string, CppType>): number {
  let size = 1 // header
  for (const type of Object.values(fieldDefs))
    size += fieldCellCount(type)
  return size
}

export function createAddressSpace(): MemoryManager {
  const space: AddressSpace = {
    cells: new Map(),
    stackTop: 1,
    version: 0,
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
    let totalSize = 1 // header
    for (const [, type] of fields)
      totalSize += fieldCellCount(type)
    const base = allocRegion(totalSize, region)

    // Header cell
    space.cells.set(base, {
      address: base,
      type: { type: 'struct', name },
      value: { type: 'struct', name, base },
      region,
      dead: false,
    })

    // Field cells with computed offsets (inline arrays are contiguous)
    let offset = 1
    for (const [, fieldType] of fields) {
      if (typeof fieldType === 'object' && fieldType.type === 'array') {
        // Inline array: header at base+offset, elements at base+offset+1..
        const arrBase = base + offset
        space.cells.set(arrBase, {
          address: arrBase,
          type: fieldType,
          value: { type: 'array', base: arrBase, length: fieldType.size },
          region,
          dead: false,
        })
        for (let j = 0; j < fieldType.size; j++) {
          const elemAddr = arrBase + 1 + j
          space.cells.set(elemAddr, {
            address: elemAddr,
            type: fieldType.of,
            value: defaultValue(fieldType.of),
            region,
            dead: false,
          })
        }
        offset += 1 + fieldType.size
      }
      else {
        const fieldAddress = base + offset
        space.cells.set(fieldAddress, {
          address: fieldAddress,
          type: fieldType,
          value: defaultValue(fieldType),
          region,
          dead: false,
        })
        offset += 1
      }
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

    // For structs/arrays, also mark field/element cells as dead.
    // Fields are contiguous at base+1..base+N, same region, not struct/array headers.
    const v = cell.value
    if (typeof v === 'object' && v.type === 'struct') {
      for (let i = 1; ; i++) {
        const sub = space.cells.get(address + i)
        if (!sub || sub.region !== cell.region)
          break
        // Stop if we hit another struct/array header (its own base)
        const sv = sub.value
        if (typeof sv === 'object' && (sv.type === 'struct' || sv.type === 'array') && sv.base === sub.address)
          break
        sub.dead = true
      }
    }
    else if (typeof v === 'object' && v.type === 'array') {
      for (let i = 1; i <= v.length; i++) {
        const sub = space.cells.get(address + i)
        if (sub)
          sub.dead = true
      }
    }
  }

  function readField(
    structBase: number,
    fieldName: string,
    fieldDefs: Record<string, CppType>,
  ): [CppType, number] {
    const offset = structFieldOffset(fieldName, fieldDefs)
    if (offset === -1)
      throw new Error(`Unknown field: ${fieldName}`)
    return [fieldDefs[fieldName], structBase + 1 + offset]
  }

  function reset(): void {
    space.cells.clear()
    space.stackTop = 1
    space.version = 0
    space.heapBottom = MEMORY_SIZE - 1
    space.cells.set(NULL_ADDRESS, makeNullCell())
  }

  return { space, alloc, allocStruct, allocArray, read, write, free, readField, structFieldOffset, reset }
}
