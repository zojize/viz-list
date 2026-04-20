<script setup lang="ts">
import type { ArrowAnchor, ArrowStyle, CppType, FieldDirection } from '~/composables/interpreter/types'
import { computed, nextTick, onUpdated, shallowRef, watch } from 'vue'
import CanvasArrow from '~/components/CanvasArrow.vue'
import DSValue from '~/components/DSValue.vue'
import { formatAddr, formatType } from '~/composables/interpreter/helpers'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import { usePannableCanvas } from '~/composables/usePannableCanvas'
import { usePlacementEngine } from '~/composables/usePlacementEngine'
import { usePointerGraph } from '~/composables/usePointerGraph'

const props = defineProps<{
  selectedAddress?: number | null
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverVariable: [name: string | null]
}>()

const context = useInterpreterContext()
const hover = useHoverHighlight()
const pointerGraph = usePointerGraph(context)

// ---- Standalone data items (in-scope stack + live heap) ----

interface DataItem {
  address: number
  type: CppType
  label: string
  kind: 'int' | 'float' | 'char' | 'bool' | 'pointer' | 'struct' | 'array'
  dimmed: boolean
  /** Variable name for editor highlighting (only for stack variables) */
  varName: string | null
}

/** Addresses that are sub-allocations (struct fields or array elements within a larger allocation).
 *  Sub-allocations don't get their own top-level cards. */
const subCellAddresses = computed(() => {
  const sub = new Set<number>()
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  for (const alloc of context.memory.space.allocations.values()) {
    if (alloc.dead)
      continue
    // Mark all byte addresses within a struct or array allocation (except the base) as sub-addresses.
    // Only top-level allocations are shown as cards.
    if (alloc.layout.kind === 'struct' || alloc.layout.kind === 'array') {
      for (let i = 1; i < alloc.size; i++)
        sub.add(alloc.base + i)
    }
  }
  return sub
})

function layoutToType(alloc: import('~/composables/interpreter/types').Allocation): CppType {
  const l = alloc.layout
  if (l.kind === 'scalar')
    return l.type
  if (l.kind === 'array')
    return { type: 'array', of: fieldNodeToType(l.element), size: l.length }
  return { type: 'struct', name: l.structName }
}

function fieldNodeToType(node: import('~/composables/interpreter/layout').LayoutNode): CppType {
  if (node.kind === 'scalar')
    return node.type
  if (node.kind === 'array')
    return { type: 'array', of: fieldNodeToType(node.element), size: node.length }
  return { type: 'struct', name: node.structName }
}

function getKind(type: CppType): DataItem['kind'] {
  if (typeof type === 'string') {
    if (type === 'float' || type === 'double')
      return 'float'
    if (type === 'char')
      return 'char'
    if (type === 'bool')
      return 'bool'
    return 'int'
  }
  if (type.type === 'pointer')
    return 'pointer'
  if (type.type === 'array')
    return 'array'
  return 'struct'
}

const standaloneItems = computed((): DataItem[] => {
  const items: DataItem[] = []
  const subCells = subCellAddresses.value
  const seen = new Set<number>()

  function addItem(name: string, address: number, type: CppType, dimmed: boolean, varName: string | null = null) {
    const alloc = context.memory.findAllocation(address)
    if (!alloc || alloc.dead || seen.has(address))
      return
    if (subCells.has(address))
      return
    seen.add(address)
    items.push({
      address,
      type,
      label: name,
      kind: getKind(type),
      dimmed,
      varName,
    })
  }

  // Current scope variables (not dimmed)
  for (let i = context.envStack.length - 1; i >= 0; i--) {
    const env = context.envStack[i]
    for (const [name, entry] of Object.entries(env)) {
      addItem(name, entry.address, entry.type, false, name)
    }
  }

  // Caller scope variables (dimmed)
  for (let ci = context.callStack.length - 1; ci >= 0; ci--) {
    const savedEnvs = context.callStack[ci].env
    for (let i = savedEnvs.length - 1; i >= 0; i--) {
      const env = savedEnvs[i]
      for (const [name, entry] of Object.entries(env)) {
        addItem(name, entry.address, entry.type, true, name)
      }
    }
  }

  // Live heap data (allocations not owned by any in-scope variable)
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  for (const alloc of context.memory.space.allocations.values()) {
    if (alloc.dead || alloc.region !== 'heap')
      continue
    const type = layoutToType(alloc)
    addItem(formatType(type), alloc.base, type, false)
  }

  return items
})

// ---- Whether anything is shown ----

const hasContent = computed(() => standaloneItems.value.length > 0)

function isNodeHighlighted(address: number): boolean {
  return hover.address.value === address
}

function isNodeSelected(address: number): boolean {
  return props.selectedAddress === address
}

function isStatementLhs(address: number): boolean {
  return props.statementLhsAddresses?.has(address) ?? false
}

function isStatementRhs(address: number): boolean {
  return props.statementRhsAddresses?.has(address) ?? false
}

function hasCodeHighlight(address: number): boolean {
  return isStatementLhs(address) || isStatementRhs(address)
}

function isHoverBoosted(address: number): boolean {
  return isNodeHighlighted(address) && hasCodeHighlight(address) && !isNodeSelected(address)
}

// ---- Placement engine ----

