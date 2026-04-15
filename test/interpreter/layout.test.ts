import { describe, expect, it } from 'vitest'
import { alignOf, alignUp, sizeOf } from '../../src/composables/interpreter/layout'

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
