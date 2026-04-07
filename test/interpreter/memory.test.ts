import type { CppType } from '../../src/composables/interpreter/types'
import { describe, expect, it } from 'vitest'
import { createAddressSpace } from '../../src/composables/interpreter/memory'
import { NULL_ADDRESS } from '../../src/composables/interpreter/types'

describe('addressSpace', () => {
  it('has a NULL cell at address 0', () => {
    const mem = createAddressSpace()
    const cell = mem.read(NULL_ADDRESS)
    expect(cell.address).toBe(0)
    expect(cell.type).toBe('int')
    expect(cell.value).toBe(0)
    expect(cell.region).toBe('global')
    expect(cell.dead).toBe(true)
  })

  it('allocates primitives with incrementing addresses', () => {
    const mem = createAddressSpace()
    const a1 = mem.alloc('int', 42, 'stack')
    const a2 = mem.alloc('bool', false, 'stack')
    const a3 = mem.alloc('float', 3.14, 'heap')
    expect(a1).toBe(1)
    expect(a2).toBe(2)
    expect(a3).toBe(3)
    expect(mem.read(a1).value).toBe(42)
    expect(mem.read(a2).value).toBe(false)
    expect(mem.read(a3).value).toBe(3.14)
  })

  it('allocates a struct with contiguous field addresses', () => {
    const mem = createAddressSpace()
    const fieldDefs: Record<string, CppType> = { x: 'int', y: 'float' }
    const base = mem.allocStruct('Point', fieldDefs, 'stack')

    // Header at base
    const header = mem.read(base)
    expect(header.value).toEqual({ type: 'struct', name: 'Point', base })
    expect(header.dead).toBe(false)

    // Fields immediately after
    const xCell = mem.read(base + 1)
    const yCell = mem.read(base + 2)
    expect(xCell.address).toBe(base + 1)
    expect(xCell.type).toBe('int')
    expect(xCell.value).toBe(0)
    expect(yCell.address).toBe(base + 2)
    expect(yCell.type).toBe('float')
    expect(yCell.value).toBe(0)
  })

  it('allocates an array with contiguous element addresses', () => {
    const mem = createAddressSpace()
    const base = mem.allocArray('int', 3, 'heap')

    const header = mem.read(base)
    expect(header.value).toEqual({ type: 'array', base, length: 3 })

    for (let i = 0; i < 3; i++) {
      const cell = mem.read(base + 1 + i)
      expect(cell.address).toBe(base + 1 + i)
      expect(cell.type).toBe('int')
      expect(cell.value).toBe(0)
    }
  })

  it('reads and writes cell values', () => {
    const mem = createAddressSpace()
    const addr = mem.alloc('int', 0, 'stack')
    mem.write(addr, 99)
    expect(mem.read(addr).value).toBe(99)
  })

  it('throws on read of invalid address', () => {
    const mem = createAddressSpace()
    expect(() => mem.read(999)).toThrow('Invalid address: 999')
  })

  it('throws on write to invalid address', () => {
    const mem = createAddressSpace()
    expect(() => mem.write(999, 0)).toThrow('Invalid address: 999')
  })

  it('free marks cell as dead', () => {
    const mem = createAddressSpace()
    const addr = mem.alloc('int', 1, 'heap')
    expect(mem.read(addr).dead).toBe(false)
    mem.free(addr)
    expect(mem.read(addr).dead).toBe(true)
  })

  it('readField resolves field by name to address and type', () => {
    const mem = createAddressSpace()
    const fieldDefs: Record<string, CppType> = { x: 'int', y: 'float', z: 'double' }
    const base = mem.allocStruct('Vec3', fieldDefs, 'stack')

    const [xType, xAddr] = mem.readField(base, 'x', fieldDefs)
    expect(xType).toBe('int')
    expect(xAddr).toBe(base + 1)

    const [yType, yAddr] = mem.readField(base, 'y', fieldDefs)
    expect(yType).toBe('float')
    expect(yAddr).toBe(base + 2)

    const [zType, zAddr] = mem.readField(base, 'z', fieldDefs)
    expect(zType).toBe('double')
    expect(zAddr).toBe(base + 3)
  })

  it('readField throws on unknown field', () => {
    const mem = createAddressSpace()
    const fieldDefs: Record<string, CppType> = { x: 'int' }
    const base = mem.allocStruct('S', fieldDefs, 'stack')
    expect(() => mem.readField(base, 'nope', fieldDefs)).toThrow('Unknown field: nope')
  })

  it('reset clears all cells and resets nextAddress to 1', () => {
    const mem = createAddressSpace()
    mem.alloc('int', 1, 'stack')
    mem.alloc('int', 2, 'stack')
    mem.reset()

    // NULL cell should be re-created
    const nullCell = mem.read(NULL_ADDRESS)
    expect(nullCell.dead).toBe(true)

    // nextAddress should be back to 1
    const addr = mem.alloc('int', 10, 'stack')
    expect(addr).toBe(1)

    // Previous cells (2, 3) should be gone
    expect(() => mem.read(2)).toThrow()
    expect(() => mem.read(3)).toThrow()
  })
})