// ---- Pannable canvas (declared first so panOffset is available to placement) ----

const canvasRef = shallowRef<HTMLElement | null>(null)
const contentRef = shallowRef<HTMLElement | null>(null)

// Forward-declare placement so onDragEnd can reference it
let placementRef: ReturnType<typeof usePlacementEngine> | undefined

// One-shot flag set by onDragEnd; consumed (and reset) by onUpdated to skip
// the auto-pan that would otherwise undo a user drag out of the viewport.
let suppressAutoPanOnce = false

/** Reactive dep for geometry that isn't tracked by Vue (DOM rects). Bumped
 *  after zoom updates settle into the DOM so the next render of the arrow
 *  overlay re-measures with fresh getBoundingClientRect values. Without this
 *  a zoom click renders one tick with stale rects and arrows appear offset
 *  until the user pans. */
const arrowGeometryTick = shallowRef(0)

const {
  panOffset,
  zoom,
  isPanning,
  didDrag,
  getDragDelta,
  getActiveDragKey,
  panToElement,
  resetPan,
  clampPan,
  zoomIn,
  zoomOut,
  resetZoom,
} = usePannableCanvas({
  canvasRef,
  hasContent: () => hasContent.value,
  onDragEnd(key, dx, dy) {
    const pos = placementRef?.getPosition(key)
    if (pos) {
      placementRef?.setPosition(key, pos.x + dx, pos.y + dy)
      placementRef?.markUserDragged(key)
    }
    // The user intentionally placed the item wherever they released — even if
    // that's outside the current viewport. Suppress the one-shot auto-pan
    // that would otherwise pull the scene back to re-cover all content.
    suppressAutoPanOnce = true
  },
  contentBounds: () => placementRef?.getContentBounds() ?? null,
})

// ---- Placement engine (uses panOffset for viewport-aware placement) ----

const placement = usePlacementEngine({
  gap: 16,
  containerSize: () => {
    if (!canvasRef.value)
      return null
    return { w: canvasRef.value.clientWidth, h: canvasRef.value.clientHeight }
  },
  panOffset: () => ({ x: panOffset.x, y: panOffset.y }),
})
placementRef = placement

/** Reverse map: address → placement key (O(1) lookup) */
const addressKeyMap = computed(() => {
  const map = new Map<number, string>()
  for (const item of standaloneItems.value)
    map.set(item.address, `item-${item.address}`)
  return map
})

function addressToKey(address: number): string | undefined {
  return addressKeyMap.value.get(address)
}

/**
 * Track tree structure for change detection:
 * - childKey → parentKey (which parent a child belongs to)
 * - parentKey → Set<childKey> (sibling groups)
 * When a node's parent changes OR its sibling group changes, all affected
 * siblings are invalidated so placeRelative recalculates them as a group.
 */
const prevChildToParent = new Map<string, string | null>()
const prevParentToChildren = new Map<string, Set<string>>()

/** Build current tree maps from the pointer graph */
function buildTreeMaps(graph: typeof pointerGraph.value) {
  const childToParent = new Map<string, string | null>()
  const parentToChildren = new Map<string, Set<string>>()

  for (const tree of graph.trees) {
    const rootKey = addressToKey(tree.rootAddress)
    if (rootKey)
      childToParent.set(rootKey, null)
    for (const edge of tree.edges) {
      const childKey = addressToKey(edge.toAddress)
      const parentKey = addressToKey(edge.fromAddress)
      if (childKey && parentKey) {
        childToParent.set(childKey, parentKey)
        if (!parentToChildren.has(parentKey))
          parentToChildren.set(parentKey, new Set())
        parentToChildren.get(parentKey)!.add(childKey)
      }
    }
  }
  return { childToParent, parentToChildren }
}

/** Invalidate positions for items whose tree parent or sibling group changed */
function invalidateStaleTreePositions(
  newChildToParent: Map<string, string | null>,
  newParentToChildren: Map<string, Set<string>>,
) {
  const toInvalidate = new Set<string>()

  // 1. Items whose parent changed or that newly entered a tree
  for (const [key, newParent] of newChildToParent) {
    const oldParent = prevChildToParent.get(key)
    if (oldParent === undefined) {
      // Newly entered a tree → invalidate standalone position
      toInvalidate.add(key)
    }
    else if (oldParent !== newParent) {
      // Parent changed
      toInvalidate.add(key)
    }
  }

  // 2. Sibling groups that changed → invalidate ALL siblings of that parent
  for (const [parentKey, newChildren] of newParentToChildren) {
    const oldChildren = prevParentToChildren.get(parentKey)
    // Compare sets: different size or different members
    let childrenChanged = !oldChildren || oldChildren.size !== newChildren.size
    if (!childrenChanged) {
      for (const k of newChildren) {
        if (!oldChildren!.has(k)) {
          childrenChanged = true
          break
        }
      }
    }
    if (childrenChanged) {
      for (const childKey of newChildren)
        toInvalidate.add(childKey)
      // Also invalidate old siblings that may have been removed from the group
      if (oldChildren) {
        for (const childKey of oldChildren)
          toInvalidate.add(childKey)
      }
    }
  }

  // 3. Recursively invalidate descendants of any invalidated item.
  // When a parent is re-placed (e.g. moved to a new tree position), all its
  // children need recalculation relative to the parent's new position.
  const expanded = new Set(toInvalidate)
  const queue = [...toInvalidate]
  while (queue.length > 0) {
    const key = queue.shift()!
    const children = newParentToChildren.get(key)
    if (children) {
      for (const child of children) {
        if (!expanded.has(child)) {
          expanded.add(child)
          queue.push(child)
        }
      }
    }
  }

  // Apply invalidation (skip user-dragged items)
  for (const key of expanded) {
    if (!placement.isUserDragged(key))
      placement.remove(key)
  }

  // Update stored maps
  prevChildToParent.clear()
  for (const [k, v] of newChildToParent)
    prevChildToParent.set(k, v)
  prevParentToChildren.clear()
  for (const [k, v] of newParentToChildren)
    prevParentToChildren.set(k, new Set(v))
}

