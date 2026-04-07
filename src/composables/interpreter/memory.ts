import type { AddressSpace, CppType, CppValue, MemoryCell, MemoryRegion } from './types'
import { NULL_ADDRESS } from './types'

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
    nextAddress: 1,
  }

  // Install NULL cell at address 0
  space.cells.set(NULL_ADDRESS, makeNullCell())

  function alloc(type: CppType, value: CppValue, region: MemoryRegion): number {
    const address = space.nextAddress++
    space.cells.set(address, { address, type, value, region, dead: false })
    return address
  }

  function allocStruct(
    name: string,
    fieldDefs: Record<string, CppType>,
    region: MemoryRegion,
  ): number {
    const base = space.nextAddress++
    // Header cell
    space.cells.set(base, {
      address: base,
      type: { type: 'struct', name },
      value: { type: 'struct', name, base },
      region,
      dead: false,
    })
    // Field cells at base+1, base+2, ...
    const fields = Object.entries(fieldDefs)
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
    space.nextAddress = base + 1 + fields.length
    return base
  }

  function allocArray(
    elementType: CppType,
    size: number,
    region: MemoryRegion,
  ): number {
    const base = space.nextAddress++
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
    space.nextAddress = base + 1 + size
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
    space.nextAddress = 1
    space.cells.set(NULL_ADDRESS, makeNullCell())
  }

  return { space, alloc, allocStruct, allocArray, read, write, free, readField, reset }
}
