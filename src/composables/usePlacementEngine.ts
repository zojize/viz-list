import { readonly, shallowRef } from 'vue'

/**
 * Placement engine for the data structure canvas.
 *
 * Items get absolute {x,y} positions that persist across renders.
 * New items are placed in the first empty space that fits within the
 * visible area, falling back to outside if needed.
 * Container resize never moves existing items.
 */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface PlacementOptions {
  /** Gap between items */
  gap?: number
  /** Returns the visible container size */
  containerSize?: () => { w: number, h: number } | null
  /** Returns the current pan offset (items placed within the visible viewport) */
  panOffset?: () => { x: number, y: number }
}

export function usePlacementEngine(options: PlacementOptions = {}) {
  const { gap = 12 } = options

  /** The top-left corner of the visible viewport in content coordinates */
  function getViewOrigin(): { x: number, y: number } {
    const pan = options.panOffset?.() ?? { x: 0, y: 0 }
    // panOffset is how much the content is translated: positive = content moved right/down
    // So the visible top-left in content coords is -pan
    return { x: -pan.x, y: -pan.y }
  }

  const positions = new Map<string, { x: number, y: number }>()
  const sizes = new Map<string, { w: number, h: number }>()
  const version = shallowRef(0)

  function setSize(key: string, w: number, h: number) {
    sizes.set(key, { w, h })
  }

  function getPosition(key: string): { x: number, y: number } | undefined {
    // eslint-disable-next-line ts/no-unused-expressions
    version.value
    return positions.get(key)
  }

  function setPosition(key: string, x: number, y: number) {
    positions.set(key, { x, y })
    version.value++
  }

  /** Collect all occupied rectangles from placed items */
  function getOccupied(): Rect[] {
    const rects: Rect[] = []
    for (const [k, pos] of positions) {
      const size = sizes.get(k)
      if (size)
        rects.push({ x: pos.x, y: pos.y, w: size.w, h: size.h })
    }
    return rects
  }

  /**
   * Place a new item. Chains (isChain=true) are treated as horizontally
   * expandable — only their height matters for Y placement.
   */
  function placeNew(key: string, w: number, h: number, isChain = false): { x: number, y: number } {
    const existing = positions.get(key)
    if (existing)
      return existing

    sizes.set(key, { w, h })
    const occupied = getOccupied()
    const container = options.containerSize?.()

    // For chains: place at originX, find a Y row that has enough vertical space.
    // Don't constrain width — chains can extend past the container via panning.
    if (isChain) {
      const pos = findRowForChain(h, occupied, container)
      positions.set(key, pos)
      version.value++
      return pos
    }

    const pos = findEmptySpace(w, h, occupied, container)
    positions.set(key, pos)
    version.value++
    return pos
  }

  /** Find a Y row with enough vertical clearance for a chain (infinite width to the right) */
  function findRowForChain(h: number, occupied: Rect[], container: { w: number, h: number } | null | undefined): { x: number, y: number } {
    const origin = getViewOrigin()
    const maxY = container ? origin.y + container.h : Infinity

    const candidateYs = new Set<number>([origin.y])
    for (const r of occupied)
      candidateYs.add(r.y + r.h + gap)
    const sortedYs = [...candidateYs].sort((a, b) => a - b)

    for (const tryY of sortedYs) {
      if (tryY + h > maxY)
        continue
      // Check if this row has vertical clearance (chain starts at origin.x, extends right)
      const blocked = occupied.some(r =>
        tryY < r.y + r.h + gap && tryY + h + gap > r.y
        && origin.x < r.x + r.w + gap,
      )
      if (!blocked)
        return { x: origin.x, y: tryY }
    }

    // Fallback: below everything
    let maxBottom = origin.y
    for (const r of occupied)
      maxBottom = Math.max(maxBottom, r.y + r.h + gap)
    return { x: origin.x, y: maxBottom }
  }

  function findEmptySpace(w: number, h: number, occupied: Rect[], container: { w: number, h: number } | null | undefined): { x: number, y: number } {
    const origin = getViewOrigin()
    const maxW = container ? origin.x + container.w : Infinity
    const maxH = container ? origin.y + container.h : Infinity

    // Collect candidate Y positions from existing items + visible origin
    const candidateYs = new Set<number>([origin.y])
    for (const r of occupied) {
      candidateYs.add(r.y)
      candidateYs.add(r.y + r.h + gap)
    }
    const sortedYs = [...candidateYs].sort((a, b) => a - b)

    // First pass: try to fit within visible viewport
    for (const tryY of sortedYs) {
      if (tryY + h > maxH)
        continue
      let tryX = origin.x
      for (let attempts = 0; attempts < 50; attempts++) {
        if (tryX + w > maxW)
          break
        const candidate: Rect = { x: tryX, y: tryY, w, h }
        if (!overlapsAny(candidate, occupied))
          return { x: tryX, y: tryY }
        const blocker = findOverlap(candidate, occupied)
        if (blocker)
          tryX = blocker.x + blocker.w + gap
        else
          tryX += gap
      }
    }

    // Second pass: place outside viewport (reachable via panning)
    let maxBottom = origin.y
    for (const r of occupied)
      maxBottom = Math.max(maxBottom, r.y + r.h + gap)
    return { x: origin.x, y: maxBottom }
  }

  function overlapsAny(candidate: Rect, occupied: Rect[]): boolean {
    return occupied.some(r => rectsOverlap(candidate, r))
  }

  function findOverlap(candidate: Rect, occupied: Rect[]): Rect | undefined {
    return occupied.find(r => rectsOverlap(candidate, r))
  }

  function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w + gap
      && a.x + a.w + gap > b.x
      && a.y < b.y + b.h + gap
      && a.y + a.h + gap > b.y
  }

  function remove(key: string) {
    positions.delete(key)
    sizes.delete(key)
    version.value++
  }

  function retainOnly(keys: Set<string>) {
    let changed = false
    for (const k of positions.keys()) {
      if (!keys.has(k)) {
        positions.delete(k)
        sizes.delete(k)
        changed = true
      }
    }
    if (changed)
      version.value++
  }

  function clear() {
    positions.clear()
    sizes.clear()
    version.value++
  }

  return {
    getPosition,
    setPosition,
    setSize,
    placeNew,
    remove,
    retainOnly,
    clear,
    version: readonly(version),
  }
}