/** Measure and place all visible items with tree-aware layout. Returns the queried elements for reuse. */
function measureAndPlace(): NodeListOf<HTMLElement> | null {
  if (!contentRef.value)
    return null
  // Step 1: Measure all DOM elements
  const els = contentRef.value.querySelectorAll<HTMLElement>('[data-place-key]')
  const measured = new Map<string, { w: number, h: number }>()
  for (const el of els) {
    const key = el.dataset.placeKey!
    const w = el.offsetWidth
    const h = el.offsetHeight
    placement.setSize(key, w, h)
    measured.set(key, { w, h })
  }

  // Step 1.5: Detect tree structure changes and invalidate stale positions
  const graph = pointerGraph.value
  const { childToParent, parentToChildren } = buildTreeMaps(graph)
  invalidateStaleTreePositions(childToParent, parentToChildren)

  // Step 2: Place tree roots first, then their children via placeRelative
  const treePlacedKeys = new Set<string>()

  for (const tree of graph.trees) {
    const rootKey = addressToKey(tree.rootAddress)
    if (!rootKey || !measured.has(rootKey))
      continue

    // Build adjacency map once per tree (O(edges) instead of O(nodes × edges))
    const edgesByParent = new Map<number, typeof tree.edges>()
    for (const edge of tree.edges) {
      let list = edgesByParent.get(edge.fromAddress)
      if (!list) {
        list = []
        edgesByParent.set(edge.fromAddress, list)
      }
      list.push(edge)
    }

    // Place root normally
    const rootSize = measured.get(rootKey)!
    placement.placeNew(rootKey, rootSize.w, rootSize.h)
    treePlacedKeys.add(rootKey)

    // Recursively place children
    placeTreeChildren(tree.rootAddress, rootKey, edgesByParent, measured, treePlacedKeys)
  }

  // Step 2.5: Evict non-tree items whose positions now overlap with tree items.
  // This happens when a new tree edge forms and placeRelative puts a child
  // where a standalone item was already sitting from a prior render.
  if (treePlacedKeys.size > 0)
    placement.evictOverlapping(treePlacedKeys)

  // Step 3: Place non-pointer standalone items first so pointer cards (in
  // step 3.5) can see their targets' positions.
  const pointerItems: DataItem[] = []
  for (const item of standaloneItems.value) {
    const key = `item-${item.address}`
    if (treePlacedKeys.has(key))
      continue
    const size = measured.get(key)
    if (!size)
      continue
    if (item.kind === 'pointer') {
      pointerItems.push(item)
      continue
    }
    placement.placeNew(key, size.w, size.h)
  }

  // Step 3.5: Place pointer cards, topo-sorted so targets land first when a
  // chain of pointers points through each other (p1 -> p2 -> x). Each pointer
  // is probed against four target-adjacent candidate slots; the closest free
  // one wins. Past a distance cap it falls through to a free-slot placement
  // so crowded graphs don't shove pointers into far corners just to hug the
  // target.
  const sortedPointers = topoSortPointers(pointerItems)
  for (const item of sortedPointers) {
    const key = `item-${item.address}`
    // Idempotent like placeNew: if already placed on a prior pass keep the
    // position so re-renders don't re-probe and bump placement.version.
    if (placement.getPosition(key))
      continue
    const size = measured.get(key)
    if (!size)
      continue
    const placedNearTarget = tryPlacePointerNearTarget(key, item, size)
    if (!placedNearTarget)
      placement.placeNew(key, size.w, size.h)
  }

  // Step 4: Retain only active keys
  const activeKeys = new Set<string>()
  for (const el of els)
    activeKeys.add(el.dataset.placeKey!)
  placement.retainOnly(activeKeys)

  return els
}

/** Resolve a pointer item's target allocation base, or null if the pointer
 *  is null / points outside any live allocation. */
function pointerTargetBase(item: DataItem): number | null {
  if (typeof item.type !== 'object' || item.type.type !== 'pointer')
    return null
  let raw: number
  try {
    raw = context.memory.readScalar(item.address, item.type) as number
  }
  catch {
    return null
  }
  if (!raw)
    return null
  const alloc = context.memory.findAllocation(raw)
  if (!alloc || alloc.dead)
    return null
  return alloc.base
}

/** DFS-based topological sort: targets come before pointers that reference
 *  them. Pointer-to-pointer cycles fall through in original order so we
 *  always place every item exactly once. */
