import { describe, expect, it } from 'vitest'
import { allocationRects } from '../../src/components/MemoryMap/overlayGeometry'

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
