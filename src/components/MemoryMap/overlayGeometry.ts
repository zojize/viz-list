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
