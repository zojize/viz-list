import type { LayoutNode } from '../../src/composables/interpreter/layout'
import { describe, expect, it } from 'vitest'
import { computeStructLayout } from '../../src/composables/interpreter/layout'
import { createAddressSpace } from '../../src/composables/interpreter/memory'
import { MEMORY_SIZE, NULL_ADDRESS } from '../../src/composables/interpreter/types'

describe('addressSpace — byte layer', () => {
  it('initializes a zeroed 16KB buffer with a NULL allocation at address 0', () => {
    const mem = createAddressSpace()
    expect(mem.space.buffer.length).toBe(MEMORY_SIZE)
    expect(mem.space.buffer[0]).toBe(0)
    const a = mem.findAllocation(NULL_ADDRESS)
    expect(a?.dead).toBe(true)
    expect(a?.base).toBe(0)
  })

  it('stack allocates upward by the type size', () => {
    const mem = createAddressSpace()
    const a = mem.alloc('int', 'stack')
    const b = mem.alloc('bool', 'stack')
    expect(a).toBe(4) // aligned up from 1 to 4
    expect(b).toBe(8) // bool at 8 (after int)
    mem.writeScalar(a, 'int', 42)
    mem.writeScalar(b, 'bool', true)
    expect(mem.readScalar(a, 'int')).toBe(42)
    expect(mem.readScalar(b, 'bool')).toBe(true)
  })

  it('stack allocations respect alignment', () => {
    const mem = createAddressSpace()
    mem.alloc('char', 'stack') // at 1
    const dptr = mem.alloc('double', 'stack') // needs align 8: padded to 8
    expect(dptr).toBe(8)
  })

  it('heap allocates downward from top', () => {
    const mem = createAddressSpace()
    const h1 = mem.alloc('int', 'heap')
    expect(h1).toBe(MEMORY_SIZE - 4) // 4 bytes reserved at the top
    mem.writeScalar(h1, 'int', 7)
    expect(mem.readScalar(h1, 'int')).toBe(7)
  })

  it('stores int little-endian in the buffer', () => {
    const mem = createAddressSpace()
    const a = mem.alloc('int', 'stack')
    mem.writeScalar(a, 'int', 1)
    expect(mem.space.buffer[a]).toBe(1)
    expect(mem.space.buffer[a + 1]).toBe(0)
    expect(mem.space.buffer[a + 2]).toBe(0)
    expect(mem.space.buffer[a + 3]).toBe(0)
  })

  it('throws on null pointer read', () => {
    const mem = createAddressSpace()
    expect(() => mem.readScalar(NULL_ADDRESS, 'int')).toThrow(/null/i)
  })

  it('throws on use-after-free', () => {
    const mem = createAddressSpace()
    const a = mem.alloc('int', 'heap')
    mem.free(a)
    expect(() => mem.readScalar(a, 'int')).toThrow(/use after free/i)
  })

  it('throws on out-of-arena read', () => {
    const mem = createAddressSpace()
    expect(() => mem.readScalar(MEMORY_SIZE + 1, 'int')).toThrow()
  })

  it('bumps version on every write', () => {
    const mem = createAddressSpace()
    const v0 = mem.space.version
    const a = mem.alloc('int', 'stack')
    mem.writeScalar(a, 'int', 1)
    expect(mem.space.version).toBeGreaterThan(v0)
  })
})

