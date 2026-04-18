import { describe, expect, it } from 'vitest'
import { allocationPath, allocationRects } from '../../src/components/MemoryMap/overlayGeometry'

const G = { bytesPerRow: 8, cellWidth: 32, rowHeight: 28, labelWidth: 62, regionStart: 0 }

describe('allocationRects', () => {
  it('single row, aligned to column start', () => {
    expect(allocationRects(0, 4, G)).toEqual([
      { x: 62, y: 0, width: 128, height: 28 },
    ])
  })

  it('single row, mid-row start', () => {
    // base 12 → row 1 (12 / 8 = 1), col 4 (12 % 8 = 4)
    expect(allocationRects(12, 4, G)).toEqual([
      { x: 62 + 4 * 32, y: 28, width: 4 * 32, height: 28 },
    ])
  })

  it('exact row fit produces one rect', () => {
    expect(allocationRects(0, 8, G)).toEqual([
      { x: 62, y: 0, width: 256, height: 28 },
    ])
  })

  it('starts at row boundary (single row)', () => {
    // base 8 → row 1, col 0
    expect(allocationRects(8, 4, G)).toEqual([
      { x: 62, y: 28, width: 128, height: 28 },
    ])
  })

  it('wraps once → head + tail', () => {
    // base 6 on row 0 cols 6..7 (2 bytes), then tail row 1 cols 0..5 (6 bytes)
    const rects = allocationRects(6, 8, G)
    expect(rects).toHaveLength(2)
    expect(rects[0]).toEqual({ x: 62 + 6 * 32, y: 0, width: 64, height: 28 })
    expect(rects[1]).toEqual({ x: 62, y: 28, width: 192, height: 28 })
  })

  it('wraps across multiple rows → head + middle + tail', () => {
    // base 6, size 20: row 0 cols 6..7 (2), row 1 full (8), row 2 full (8), row 3 cols 0..1 (2) → 2+8+8+2 = 20
    const rects = allocationRects(6, 20, G)
    expect(rects).toHaveLength(3)
    expect(rects[0]).toEqual({ x: 62 + 6 * 32, y: 0, width: 64, height: 28 })
    expect(rects[1]).toEqual({ x: 62, y: 28, width: 256, height: 56 }) // middle: 2 full rows
    expect(rects[2]).toEqual({ x: 62, y: 84, width: 64, height: 28 }) // tail: 2 bytes
  })

  it('respects region offset (heap row index is region-relative)', () => {
    const heap = { ...G, regionStart: 8192 }
    const rects = allocationRects(8192, 4, heap)
    expect(rects).toEqual([{ x: 62, y: 0, width: 128, height: 28 }])
  })

  it('returns empty for size 0', () => {
    expect(allocationRects(0, 0, G)).toEqual([])
  })
})

describe('allocationPath', () => {
  it('single rect → closed rectangle', () => {
    // base 0, size 4 at bpr 8 → rect (62, 0) to (190, 28)
    expect(allocationPath(0, 4, G)).toBe('M62 0L190 0L190 28L62 28Z')
  })

  it('applies inset to single rect', () => {
    expect(allocationPath(0, 4, G, 1)).toBe('M63 1L189 1L189 27L63 27Z')
  })

  it('head + tail connected (tail_right > head_left) → one staircase', () => {
    // base 4, size 10, bpr 8: head row 0 cols 4..7 (4 bytes), tail row 1 cols 0..5 (6 bytes).
    // head.x=62+128=190, head.right=318. tail.x=62, tail.right=254. 254 > 190 → CONNECTED.
    const d = allocationPath(4, 10, G)
    expect(d).toBe('M190 0L318 0L318 28L254 28L254 56L62 56L62 28L190 28Z')
  })

  it('head + tail disjoint (tail_right ≤ head_left) → two rectangles', () => {
    // base 6, size 8, bpr 8: head row 0 cols 6..7 (2 bytes), tail row 1 cols 0..5 (6 bytes).
    // head.x=254, head.right=318. tail.x=62, tail.right=254. 254 == 254 → DISJOINT.
    const d = allocationPath(6, 8, G)
    expect(d).toBe(
      'M254 0L318 0L318 28L254 28Z'
      + 'M62 28L254 28L254 56L62 56Z',
    )
  })

  it('head + middle + tail → one tall staircase', () => {
    // base 6, size 20, bpr 8.
    const d = allocationPath(6, 20, G)
    expect(d).toBe('M254 0L318 0L318 84L126 84L126 112L62 112L62 28L254 28Z')
  })

  it('applies inset to connected staircase (row-boundary edges split by 2×inset)', () => {
    const d = allocationPath(4, 10, G, 1)
    // step-left edge moves up 1 (y=28 → 27); step-right edge moves down 1 (y=28 → 29).
    expect(d).toBe('M191 1L317 1L317 27L253 27L253 55L63 55L63 29L191 29Z')
  })

  it('empty for size 0', () => {
    expect(allocationPath(0, 0, G)).toBe('')
  })
})