function topoSortPointers(items: DataItem[]): DataItem[] {
  const byAddr = new Map(items.map(i => [i.address, i]))
  const visited = new Set<number>()
  const onPath = new Set<number>()
  const sorted: DataItem[] = []
  function visit(item: DataItem) {
    if (visited.has(item.address) || onPath.has(item.address))
      return
    onPath.add(item.address)
    const tgt = pointerTargetBase(item)
    if (tgt !== null) {
      const depItem = byAddr.get(tgt)
      if (depItem)
        visit(depItem)
    }
    onPath.delete(item.address)
    visited.add(item.address)
    sorted.push(item)
  }
  for (const item of items) visit(item)
  return sorted
}

/** Try four target-adjacent candidate slots (right, left, below, above) and
 *  place the pointer at the closest one that's free and within a distance
 *  cap. Returns true on success. */
function tryPlacePointerNearTarget(key: string, item: DataItem, size: { w: number, h: number }): boolean {
  const tgtBase = pointerTargetBase(item)
  if (tgtBase === null)
    return false
  const targetKey = addressToKey(tgtBase)
  if (!targetKey)
    return false
  const tPos = placement.getPosition(targetKey)
  const tSize = placement.getSize(targetKey)
  if (!tPos || !tSize)
    return false

  const gap = 20
  // Distance cap: ~2x the bigger of the two card dimensions. Past that the
  // "near target" heuristic breaks down and free-slot placement looks
  // cleaner in crowded graphs.
  const maxDist = 2 * Math.max(tSize.w, tSize.h, size.w, size.h)

  const tCx = tPos.x + tSize.w / 2
  const tCy = tPos.y + tSize.h / 2
  const candidates = [
    { x: tPos.x + tSize.w + gap, y: tCy - size.h / 2 }, // right
    { x: tPos.x - size.w - gap, y: tCy - size.h / 2 }, // left
    { x: tCx - size.w / 2, y: tPos.y + tSize.h + gap }, // below
    { x: tCx - size.w / 2, y: tPos.y - size.h - gap }, // above
  ]

  // Walk nearest → farthest until one commits successfully. Candidate list
  // is tiny, so sort is trivial; tryPlaceAt is the only side-effect.
  const ordered = candidates
    .map((c) => {
      const cx = c.x + size.w / 2
      const cy = c.y + size.h / 2
      return { ...c, d: Math.hypot(cx - tCx, cy - tCy) }
    })
    .filter(c => c.d <= maxDist)
    .sort((a, b) => a.d - b.d)
  for (const c of ordered) {
    if (placement.tryPlaceAt(key, c.x, c.y, size.w, size.h))
      return true
  }
  return false
}

/** Recursively place children of a tree node via placeRelative */
function placeTreeChildren(
  parentAddress: number,
  parentKey: string,
  edgesByParent: Map<number, typeof pointerGraph.value.trees[number]['edges']>,
  measured: Map<string, { w: number, h: number }>,
  placedKeys: Set<string>,
) {
  const parentNode = pointerGraph.value.nodes.get(parentAddress)
  if (!parentNode)
    return

  const childEdges = edgesByParent.get(parentAddress)
  if (!childEdges || childEdges.length === 0)
    return

  // Collect children with their direction, skipping already-placed nodes
  // (left/prev edges can point back to the parent — must not recurse into them)
  interface ChildInfo { key: string, address: number, h: number, direction: FieldDirection }
  const children: ChildInfo[] = []
  for (const edge of childEdges) {
    const childKey = addressToKey(edge.toAddress)
    if (!childKey || !measured.has(childKey) || placedKeys.has(childKey))
      continue
    children.push({ key: childKey, address: edge.toAddress, h: measured.get(childKey)!.h, direction: edge.direction })
  }

  if (children.length === 0)
    return

  // Split children by direction — each direction group is centered independently
  const rightChildren = children.filter(c => c.direction === 'right')
  const leftChildren = children.filter(c => c.direction === 'left')
  const dynamicChildren = children.filter(c => c.direction === 'dynamic')

  // Look up struct-level arrowSize for the parent
  const arrowSizeOverride = context.structMeta[parentNode.structName]?.arrowSize

  function placeGroup(group: ChildInfo[], dir: 'right' | 'left') {
    const heights = group.map(c => c.h)
    for (let i = 0; i < group.length; i++) {
      const child = group[i]
      const size = measured.get(child.key)!
      placement.placeRelative(child.key, parentKey, size.w, size.h, i, heights, dir, arrowSizeOverride)
      placedKeys.add(child.key)
      placeTreeChildren(child.address, child.key, edgesByParent, measured, placedKeys)
    }
  }

  placeGroup(rightChildren, 'right')
  placeGroup(leftChildren, 'left')

  // Dynamic children: no preferred placement — use standalone positioning
  for (const child of dynamicChildren) {
    const size = measured.get(child.key)!
    placement.placeNew(child.key, size.w, size.h)
    placedKeys.add(child.key)
    placeTreeChildren(child.address, child.key, edgesByParent, measured, placedKeys)
  }
}

/** Snapshot of content bounds before placement, used to detect layout shifts */
let prevBoundsKey = ''

