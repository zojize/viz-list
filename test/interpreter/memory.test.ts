import type { CppType } from '../../src/composables/interpreter/types'
import { describe, expect, it } from 'vitest'
import { createAddressSpace } from '../../src/composables/interpreter/memory'
import { MEMORY_SIZE, NULL_ADDRESS } from '../../src/composables/interpreter/types'

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

  it('stack allocates upward from address 1', () => {
    const mem = createAddressSpace()
    const a1 = mem.alloc('int', 42, 'stack')
    const a2 = mem.alloc('bool', false, 'stack')
    expect(a1).toBe(1)
    expect(a2).toBe(2)
    expect(mem.read(a1).value).toBe(42)
    expect(mem.read(a2).value).toBe(false)
  })

  it('heap allocates downward from top of memory', () => {
    const mem = createAddressSpace()
    const h1 = mem.alloc('float', 3.14, 'heap')
    const h2 = mem.alloc('int', 7, 'heap')
    expect(h1).toBe(MEMORY_SIZE - 1)
    expect(h2).toBe(MEMORY_SIZE - 2)
    expect(mem.read(h1).value).toBe(3.14)
    expect(mem.read(h2).value).toBe(7)
  })

  it('stack and heap use separate address ranges', () => {
    const mem = createAddressSpace()
    const s1 = mem.alloc('int', 1, 'stack')
    const h1 = mem.alloc('int', 2, 'heap')
    const s2 = mem.alloc('int', 3, 'stack')
    // Stack grows up, heap grows down — they don't interleave
    expect(s1).toBe(1)
    expect(s2).toBe(2)
    expect(h1).toBe(MEMORY_SIZE - 1)
    expect(mem.read(s1).region).toBe('stack')
    expect(mem.read(h1).region).toBe('heap')
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

  it('allocates a heap struct with contiguous fields in high address range', () => {
    const mem = createAddressSpace()
    const fieldDefs: Record<string, CppType> = { data: 'int', next: { type: 'pointer', to: 'int' } }
    const base = mem.allocStruct('Node', fieldDefs, 'heap')

    // Base should be in the high address range
    expect(base).toBeGreaterThan(MEMORY_SIZE / 2)
    // Fields are at base+1, base+2
    expect(mem.read(base + 1).type).toBe('int')
    expect(mem.read(base + 2).type).toEqual({ type: 'pointer', to: 'int' })
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

  it('reset clears all cells and resets pointers', () => {
    const mem = createAddressSpace()
    mem.alloc('int', 1, 'stack')
    mem.alloc('int', 2, 'heap')
    mem.reset()

    // NULL cell should be re-created
    const nullCell = mem.read(NULL_ADDRESS)
    expect(nullCell.dead).toBe(true)

    // stackTop should be back to 1
    const addr = mem.alloc('int', 10, 'stack')
    expect(addr).toBe(1)

    // heapBottom should be back to top
    const haddr = mem.alloc('int', 20, 'heap')
    expect(haddr).toBe(MEMORY_SIZE - 1)
  })

  it('throws on stack-heap collision', () => {
    const mem = createAddressSpace()
    // Fill stack up to near the top: use MEMORY_SIZE - 2 slots (addresses 1..MEMORY_SIZE-2)
    for (let i = 0; i < MEMORY_SIZE - 2; i++)
      mem.alloc('int', i, 'stack')
    // stackTop is now MEMORY_SIZE-1, heapBottom is MEMORY_SIZE-1
    // One slot left at address MEMORY_SIZE-1 — heap grabs it
    const h = mem.alloc('int', 0, 'heap')
    expect(h).toBe(MEMORY_SIZE - 1)
    // Now no space left — next allocation should collide
    expect(() => mem.alloc('int', 0, 'stack')).toThrow('Out of memory')
  })
})
