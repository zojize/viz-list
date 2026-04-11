import { readonly, shallowRef } from 'vue'

/**
 * Placement engine for the data structure canvas.
 *
 * Items get absolute {x,y} positions that persist across renders.
 * New items are placed in the first empty space that fits within the
 * visible area, falling back to outside if needed.
 * Container resize never moves existing items.
 *
 * Tree-aware: `placeRelative` places children relative to parents.
 * Conflict resolution: `displaceAndPlace` moves conflicting items.
 * User drag tracking: manually-dragged items are not auto-repositioned.
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
  /** Extra gap for arrows between tree parent and child */
  arrowGap?: number
  /** Returns the visible container size */
  containerSize?: () => { w: number, h: number } | null
  /** Returns the current pan offset (items placed within the visible viewport) */
  panOffset?: () => { x: number, y: number }
}

export function usePlacementEngine(options: PlacementOptions = {}) {
  const { gap = 12, arrowGap = 60 } = options

  /** The top-left corner of the visible viewport in content coordinates */
  function getViewOrigin(): { x: number, y: number } {
    const pan = options.panOffset?.() ?? { x: 0, y: 0 }
    return { x: -pan.x, y: -pan.y }
  }

  const positions = new Map<string, { x: number, y: number }>()
  const sizes = new Map<string, { w: number, h: number }>()
  const userDragged = new Set<string>()
  const version = shallowRef(0)

  // ---- Basic accessors ----

  function setSize(key: string, w: number, h: number) {
    sizes.set(key, { w, h })
  }

  function getSize(key: string): { w: number, h: number } | undefined {
    return sizes.get(key)
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

  // ---- User drag tracking ----

  function markUserDragged(key: string) {
    userDragged.add(key)
  }

  function clearUserDragged(key?: string) {
    if (key)
      userDragged.delete(key)
    else
      userDragged.clear()
  }

  function isUserDragged(key: string): boolean {
    return userDragged.has(key)
  }

  // ---- Occupied rectangles ----

  function getOccupied(excludeKey?: string): Rect[] {
    const rects: Rect[] = []
    for (const [k, pos] of positions) {
      if (k === excludeKey)
        continue
      const size = sizes.get(k)
      if (size)
        rects.push({ x: pos.x, y: pos.y, w: size.w, h: size.h })
    }
    return rects
  }

  function getOccupiedKeyed(excludeKey?: string): { key: string, rect: Rect }[] {
    const rects: { key: string, rect: Rect }[] = []
    for (const [k, pos] of positions) {
      if (k === excludeKey)
        continue
      const size = sizes.get(k)
      if (size)
        rects.push({ key: k, rect: { x: pos.x, y: pos.y, w: size.w, h: size.h } })
    }
    return rects
  }

  // ---- Placement ----

  /**
   * Place a new item in the first available empty space.
   * Returns existing position if already placed.
   */
  function placeNew(key: string, w: number, h: number): { x: number, y: number } {
    const existing = positions.get(key)
    if (existing)
      return existing

    sizes.set(key, { w, h })
    const occupied = getOccupied()
    const container = options.containerSize?.()

    const pos = findEmptySpace(w, h, occupied, container)
    positions.set(key, pos)
    version.value++
    return pos
  }

  /**
   * Place a child item relative to its parent for tree layout.
   * Children are placed to the right or left of the parent with arrow gap.
   * Multiple siblings are centered vertically relative to the parent.
   * TODO: support 'down' and 'up' directions
   */
  function placeRelative(
    key: string,
    parentKey: string,
    w: number,
    h: number,
    childIndex: number,
    siblingHeights: number[],
    direction: 'right' | 'left' | 'down' = 'right',
  ): { x: number, y: number } {
    // Already placed (user-dragged or from a prior layout pass) — keep position.
    // Auto-layout calls clear() first, so positions will be empty and this is skipped.
    const existing = positions.get(key)
    if (existing)
      return existing

    const parentPos = positions.get(parentKey)
    const parentSize = sizes.get(parentKey)
    if (!parentPos || !parentSize) {
      return placeNew(key, w, h)
    }

    sizes.set(key, { w, h })

    // Compute ideal X based on direction
    const idealX = direction === 'left'
      ? parentPos.x - w - arrowGap
      : parentPos.x + parentSize.w + arrowGap

    // Compute Y: center siblings block on parent's vertical center
    const totalHeight = siblingHeights.reduce((sum, sh) => sum + sh, 0) + (siblingHeights.length - 1) * gap
    const parentCenterY = parentPos.y + parentSize.h / 2
    const blockTopY = parentCenterY - totalHeight / 2

    let cumY = blockTopY
    for (let i = 0; i < childIndex; i++)
      cumY += siblingHeights[i] + gap

    const idealY = cumY
    const pos = { x: idealX, y: idealY }

    positions.set(key, pos)
    version.value++
    return pos
  }

  /**
   * Place an item at a specific position, displacing any conflicting items.
   * Returns the list of displaced keys (caller can check for active drag conflicts).
   */
  function displaceAndPlace(key: string, x: number, y: number, w: number, h: number): string[] {
    sizes.set(key, { w, h })
    const target: Rect = { x, y, w, h }

    // Find all conflicting items
    const occupiedKeyed = getOccupiedKeyed(key)
    const displaced: string[] = []

    for (const item of occupiedKeyed) {
      if (rectsOverlap(target, item.rect))
        displaced.push(item.key)
    }

    // Remove conflicting items temporarily
    for (const k of displaced)
      positions.delete(k)

    // Place the target item
    positions.set(key, { x, y })

    // Re-place displaced items
    const container = options.containerSize?.()
    for (const k of displaced) {
      const size = sizes.get(k)
      if (!size)
        continue
      const occupied = getOccupied(k)
      const newPos = findEmptySpace(size.w, size.h, occupied, container)
      positions.set(k, newPos)
    }

    version.value++
    return displaced
  }

  /**
   * Full re-layout: clear all positions and user drags, re-place in order.
   * Tree items should be placed first (via placeRelative after this), then singletons.
   */
  function reLayout(orderedKeys: { key: string, w: number, h: number }[]) {
    positions.clear()
    userDragged.clear()

    const container = options.containerSize?.()
    for (const { key, w, h } of orderedKeys) {
      sizes.set(key, { w, h })
      const occupied = getOccupied()
      const pos = findEmptySpace(w, h, occupied, container)
      positions.set(key, pos)
    }

    version.value++
  }

  // ---- Space finding ----

  function findEmptySpace(w: number, h: number, occupied: Rect[], container: { w: number, h: number } | null | undefined): { x: number, y: number } {
    const origin = getViewOrigin()
    const viewW = container ? container.w : Infinity
    const maxW = origin.x + viewW
    const maxH = container ? origin.y + container.h : Infinity

    // If item is wider than viewport (e.g. linked list chains), just find a clear
    // Y row starting at origin.x — horizontal overflow is fine (user can pan).
    const widerThanViewport = w > viewW

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

      if (widerThanViewport) {
        // Wide items: place at origin.x, check only vertical clearance
        const candidate: Rect = { x: origin.x, y: tryY, w, h }
        if (!overlapsAny(candidate, occupied))
          return { x: origin.x, y: tryY }
        continue
      }

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

  // ---- Collision detection ----

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

  /**
   * Remove positions of items that overlap with any item in the given set.
   * Returns the keys that were evicted (so they can be re-placed later).
   */
  function evictOverlapping(protectedKeys: Set<string>): string[] {
    const protectedRects: Rect[] = []
    for (const k of protectedKeys) {
      const pos = positions.get(k)
      const size = sizes.get(k)
      if (pos && size)
        protectedRects.push({ x: pos.x, y: pos.y, w: size.w, h: size.h })
    }
    if (protectedRects.length === 0)
      return []

    const evicted: string[] = []
    for (const [k, pos] of positions) {
      if (protectedKeys.has(k))
        continue
      const size = sizes.get(k)
      if (!size)
        continue
      const itemRect: Rect = { x: pos.x, y: pos.y, w: size.w, h: size.h }
      if (overlapsAny(itemRect, protectedRects)) {
        evicted.push(k)
      }
    }

    for (const k of evicted)
      positions.delete(k)

    if (evicted.length > 0)
      version.value++

    return evicted
  }

  // ---- Lifecycle ----

  function remove(key: string) {
    positions.delete(key)
    sizes.delete(key)
    userDragged.delete(key)
    version.value++
  }

  function retainOnly(keys: Set<string>) {
    let changed = false
    for (const k of positions.keys()) {
      if (!keys.has(k)) {
        positions.delete(k)
        sizes.delete(k)
        userDragged.delete(k)
        changed = true
      }
    }
    if (changed)
      version.value++
  }

  function clear() {
    positions.clear()
    sizes.clear()
    userDragged.clear()
    version.value++
  }

  /** Bounding box of all placed items (null when empty). */
  function getContentBounds(): { minX: number, minY: number, maxX: number, maxY: number, maxItemW: number, maxItemH: number } | null {
    // eslint-disable-next-line ts/no-unused-expressions
    version.value
    if (positions.size === 0)
      return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxItemW = 0
    let maxItemH = 0
    for (const [k, pos] of positions) {
      const size = sizes.get(k) ?? { w: 0, h: 0 }
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + size.w)
      maxY = Math.max(maxY, pos.y + size.h)
      maxItemW = Math.max(maxItemW, size.w)
      maxItemH = Math.max(maxItemH, size.h)
    }
    return { minX, minY, maxX, maxY, maxItemW, maxItemH }
  }

  return {
    getPosition,
    setPosition,
    getSize,
    setSize,
    placeNew,
    placeRelative,
    displaceAndPlace,
    reLayout,
    remove,
    retainOnly,
    clear,
    getContentBounds,
    markUserDragged,
    clearUserDragged,
    isUserDragged,
    evictOverlapping,
    version: readonly(version),
  }
}