describe('addressSpace — struct layer', () => {
  it('allocates a struct using its cached layout', () => {
    const structLayouts: Record<string, LayoutNode> = {}
    structLayouts.Point = computeStructLayout('Point', { x: 'int', y: 'int' }, n => structLayouts[n])
    const mem = createAddressSpace()
    mem.registerStructLayout('Point', structLayouts.Point)

    const base = mem.allocStruct('Point', 'stack')
    expect(base).toBe(4)
    const { address: xAddr } = mem.fieldAddress(base, 'x')
    const { address: yAddr } = mem.fieldAddress(base, 'y')
    expect(xAddr).toBe(4)
    expect(yAddr).toBe(8)
    mem.writeScalar(xAddr, 'int', 10)
    mem.writeScalar(yAddr, 'int', 20)
    expect(mem.readScalar(xAddr, 'int')).toBe(10)
    expect(mem.readScalar(yAddr, 'int')).toBe(20)
  })

  it('allocates an array', () => {
    const mem = createAddressSpace()
    const base = mem.allocArray('int', 4, 'stack')
    expect(base).toBe(4)
    for (let i = 0; i < 4; i++) {
      const { address } = mem.elementAddress(base, i)
      expect(address).toBe(4 + i * 4)
      mem.writeScalar(address, 'int', i * 10)
    }
    expect(mem.readScalar(mem.elementAddress(base, 0).address, 'int')).toBe(0)
    expect(mem.readScalar(mem.elementAddress(base, 3).address, 'int')).toBe(30)
  })

  it('throws on array out-of-bounds', () => {
    const mem = createAddressSpace()
    const base = mem.allocArray('int', 4, 'stack')
    expect(() => mem.elementAddress(base, 4)).toThrow(/bounds/i)
  })
})

describe('describeByte', () => {
  it('returns the leaf field path for a byte inside a struct allocation', () => {
    const layouts: Record<string, LayoutNode> = {}
    layouts.Point = computeStructLayout('Point', { x: 'int', y: 'int' }, n => layouts[n])
    const mem = createAddressSpace()
    mem.registerStructLayout('Point', layouts.Point)
    const base = mem.allocStruct('Point', 'stack')
    // x at base..base+3, y at base+4..base+7
    const d = mem.describeByte(base + 5)!
    expect(d.path).toEqual(['y'])
    expect(d.leafType).toBe('int')
    expect(d.isPadding).toBe(false)
  })

  it('identifies padding bytes', () => {
    // struct { char a; int b; } — bytes 1..3 are padding
    const layouts: Record<string, LayoutNode> = {}
    layouts.P = computeStructLayout('P', { a: 'char', b: 'int' }, () => {
      throw new Error('unexpected struct lookup')
    })
    const mem = createAddressSpace()
    mem.registerStructLayout('P', layouts.P)
    const base = mem.allocStruct('P', 'stack')
    const d = mem.describeByte(base + 2)!
    expect(d.isPadding).toBe(true)
  })

  it('returns a path into nested arrays and structs', () => {
    // struct { int n; Point pts[3]; } — pts[1].y at offset 4 + 1*8 + 4 = 16
    const layouts: Record<string, LayoutNode> = {}
    layouts.Point = computeStructLayout('Point', { x: 'int', y: 'int' }, n => layouts[n])
    layouts.Bag = computeStructLayout('Bag', { n: 'int', pts: { type: 'array', of: { type: 'struct', name: 'Point' }, size: 3 } }, n => layouts[n])
    const mem = createAddressSpace()
    mem.registerStructLayout('Point', layouts.Point)
    mem.registerStructLayout('Bag', layouts.Bag)
    const base = mem.allocStruct('Bag', 'stack')
    const d = mem.describeByte(base + 16)!
    expect(d.path).toEqual(['pts', 1, 'y'])
    expect(d.leafType).toBe('int')
  })
})

describe('addressSpace — collision safety', () => {
  it('throws StackOverflowError when stack meets heap', () => {
    const mem = createAddressSpace()
    // Allocate heap until one more would collide.
    // With MEMORY_SIZE = 16384 and stackTop = 1, we have 16383 bytes available.
    // Allocate a large heap block that nearly fills the arena, then try to add more stack.
    mem.allocArray('char', MEMORY_SIZE - 8, 'heap')
    // Now try allocating enough on the stack to force collision.
    expect(() => mem.allocArray('char', 16, 'stack')).toThrow(/Out of memory/i)
  })

  it('catches alignment-induced heap overflow (Critical-bug regression)', () => {
    const mem = createAddressSpace()
    // Fill enough of both sides that heap alignment trim would overshoot stackTop.
    mem.allocArray('char', MEMORY_SIZE - 9, 'heap')
    // Now request a double from the heap — it needs align 8 and 8 bytes,
    // but the only available space is 8 bytes at a non-multiple-of-8 boundary.
    expect(() => mem.alloc('double', 'heap')).toThrow(/Out of memory/i)
  })
})
