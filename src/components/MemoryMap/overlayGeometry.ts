interface Rect { x: number, y: number, width: number, height: number }

export interface OverlayGeometry {
  bytesPerRow: number
  cellWidth: number
  rowHeight: number
  labelWidth: number
  regionStart: number
}

export function allocationRects(base: number, size: number, g: OverlayGeometry): Rect[] {
  if (size <= 0)
    return []
  const { bytesPerRow, cellWidth, rowHeight, labelWidth, regionStart } = g
  const rel = base - regionStart
  const startRow = Math.floor(rel / bytesPerRow)
  const startCol = rel % bytesPerRow
  const endByte = rel + size
  const endRow = Math.floor((endByte - 1) / bytesPerRow)
  const endCol = ((endByte - 1) % bytesPerRow) + 1

  const x = (col: number) => labelWidth + col * cellWidth
  const y = (row: number) => row * rowHeight

  if (startRow === endRow) {
    return [{
      x: x(startCol),
      y: y(startRow),
      width: (endCol - startCol) * cellWidth,
      height: rowHeight,
    }]
  }

  const rects: Rect[] = []
  rects.push({
    x: x(startCol),
    y: y(startRow),
    width: (bytesPerRow - startCol) * cellWidth,
    height: rowHeight,
  })
  if (endRow - startRow > 1) {
    rects.push({
      x: x(0),
      y: y(startRow + 1),
      width: bytesPerRow * cellWidth,
      height: (endRow - startRow - 1) * rowHeight,
    })
  }
  rects.push({
    x: x(0),
    y: y(endRow),
    width: endCol * cellWidth,
    height: rowHeight,
  })
  return rects
}

/**
 * Trace the perimeter of an allocation as a single SVG path `d` string.
 *
 * The allocation may span 1..3 rects (single-row, head+tail, head+middle+tail)
 * produced by `allocationRects`. When consecutive rects share a row boundary
 * (head's bottom with middle's top, or middle's bottom with tail's top), we
 * emit one staircase path so the row-boundary edges aren't doubly-drawn.
 *
 * Two cases produce disjoint sub-paths:
 *   - head+tail with no x-overlap (tail_right ≤ head_left): two rectangles
 *     that touch only at a corner point; trace them separately.
 *
 * The `inset` parameter shrinks the path inward by that many pixels on every
 * side so the stroke (centered on the path) fits inside the visible region
 * without being clipped by the scroll container.
 */
export function allocationPath(base: number, size: number, g: OverlayGeometry, inset = 0): string {
  const rects = allocationRects(base, size, g)
  if (rects.length === 0)
    return ''

  const rectPath = (r: Rect): string => {
    const x1 = r.x + inset
    const y1 = r.y + inset
    const x2 = r.x + r.width - inset
    const y2 = r.y + r.height - inset
    return `M${x1} ${y1}L${x2} ${y1}L${x2} ${y2}L${x1} ${y2}Z`
  }

  if (rects.length === 1)
    return rectPath(rects[0])

  const head = rects[0]
  const tail = rects.at(-1)!
  const hasMiddle = rects.length === 3
  const middle = hasMiddle ? rects[1] : null

  // 2-rect head+tail case: they share an edge iff their x-ranges overlap by
  // more than a single point — i.e. tail.right > head.left.
  const connected = hasMiddle || (tail.x + tail.width > head.x)

  if (!connected) {
    // Disjoint: two touching-at-corner rectangles, emit separately.
    return rectPath(head) + rectPath(tail)
  }

  // Connected staircase. Traversal is clockwise in screen coords (y-down),
  // so interior is to the walker's right hand. Each edge insets toward its
  // right-hand normal.
  const headLeft = head.x + inset
  const headTop = head.y + inset
  const topRight = head.x + head.width - inset // == middle.right when present
  // Step-left edge (upper concave corner): at the tail/middle row boundary.
  // Interior is ABOVE this edge, so inset shifts it UP.
  const stepLeftY = (middle ? middle.y + middle.height : tail.y) - inset
  // Step-right edge (lower concave corner): at the head/middle row boundary.
  // Interior is BELOW this edge, so inset shifts it DOWN.
  const stepRightY = head.y + head.height + inset
  const tailRight = tail.x + tail.width - inset
  const tailBottom = tail.y + tail.height - inset
  const leftColumn = tail.x + inset // tail.x === middle.x === 0 when present

  return [
    `M${headLeft} ${headTop}`,
    `L${topRight} ${headTop}`,
    `L${topRight} ${stepLeftY}`,
    `L${tailRight} ${stepLeftY}`,
    `L${tailRight} ${tailBottom}`,
    `L${leftColumn} ${tailBottom}`,
    `L${leftColumn} ${stepRightY}`,
    `L${headLeft} ${stepRightY}`,
    'Z',
  ].join('')
}
