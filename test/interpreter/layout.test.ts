import type { LayoutNode } from '../../src/composables/interpreter/layout'
import { describe, expect, it } from 'vitest'
import { alignOf, alignUp, computeArrayLayout, computeStructLayout, sizeOf } from '../../src/composables/interpreter/layout'

describe('sizeOf', () => {
  it('returns LP32 widths for primitives', () => {
    expect(sizeOf('char')).toBe(1)
    expect(sizeOf('bool')).toBe(1)
    expect(sizeOf('int')).toBe(4)
    expect(sizeOf('float')).toBe(4)
    expect(sizeOf('double')).toBe(8)
  })

  it('returns 4 for any pointer', () => {
    expect(sizeOf({ type: 'pointer', to: 'int' })).toBe(4)
    expect(sizeOf({ type: 'pointer', to: 'double' })).toBe(4)
    expect(sizeOf({ type: 'pointer', to: { type: 'struct', name: 'X' } })).toBe(4)
  })
})

describe('alignOf', () => {
  it('matches sizeOf for primitives', () => {
    expect(alignOf('char')).toBe(1)
    expect(alignOf('int')).toBe(4)
    expect(alignOf('double')).toBe(8)
  })

  it('returns 4 for pointers', () => {
    expect(alignOf({ type: 'pointer', to: 'char' })).toBe(4)
  })
})

describe('alignUp', () => {
  it('rounds up to the nearest multiple of a', () => {
    expect(alignUp(0, 4)).toBe(0)
    expect(alignUp(1, 4)).toBe(4)
    expect(alignUp(5, 4)).toBe(8)
    expect(alignUp(8, 8)).toBe(8)
    expect(alignUp(9, 8)).toBe(16)
  })
})

describe('computeStructLayout', () => {
  it('handles an empty struct', () => {
    const layout = computeStructLayout('Empty', {}, () => {
      throw new Error('no nested')
    })
    expect(layout.size).toBe(0)
    expect(layout.fields).toEqual([])
  })

  it('lays out a packed-fit struct with no padding', () => {
    // struct S { int a; int b; } — 0..3, 4..7, size 8
    const layout = computeStructLayout('S', { a: 'int', b: 'int' }, () => {
      throw new Error('no nested struct')
    })
    expect(layout.size).toBe(8)
    expect(layout.fields[0]).toMatchObject({ name: 'a', offset: 0 })
    expect(layout.fields[1]).toMatchObject({ name: 'b', offset: 4 })
  })

  it('inserts padding between misaligned fields', () => {
    // struct Mixed { char a; int b; char c; double d; }
    const layout = computeStructLayout('Mixed', { a: 'char', b: 'int', c: 'char', d: 'double' }, () => {
      throw new Error('no nested struct')
    })
    expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
      ['a', 0],
      ['b', 4],
      ['c', 8],
      ['d', 16],
    ])
    expect(layout.size).toBe(24)
  })

  it('adds tail padding to align struct size to its max field alignment', () => {
    // struct S { double d; char c; } — d at 0..7, c at 8, tail pad to 16
    const layout = computeStructLayout('S', { d: 'double', c: 'char' }, () => {
      throw new Error('no nested struct')
    })
    expect(layout.size).toBe(16)
  })

  it('handles pointer fields (self-referential layout)', () => {
    // struct Node { int k; Node* l; Node* r; }
    const layout = computeStructLayout('Node', { k: 'int', l: { type: 'pointer', to: { type: 'struct', name: 'Node' } }, r: { type: 'pointer', to: { type: 'struct', name: 'Node' } } }, () => {
      throw new Error('should not resolve pointee')
    })
    expect(layout.size).toBe(12)
    expect(layout.fields.map(f => [f.name, f.offset])).toEqual([
      ['k', 0],
      ['l', 4],
      ['r', 8],
    ])
  })
})

describe('computeArrayLayout', () => {
  it('lays out a primitive array with no per-element padding', () => {
    // int[5] — stride 4, size 20
    const layout = computeArrayLayout('int', 5, () => {
      throw new Error('unexpected resolve')
    })
    expect(layout.stride).toBe(4)
    expect(layout.length).toBe(5)
    expect(layout.size).toBe(20)
  })

  it('pads element stride to the element alignment', () => {
    // A struct layout of nominal size=5 align=4 should produce stride 8 in an array.
    // Real structs are tail-padded so this is a guard against off-by-one stride bugs.
    const fakeStructLayout: LayoutNode = {
      kind: 'struct',
      structName: 'Pad1',
      size: 5,
      fields: [
        { name: 'i', node: { kind: 'scalar', type: 'int', size: 4 }, offset: 0 },
        { name: 'c', node: { kind: 'scalar', type: 'char', size: 1 }, offset: 4 },
      ],
    }
    const resolve = (name: string) => {
      if (name === 'Pad1')
        return fakeStructLayout
      throw new Error(`unexpected: ${name}`)
    }
    const layout = computeArrayLayout({ type: 'struct', name: 'Pad1' }, 3, resolve)
    expect(layout.stride).toBe(8)
    expect(layout.size).toBe(24)
  })
})

describe('nested structs and arrays', () => {
  it('inlines a nested struct into the parent layout', () => {
    // struct Point { int x; int y; }
    // struct Line { Point from; Point to; }
    const layouts: Record<string, LayoutNode> = {}
    layouts.Point = computeStructLayout('Point', { x: 'int', y: 'int' }, n => layouts[n])
    const line = computeStructLayout('Line', { from: { type: 'struct', name: 'Point' }, to: { type: 'struct', name: 'Point' } }, n => layouts[n])
    expect(line.size).toBe(16)
    expect(line.fields[0].offset).toBe(0)
    expect(line.fields[1].offset).toBe(8)
  })

  it('inlines a fixed-size array field into the parent layout', () => {
    // struct Bag { int n; int items[3]; }
    const layout = computeStructLayout('Bag', { n: 'int', items: { type: 'array', of: 'int', size: 3 } }, () => {
      throw new Error('unexpected resolve')
    })
    expect(layout.size).toBe(16)
    expect(layout.fields[0]).toMatchObject({ name: 'n', offset: 0 })
    expect(layout.fields[1]).toMatchObject({ name: 'items', offset: 4 })
    expect(layout.fields[1].node.kind).toBe('array')
  })
})