/** Items still settling — suppress movement transition until placed at real position. */
const settlingKeys = new Set<string>()
/** Previous set of active keys — used to detect enter/leave for animations. */
let prevActiveKeys = new Set<string>()

onUpdated(() => nextTick(() => {
  const els = measureAndPlace()
  if (els)
    animateEnterLeave(els)

  // Auto-pan when content bounds changed and items are outside the visible viewport
  const bounds = placement.getContentBounds()
  const canvas = canvasRef.value
  if (bounds && canvas) {
    const boundsKey = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`
    if (boundsKey !== prevBoundsKey) {
      prevBoundsKey = boundsKey
      // Check if any content is outside the current viewport
      const viewLeft = -panOffset.x
      const viewTop = -panOffset.y
      const viewRight = viewLeft + canvas.clientWidth
      const viewBottom = viewTop + canvas.clientHeight
      if (!suppressAutoPanOnce
        && (bounds.minX < viewLeft || bounds.minY < viewTop
          || bounds.maxX > viewRight || bounds.maxY > viewBottom)) {
        autoPanToContent()
      }
    }
  }
  suppressAutoPanOnce = false

  clampPan()
}))

// Reset pan when DS view becomes empty
watch(hasContent, (has) => {
  if (!has)
    resetPan()
})

// Zoom changes only flow into the CSS transform on contentRef; arrow
// endpoints come from getBoundingClientRect which isn't a Vue dep. After the
// DOM has applied the new scale we bump the tick so the arrow render runs
// again with fresh rects. Without this, the first render after a zoom click
// measures the pre-scale DOM and arrows stay at their old positions until
// the user pans/interacts.
watch(zoom, () => {
  nextTick(() => {
    arrowGeometryTick.value++
  })
})

/** Get the final visual position of an item: placement + transient drag delta.
 *  Uses transform (GPU-accelerated) instead of left/top (triggers layout). */
function getItemStyle(key: string) {
  const pos = placement.getPosition(key)
  const delta = getDragDelta(key)
  const anyDragActive = getActiveDragKey() !== null
  const isSettling = settlingKeys.has(key)
  const noPosition = !pos
  const effectivePos = pos ?? { x: 0, y: 0 }
  return {
    position: 'absolute' as const,
    transform: `translate(${effectivePos.x + delta.x}px, ${effectivePos.y + delta.y}px)`,
    willChange: anyDragActive ? 'transform' : 'auto',
    // No transition during drag, settling (newly placed), or before first position
    transition: anyDragActive || isSettling || noPosition ? 'none' : 'transform 100ms ease-out',
    // Hide items that don't have a position yet (before measureAndPlace runs)
    ...(noPosition && { visibility: 'hidden' as const }),
  }
}

// ---- DS item enter/leave animations (runs after placement in onUpdated) ----

/** Animate fade-in for newly appeared items and fade-out for removed items. */
function animateEnterLeave(els: NodeListOf<HTMLElement>) {
  if (!contentRef.value)
    return
  const currentKeys = new Set<string>()

  for (const el of els) {
    const key = el.dataset.placeKey!
    currentKeys.add(key)
    // New item: fade in and mark settling (suppress movement transition)
    if (!prevActiveKeys.has(key)) {
      settlingKeys.add(key)
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
      requestAnimationFrame(() => requestAnimationFrame(() => settlingKeys.delete(key)))
    }
  }

  prevActiveKeys = currentKeys
}

// ---- Arrow edges (computed from pointer graph + placement positions) ----

interface ArrowEdge {
  id: string
  fromKey: string
  toKey: string | undefined
  fieldAddress: number
  isCycle: boolean
  isDangling: false
  direction: FieldDirection
  color?: string
  arrowStyle?: ArrowStyle
  fallbackStyle?: ArrowStyle
  arrowAnchor?: ArrowAnchor
}

interface DanglingArrowEdge {
  id: string
  fromKey: string
  toKey: undefined
  fieldAddress: number
  isCycle: false
  isDangling: true
  danglingLabel: string
  direction: FieldDirection
  color?: string
  arrowStyle?: ArrowStyle
  fallbackStyle?: ArrowStyle
}

const arrowEdges = computed((): (ArrowEdge | DanglingArrowEdge)[] => {
  const edges: (ArrowEdge | DanglingArrowEdge)[] = []
  const graph = pointerGraph.value

  /** Look up the target struct's arrow anchor from struct-level metadata */
  function getTargetAnchor(targetAddress: number): ArrowAnchor | undefined {
    const targetNode = graph.nodes.get(targetAddress)
    if (!targetNode)
      return undefined
    return context.structMeta[targetNode.structName]?.arrowAnchor
  }

  for (const tree of graph.trees) {
    for (const edge of tree.edges) {
      const fromKey = addressToKey(edge.fromAddress)
      const toKey = addressToKey(edge.toAddress)
      if (fromKey && toKey) {
        edges.push({
          id: `${edge.fromFieldAddress}->${edge.toAddress}`,
          fromKey,
          toKey,
          fieldAddress: edge.fromFieldAddress,
          isCycle: false,
          isDangling: false,
          direction: edge.direction,
          color: edge.color,
          arrowStyle: edge.style,
          fallbackStyle: edge.fallbackStyle,
          arrowAnchor: getTargetAnchor(edge.toAddress),
        })
      }
    }
    for (const edge of tree.cycleEdges) {
      const fromKey = addressToKey(edge.fromAddress)
      const toKey = addressToKey(edge.toAddress)
      if (fromKey && toKey) {
        edges.push({
          id: `cycle-${edge.fromFieldAddress}->${edge.toAddress}`,
          fromKey,
          toKey,
          fieldAddress: edge.fromFieldAddress,
          isCycle: true,
          isDangling: false,
          direction: edge.direction,
          arrowStyle: 'bezier',
          arrowAnchor: getTargetAnchor(edge.toAddress),
        })
      }
    }
  }

  for (const edge of graph.danglingEdges) {
    const fromKey = addressToKey(edge.fromAddress)
    if (fromKey) {
      edges.push({
        id: `dangling-${edge.fromFieldAddress}`,
        fromKey,
        toKey: undefined,
        fieldAddress: edge.fromFieldAddress,
        isCycle: false,
        isDangling: true,
        danglingLabel: formatAddr(edge.toAddress),
        direction: edge.direction,
        color: edge.color,
        arrowStyle: edge.style,
        fallbackStyle: edge.fallbackStyle,
      })
    }
  }

  // Extra (non-tree) pointer edges: primitive pointer variables, struct
  // fields whose target is not a struct, etc. Rendered with direction
  // 'dynamic' so the arrow picks the nearest borders on both ends.
  for (const edge of graph.extraEdges) {
    const fromKey = addressToKey(edge.fromAddress)
    const toKey = addressToKey(edge.toAddress)
    if (fromKey && toKey) {
      edges.push({
        id: `extra-${edge.fromFieldAddress}->${edge.toAddress}`,
        fromKey,
        toKey,
        fieldAddress: edge.fromFieldAddress,
        isCycle: false,
        isDangling: false,
        direction: edge.direction,
        color: edge.color,
        arrowStyle: edge.style,
        fallbackStyle: edge.fallbackStyle,
        arrowAnchor: getTargetAnchor(edge.toAddress),
      })
    }
  }

  for (const edge of graph.extraDanglingEdges) {
    const fromKey = addressToKey(edge.fromAddress)
    if (fromKey) {
      edges.push({
        id: `extra-dangling-${edge.fromFieldAddress}`,
        fromKey,
        toKey: undefined,
        fieldAddress: edge.fromFieldAddress,
        isCycle: false,
        isDangling: true,
        danglingLabel: formatAddr(edge.toAddress),
        direction: edge.direction,
        color: edge.color,
        arrowStyle: edge.style,
        fallbackStyle: edge.fallbackStyle,
      })
    }
  }

  return edges
})

/**
 * Measure the vertical center of a field element within a placed item,
 * returning the Y position in content-coordinate space.
 */
function measureFieldY(parentKey: string, fieldAddress: number): number | undefined {
  if (!contentRef.value)
    return undefined
  const parentEl = contentRef.value.querySelector<HTMLElement>(`[data-place-key="${parentKey}"]`)
  if (!parentEl)
    return undefined
  const fieldEl = parentEl.querySelector<HTMLElement>(`[data-field-addr="${fieldAddress}"]`)
  if (!fieldEl)
    return undefined

  // Touch the tick so the render re-runs once the DOM has actually settled
  // into the new zoom scale. See arrowGeometryTick declaration for context.
  // eslint-disable-next-line ts/no-unused-expressions
  arrowGeometryTick.value
  const parentRect = parentEl.getBoundingClientRect()
  const fieldRect = fieldEl.getBoundingClientRect()
  // Offset within the parent + parent's content-space position.
  // getBoundingClientRect includes the canvas's CSS scale, so the raw screen
  // pixel offset must be divided by zoom to bring it back into content space
  // — otherwise at zoom 2x the arrow stems from 2× the correct field Y.
  const pos = placement.getPosition(parentKey)
  const delta = getDragDelta(parentKey)
  if (!pos)
    return undefined
  const fieldCenterScreen = (fieldRect.top + fieldRect.height / 2) - parentRect.top
  const z = zoom.value || 1
  return pos.y + delta.y + fieldCenterScreen / z
}

/** Get arrow props from a computed edge */
function getArrowProps(edge: ArrowEdge | DanglingArrowEdge) {
  const fromPos = placement.getPosition(edge.fromKey)
  const fromSize = placement.getSize(edge.fromKey)
  const fromDelta = getDragDelta(edge.fromKey)

  const adjustedFromPos = fromPos ? { x: fromPos.x + fromDelta.x, y: fromPos.y + fromDelta.y } : { x: 0, y: 0 }
  const adjustedFromSize = fromSize ?? { w: 0, h: 0 }
  // Dynamic arrows don't use field-aligned Y — they use nearest border
  const fromFieldY = edge.direction !== 'dynamic' ? measureFieldY(edge.fromKey, edge.fieldAddress) : undefined

  const common = {
    direction: edge.direction,
    color: edge.color,
    arrowStyle: edge.arrowStyle,
    fallbackStyle: edge.fallbackStyle,
  }

  if (edge.isDangling) {
    return {
      fieldAddress: edge.fieldAddress,
      isCycle: false as const,
      isDangling: true as const,
      fromPos: adjustedFromPos,
      fromSize: adjustedFromSize,
      fromFieldY,
      danglingLabel: (edge as DanglingArrowEdge).danglingLabel,
      ...common,
    }
  }

  const toPos = edge.toKey ? placement.getPosition(edge.toKey) : undefined
  const toSize = edge.toKey ? placement.getSize(edge.toKey) : undefined
  const toDelta = edge.toKey ? getDragDelta(edge.toKey) : { x: 0, y: 0 }

  return {
    fieldAddress: edge.fieldAddress,
    isCycle: edge.isCycle,
    isDangling: false as const,
    fromPos: adjustedFromPos,
    fromSize: adjustedFromSize,
    fromFieldY,
    toPos: toPos ? { x: toPos.x + toDelta.x, y: toPos.y + toDelta.y } : undefined,
    toSize: toSize ?? undefined,
    arrowAnchor: (edge as ArrowEdge).arrowAnchor,
    ...common,
  }
}

// ---- Auto-layout ----

function autoLayout() {
  // Clear positions (keep sizes) so measureAndPlace re-places from scratch.
  // Call measureAndPlace immediately so the re-render sees final positions
  // directly — no flash at (0,0).
  placement.clearPositions()
  prevChildToParent.clear()
  prevParentToChildren.clear()
  settlingKeys.clear()
  resetPan()
  measureAndPlace()
}

// ---- Auto-pan to cover content after placement ----

function autoPanToContent() {
  const bounds = placement.getContentBounds()
  const canvas = canvasRef.value
  if (!bounds || !canvas)
    return
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight

  // Center content in the viewport if it fits, otherwise align top-left with margin
  const contentW = bounds.maxX - bounds.minX
  const contentH = bounds.maxY - bounds.minY
  const margin = 16

  if (contentW <= cw && contentH <= ch) {
    // Content fits: center it
    panOffset.x = (cw - contentW) / 2 - bounds.minX
    panOffset.y = (ch - contentH) / 2 - bounds.minY
  }
  else {
    // Content overflows: align top-left with margin, prefer showing larger structures
    panOffset.x = margin - bounds.minX
    panOffset.y = margin - bounds.minY
  }
  clampPan()
}

// Auto-pan to selected node
watch(() => props.selectedAddress, (addr) => {
  if (addr === null)
    return
  panToElement(`[data-testid="ds-node-${addr}"], [data-testid="ds-item-${addr}"]`)
})

// ---- Pointer-arrow hover wiring ----

/** Resolve a byte address inside a pointer scalar to the memory-map arrow it
 *  represents. Returns null for non-pointer bytes, padding, or dead allocs.
 *  Mirrors ByteMap's syncPointerArrow so hovering a DS-view arrow / pointer
 *  card produces the same primary-emphasis arrow in MemoryMap. */
function pointerArrowFor(fieldAddr: number) {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion
  const info = context.memory.describeByte(fieldAddr)
  if (!info || info.isPadding || info.allocation.dead)
    return null
  const leafType = info.leafType
  if (typeof leafType !== 'object' || leafType.type !== 'pointer')
    return null
  try {
    const target = context.memory.readScalar(info.leafBase, leafType) as number
    return { source: info.leafBase, sourceSize: info.leafSize, target }
  }
  catch {
    return null
  }
}

/** Wired into <CanvasArrow @hover-field>. Extends the existing setField call
 *  (which highlights the field row / pointer card via `data-field-addr`) with
 *  a setPointerArrow so MemoryMap's arrow overlay lights up with primary
 *  emphasis for the same pointer. */
function onArrowHoverField(fieldAddress: number | null) {
  hover.setField(fieldAddress)
  if (fieldAddress === null) {
    hover.setPointerArrow(null)
    return
  }
  hover.setPointerArrow(pointerArrowFor(fieldAddress))
}

function onItemEnter(item: DataItem) {
  hover.setHover(item.address, 'ds')
  if (item.varName)
    emit('hoverVariable', item.varName)
  // Hovering a primitive pointer card mirrors the effect of hovering its
  // byte in ByteMap — MemoryMap draws the primary arrow.
  if (item.kind === 'pointer')
    hover.setPointerArrow(pointerArrowFor(item.address))
}

function onItemLeave() {
  hover.setHover(null, null)
  emit('hoverVariable', null)
}

/** True when a CanvasArrow hover is pointing at the pointer this card holds
 *  (primitive pointer items only — struct fields already highlight via
 *  `data-field-addr` inside DSValue). */
function isArrowSourceItem(item: DataItem): boolean {
  return item.kind === 'pointer' && hover.fieldAddress.value === item.address
}

// ---- Color/shape for types ----

const kindColors: Record<DataItem['kind'], string> = {
  int: 'border-blue-400 dark:border-blue-500',
  float: 'border-amber-400 dark:border-amber-500',
  char: 'border-purple-400 dark:border-purple-500',
  bool: 'border-rose-400 dark:border-rose-500',
  pointer: 'border-green-400 dark:border-green-500',
  struct: 'border-cyan-400 dark:border-cyan-500',
  array: 'border-orange-400 dark:border-orange-500',
}

const kindBg: Record<DataItem['kind'], string> = {
  int: 'bg-blue-500/5',
  float: 'bg-amber-500/5',
  char: 'bg-purple-500/5',
  bool: 'bg-rose-500/5',
  pointer: 'bg-green-500/5',
  struct: 'bg-cyan-500/5',
  array: 'bg-orange-500/5',
}
</script>

<template>
  <div
    ref="canvasRef"
    data-testid="ds-view"
    class="relative h-full select-none overflow-hidden p-2"
    :class="hasContent ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''"
  >
    <!-- Tool bar: zoom + auto-layout. Absolutely positioned so the pannable
         canvas surface underneath stays un-obstructed by layout. -->
    <div
      v-if="hasContent"
      class="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded bg-gray-200/80 p-0.5 text-gray-500 shadow-sm dark:bg-gray-700/80"
    >
      <button
        class="rounded p-1 transition-colors hover:bg-gray-300/80 hover:text-gray-700 dark:hover:bg-gray-600/80 dark:hover:text-gray-300"
        title="Zoom out (Cmd/Ctrl+scroll)"
        @click="zoomOut()"
      >
        <div class="i-carbon-zoom-out h-3.5 w-3.5" />
      </button>
      <button
        class="min-w-10 rounded px-1 text-[10px] font-mono transition-colors hover:bg-gray-300/80 hover:text-gray-700 dark:hover:bg-gray-600/80 dark:hover:text-gray-300"
        title="Reset zoom"
        @click="resetZoom()"
      >
        {{ Math.round(zoom * 100) }}%
      </button>
      <button
        class="rounded p-1 transition-colors hover:bg-gray-300/80 hover:text-gray-700 dark:hover:bg-gray-600/80 dark:hover:text-gray-300"
        title="Zoom in (Cmd/Ctrl+scroll)"
        @click="zoomIn()"
      >
        <div class="i-carbon-zoom-in h-3.5 w-3.5" />
      </button>
      <span class="mx-0.5 h-4 w-px bg-gray-400/40" />
      <button
        class="rounded p-1 transition-colors hover:bg-gray-300/80 hover:text-gray-700 dark:hover:bg-gray-600/80 dark:hover:text-gray-300"
        title="Auto-layout"
        @click="autoLayout"
      >
        <div class="i-carbon-flow h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Empty state (outside the pan-transformed layer so it stays centered) -->
    <div v-if="!hasContent" class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-500 italic">
      No data to display
    </div>

    <div
      ref="contentRef"
      :style="{
        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
        // Scale around the content's top-left so the pan offset formula
        // (`pan + p*z`) matches the CSS transform composition.
        transformOrigin: '0 0',
      }"
      class="relative"
    >
      <!-- Data items -->
      <div class="contents">
        <div
          v-for="item in standaloneItems"
          :key="item.address"
          :data-testid="`ds-item-${item.address}`"
          :data-drag-key="`item-${item.address}`"
          :data-place-key="`item-${item.address}`"
          class="cursor-pointer border-2 rounded p-1.5 text-xs font-mono transition-colors"
          :class="[
            kindColors[item.kind],
            kindBg[item.kind],
            isNodeSelected(item.address) ? 'outline outline-2 outline-blue-400' : '',
            isHoverBoosted(item.address) ? 'bg-blue-500/20!' : '',
            !isHoverBoosted(item.address) && isStatementLhs(item.address) ? 'bg-blue-500/10!' : '',
            !isHoverBoosted(item.address) && isStatementRhs(item.address) && !isStatementLhs(item.address) ? 'bg-green-500/10!' : '',
            !hasCodeHighlight(item.address) && isArrowSourceItem(item) ? 'bg-blue-500/15! ring-1 ring-blue-400/40' : '',
            !hasCodeHighlight(item.address) && isNodeHighlighted(item.address) && !isArrowSourceItem(item) ? 'bg-blue-500/10!' : '',
            item.dimmed ? 'opacity-40' : '',
          ]"
          :style="getItemStyle(`item-${item.address}`)"
          @click="!didDrag && emit('selectNode', item.address)"
          @pointerenter="onItemEnter(item)"
          @pointerleave="onItemLeave()"
        >
          <div class="mb-0.5 flex items-baseline gap-1.5 text-[10px]">
            <span class="text-gray-600 font-semibold dark:text-gray-400">{{ item.label }}</span>
            <span class="text-gray-400">{{ formatAddr(item.address) }}</span>
          </div>
          <DSValue
            :address="item.address"
            :type="item.type"
            :highlighted-field-address="hover.fieldAddress.value"
            :statement-lhs-addresses="statementLhsAddresses"
            :statement-rhs-addresses="statementRhsAddresses"
            @navigate="emit('selectNode', $event)"
            @hover-node="hover.setHover($event, 'ds')"
          />
        </div>
      </div>

      <!-- SVG arrow overlay (after items so it paints on top; h-[1px]/w-[1px] gives it
           a non-zero paint area — browsers skip rendering 0×0 SVGs even with overflow-visible) -->
      <svg v-if="arrowEdges.length > 0" class="pointer-events-none absolute left-0 top-0 z-10 h-[1px] w-[1px] overflow-visible">
        <CanvasArrow
          v-for="edge in arrowEdges"
          :key="edge.id"
          v-bind="getArrowProps(edge)"
          @hover-field="onArrowHoverField"
        />
      </svg>
    </div>
  </div>
</template>
