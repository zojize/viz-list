<script setup lang="ts">
import type { ArrowAnchor, ArrowStyle, CppType, CppValue, FieldDirection, MemoryCell } from '~/composables/interpreter/types'
import { computed, nextTick, onUpdated, shallowRef, watch } from 'vue'
import CanvasArrow from '~/components/CanvasArrow.vue'
import DSValue from '~/components/DSValue.vue'
import LinkedListChain from '~/components/LinkedListChain.vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import { usePannableCanvas } from '~/composables/usePannableCanvas'
import { usePlacementEngine } from '~/composables/usePlacementEngine'
import { usePointerGraph } from '~/composables/usePointerGraph'

const props = defineProps<{
  highlightedAddress?: number | null
  selectedAddress?: number | null
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
  hoverVariable: [name: string | null]
}>()

const context = useInterpreterContext()
const pointerGraph = usePointerGraph(context)

// ---- Format helpers ----

function formatAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(3, '0')}`
}

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : formatAddr(value.address)
    if (value.type === 'struct')
      return `${value.name} {...}`
    if (value.type === 'array')
      return `[${value.length}]`
  }
  return String(value)
}

function formatType(type: CppType): string {
  if (typeof type === 'string')
    return type
  if (type.type === 'pointer')
    return `${formatType(type.to)}*`
  if (type.type === 'array')
    return `${formatType(type.of)}[${type.size}]`
  if (type.type === 'struct')
    return type.name
  return '?'
}

// ---- Helpers to read memory ----

function getNodeDef() {
  return context.structs.Node
}

function readNodeField(nodeBase: number, fieldName: string): CppValue | undefined {
  const nodeDef = getNodeDef()
  if (!nodeDef)
    return undefined
  const idx = Object.keys(nodeDef).indexOf(fieldName)
  if (idx === -1)
    return undefined
  return context.memory.cells.get(nodeBase + 1 + idx)?.value
}

function getNodeFieldAddress(nodeBase: number, fieldName: string): number | undefined {
  const nodeDef = getNodeDef()
  if (!nodeDef)
    return undefined
  const idx = Object.keys(nodeDef).indexOf(fieldName)
  if (idx === -1)
    return undefined
  return nodeBase + 1 + idx
}

function getPointerAddr(value: CppValue | undefined): number | null {
  if (!value || typeof value !== 'object' || value.type !== 'pointer')
    return null
  return value.address === NULL_ADDRESS ? null : value.address
}

function getNodeBase(address: number): number {
  const cell = context.memory.cells.get(address)
  if (!cell)
    return address
  const v = cell.value
  return (typeof v === 'object' && v.type === 'struct') ? v.base : address
}

// ---- Build linked list chains ----

interface ChainNode {
  address: number
  base: number
  data: string
  nextAddr: number | null
  prevAddr: number | null
  nextFieldAddress: number | undefined
  prevFieldAddress: number | undefined
}

interface ListChain {
  id: string
  nodes: ChainNode[]
}

const hasPrev = computed(() => !!getNodeDef()?.prev)

function buildChainNode(address: number): ChainNode {
  const base = getNodeBase(address)
  const data = readNodeField(base, 'data')
  const next = readNodeField(base, 'next')
  const prev = hasPrev.value ? readNodeField(base, 'prev') : undefined
  return {
    address,
    base,
    data: data !== undefined ? String(data) : '?',
    nextAddr: getPointerAddr(next),
    prevAddr: hasPrev.value ? getPointerAddr(prev) : null,
    nextFieldAddress: getNodeFieldAddress(base, 'next'),
    prevFieldAddress: hasPrev.value ? getNodeFieldAddress(base, 'prev') : undefined,
  }
}

function followNextChain(startAddr: number, limit = 100): ChainNode[] {
  const nodes: ChainNode[] = []
  let cur: number | null = startAddr
  const seen = new Set<number>()
  while (cur !== null && nodes.length < limit) {
    if (seen.has(cur))
      break
    seen.add(cur)
    const cell = context.memory.cells.get(cur)
    if (!cell || cell.dead)
      break
    const node = buildChainNode(cur)
    nodes.push(node)
    cur = node.nextAddr
  }
  return nodes
}

const chains = computed((): ListChain[] => {
  const nodeDef = getNodeDef()
  if (!nodeDef)
    return []

  const startingPoints = new Map<number, string>()
  const listDef = context.structs.LinkedList
  if (listDef) {
    const seenBases = new Set<number>()
    for (const cell of context.memory.cells.values()) {
      if (cell.dead || typeof cell.type !== 'object' || cell.type.type !== 'struct' || cell.type.name !== 'LinkedList')
        continue
      const v = cell.value
      if (typeof v !== 'object' || v.type !== 'struct')
        continue
      if (seenBases.has(v.base))
        continue
      seenBases.add(v.base)
      for (const fieldName of Object.keys(listDef)) {
        const idx = Object.keys(listDef).indexOf(fieldName)
        const fieldCell = context.memory.cells.get(v.base + 1 + idx)
        if (fieldCell && typeof fieldCell.value === 'object' && fieldCell.value.type === 'pointer' && fieldCell.value.address !== NULL_ADDRESS) {
          startingPoints.set(fieldCell.value.address, fieldName)
        }
      }
    }
  }

  const result: ListChain[] = []
  const seenSignatures = new Set<string>()
  const coveredAddresses = new Set<number>()

  for (const [startAddr, label] of startingPoints) {
    const nodes = followNextChain(startAddr)
    if (nodes.length === 0)
      continue
    const sig = nodes.map(n => n.address).sort((a, b) => a - b).join(',')
    if (seenSignatures.has(sig))
      continue
    seenSignatures.add(sig)
    for (const n of nodes)
      coveredAddresses.add(n.address)
    result.push({ id: `${label}-${startAddr}`, nodes })
  }

  for (const cell of context.memory.cells.values()) {
    if (cell.dead || cell.region !== 'heap')
      continue
    if (typeof cell.type !== 'object' || cell.type.type !== 'struct' || cell.type.name !== 'Node')
      continue
    if (coveredAddresses.has(cell.address))
      continue
    const nodes = followNextChain(cell.address)
    if (nodes.length === 0)
      continue
    const sig = nodes.map(n => n.address).sort((a, b) => a - b).join(',')
    if (seenSignatures.has(sig))
      continue
    seenSignatures.add(sig)
    for (const n of nodes)
      coveredAddresses.add(n.address)
    result.push({ id: `orphan-${cell.address}`, nodes })
  }

  const filtered = result.filter((chain, i) => {
    return !result.some((other, j) => {
      if (i === j || other.nodes.length <= chain.nodes.length)
        return false
      return chain.nodes.every(n => other.nodes.some(o => o.address === n.address))
    })
  })

  return filtered
})

// ---- Standalone data items (in-scope stack + live heap, not part of chains) ----

interface DataItem {
  address: number
  cell: MemoryCell
  label: string
  kind: 'int' | 'float' | 'char' | 'bool' | 'pointer' | 'struct' | 'array'
  display: string
  dimmed: boolean
  /** Variable name for editor highlighting (only for stack variables) */
  varName: string | null
}

/** Addresses already shown as part of a linked list chain */
const chainAddresses = computed(() => {
  const s = new Set<number>()
  for (const chain of chains.value) {
    for (const node of chain.nodes)
      s.add(node.address)
  }
  return s
})

/** Addresses that are struct fields or array elements (sub-cells) */
function getSubCellAddresses(): Set<number> {
  const sub = new Set<number>()
  for (const cell of context.memory.cells.values()) {
    if (cell.dead)
      continue
    const v = cell.value
    if (typeof v === 'object' && v.type === 'struct') {
      const structDef = context.structs[v.name]
      if (structDef) {
        for (let i = 0; i < Object.keys(structDef).length; i++)
          sub.add(v.base + 1 + i)
      }
    }
    else if (typeof v === 'object' && v.type === 'array') {
      for (let i = 0; i < v.length; i++)
        sub.add(v.base + 1 + i)
    }
  }
  return sub
}

function getKind(cell: MemoryCell): DataItem['kind'] {
  const t = cell.type
  if (typeof t === 'string') {
    if (t === 'float' || t === 'double')
      return 'float'
    if (t === 'char')
      return 'char'
    if (t === 'bool')
      return 'bool'
    return 'int'
  }
  if (t.type === 'pointer')
    return 'pointer'
  if (t.type === 'array')
    return 'array'
  return 'struct'
}

const standaloneItems = computed((): DataItem[] => {
  const items: DataItem[] = []
  const subCells = getSubCellAddresses()
  const seen = new Set<number>()

  function addItem(name: string, cell: MemoryCell, dimmed: boolean, varName: string | null = null) {
    if (cell.dead || seen.has(cell.address))
      return
    if (chainAddresses.value.has(cell.address))
      return
    if (subCells.has(cell.address))
      return
    seen.add(cell.address)
    items.push({
      address: cell.address,
      cell,
      label: name,
      kind: getKind(cell),
      display: formatValue(cell.value),
      dimmed,
      varName,
    })
  }

  // Current scope variables (not dimmed)
  for (let i = context.envStack.length - 1; i >= 0; i--) {
    const env = context.envStack[i]
    for (const [name, entry] of Object.entries(env)) {
      const cell = context.memory.cells.get(entry.address)
      if (cell)
        addItem(name, cell, false, name)
    }
  }

  // Caller scope variables (dimmed)
  for (let ci = context.callStack.length - 1; ci >= 0; ci--) {
    const savedEnvs = context.callStack[ci].env
    for (let i = savedEnvs.length - 1; i >= 0; i--) {
      const env = savedEnvs[i]
      for (const [name, entry] of Object.entries(env)) {
        const cell = context.memory.cells.get(entry.address)
        if (cell)
          addItem(name, cell, true, name)
      }
    }
  }

  // Live heap data not in chains
  for (const cell of context.memory.cells.values()) {
    if (cell.dead || cell.region !== 'heap')
      continue
    addItem(formatType(cell.type), cell, false)
  }

  return items
})

// ---- Whether anything is shown ----

const hasContent = computed(() => chains.value.length > 0 || standaloneItems.value.length > 0)

function isNodeHighlighted(address: number): boolean {
  return props.highlightedAddress === address
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

const {
  panOffset,
  isPanning,
  didDrag,
  getDragDelta,
  getActiveDragKey,
  panToElement,
  resetPan,
  clampPan,
} = usePannableCanvas({
  canvasRef,
  hasContent: () => hasContent.value,
  onDragEnd(key, dx, dy) {
    const pos = placementRef?.getPosition(key)
    if (pos) {
      placementRef?.setPosition(key, pos.x + dx, pos.y + dy)
      placementRef?.markUserDragged(key)
    }
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

/** Map from struct base address to placement key for tree items */
function addressToKey(address: number): string | undefined {
  // Check chains first
  for (const chain of chains.value) {
    for (const node of chain.nodes) {
      if (node.address === address)
        return chain.id
    }
  }
  // Check standalone items
  for (const item of standaloneItems.value) {
    if (item.address === address)
      return `item-${item.address}`
  }
  return undefined
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
    if (!oldChildren || oldChildren.size !== newChildren.size
      || [...newChildren].some(k => !oldChildren.has(k))) {
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

/** Measure and place all visible items with tree-aware layout */
function measureAndPlace() {
  if (!contentRef.value)
    return
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

    // Place root normally
    const rootSize = measured.get(rootKey)!
    placement.placeNew(rootKey, rootSize.w, rootSize.h)
    treePlacedKeys.add(rootKey)

    // Recursively place children
    placeTreeChildren(tree.rootAddress, rootKey, tree, measured, treePlacedKeys)
  }

  // Step 2.5: Evict non-tree items whose positions now overlap with tree items.
  // This happens when a new tree edge forms and placeRelative puts a child
  // where a standalone item was already sitting from a prior render.
  if (treePlacedKeys.size > 0)
    placement.evictOverlapping(treePlacedKeys)

  // Step 3: Place remaining items (chains not in trees, standalone items)
  for (const el of els) {
    const key = el.dataset.placeKey!
    if (treePlacedKeys.has(key))
      continue
    const size = measured.get(key)!
    placement.placeNew(key, size.w, size.h)
  }

  // Step 4: Retain only active keys
  const activeKeys = new Set<string>()
  for (const el of els)
    activeKeys.add(el.dataset.placeKey!)
  placement.retainOnly(activeKeys)
}

/** Recursively place children of a tree node via placeRelative */
function placeTreeChildren(
  parentAddress: number,
  parentKey: string,
  tree: typeof pointerGraph.value.trees[number],
  measured: Map<string, { w: number, h: number }>,
  placedKeys: Set<string>,
) {
  const parentNode = pointerGraph.value.nodes.get(parentAddress)
  if (!parentNode)
    return

  const childEdges = tree.edges.filter(e => e.fromAddress === parentAddress)
  if (childEdges.length === 0)
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
      placeTreeChildren(child.address, child.key, tree, measured, placedKeys)
    }
  }

  placeGroup(rightChildren, 'right')
  placeGroup(leftChildren, 'left')

  // Dynamic children: no preferred placement — use standalone positioning
  for (const child of dynamicChildren) {
    const size = measured.get(child.key)!
    placement.placeNew(child.key, size.w, size.h)
    placedKeys.add(child.key)
    placeTreeChildren(child.address, child.key, tree, measured, placedKeys)
  }
}

/** Snapshot of content bounds before placement, used to detect layout shifts */
let prevBoundsKey = ''

/** Items still settling — suppress movement transition until placed at real position. */
const settlingKeys = new Set<string>()
/** Previous set of active keys — used to detect enter/leave for animations. */
let prevActiveKeys = new Set<string>()

onUpdated(() => nextTick(() => {
  measureAndPlace()
  animateEnterLeave()

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
      if (bounds.minX < viewLeft || bounds.minY < viewTop
        || bounds.maxX > viewRight || bounds.maxY > viewBottom) {
        autoPanToContent()
      }
    }
  }

  clampPan()
}))

// Reset pan when DS view becomes empty
watch(hasContent, (has) => {
  if (!has)
    resetPan()
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
function animateEnterLeave() {
  if (!contentRef.value)
    return
  const els = contentRef.value.querySelectorAll<HTMLElement>('[data-place-key]')
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

  // Removed items: clone at last position and fade out
  for (const key of prevActiveKeys) {
    if (currentKeys.has(key))
      continue
    const pos = placement.getPosition(key)
    const size = placement.getSize(key)
    if (!pos || !size || !contentRef.value)
      continue
    const ghost = document.createElement('div')
    // Find the last rendered element to clone its innerHTML
    // Use a minimal placeholder since the original DOM is gone
    ghost.style.cssText = `position:absolute;transform:translate(${pos.x}px,${pos.y}px);width:${size.w}px;height:${size.h}px;pointer-events:none;`
    contentRef.value.appendChild(ghost)
    const anim = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' })
    anim.finished.then(() => ghost.remove())
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

  const parentRect = parentEl.getBoundingClientRect()
  const fieldRect = fieldEl.getBoundingClientRect()
  // Offset within the parent + parent's content-space position
  const pos = placement.getPosition(parentKey)
  const delta = getDragDelta(parentKey)
  if (!pos)
    return undefined
  const fieldCenterOffset = (fieldRect.top + fieldRect.height / 2) - parentRect.top
  return pos.y + delta.y + fieldCenterOffset
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
  // clear() wipes positions + sizes + userDragged, bumps version.
  // The version bump triggers a Vue re-render → onUpdated → measureAndPlace,
  // which re-places everything from scratch (no existing positions to skip).
  placement.clear()
  prevChildToParent.clear()
  prevParentToChildren.clear()
  settlingKeys.clear()
  resetPan()
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
    <!-- Auto-layout button -->
    <button
      v-if="hasContent"
      class="absolute right-2 top-2 z-10 rounded bg-gray-200/80 p-1 text-gray-500 transition-colors dark:bg-gray-700/80 hover:bg-gray-300/80 hover:text-gray-700 dark:hover:bg-gray-600/80 dark:hover:text-gray-300"
      title="Auto-layout"
      @click="autoLayout"
    >
      <div class="i-carbon-flow h-3.5 w-3.5" />
    </button>

    <div ref="contentRef" :style="{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }" class="relative">
      <div v-if="!hasContent" class="text-sm text-gray-500 italic">
        No data to display
      </div>

      <!-- Linked list chains -->
      <div class="contents">
        <LinkedListChain
          v-for="chain in chains"
          :key="chain.id"
          :data-testid="`chain-${chain.id}`"
          :data-drag-key="chain.id"
          :data-place-key="chain.id"
          :nodes="chain.nodes"
          :has-prev="hasPrev"
          :highlighted-address="highlightedAddress"
          :selected-address="selectedAddress"
          :statement-lhs-addresses="statementLhsAddresses"
          :statement-rhs-addresses="statementRhsAddresses"
          :did-drag="didDrag"
          :style="getItemStyle(chain.id)"
          @select-node="emit('selectNode', $event)"
          @hover-node="emit('hoverNode', $event)"
          @hover-field="emit('hoverField', $event)"
        />
      </div>

      <!-- Standalone data items -->
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
            !hasCodeHighlight(item.address) && isNodeHighlighted(item.address) ? 'bg-blue-500/10!' : '',
            item.dimmed ? 'opacity-40' : '',
          ]"
          :style="getItemStyle(`item-${item.address}`)"
          @click="!didDrag && emit('selectNode', item.address)"
          @pointerenter="emit('hoverNode', item.address); item.varName && emit('hoverVariable', item.varName)"
          @pointerleave="emit('hoverNode', null); emit('hoverVariable', null)"
        >
          <div class="mb-0.5 flex items-baseline gap-1.5 text-[10px]">
            <span class="text-gray-600 font-semibold dark:text-gray-400">{{ item.label }}</span>
            <span class="text-gray-400">{{ formatAddr(item.address) }}</span>
          </div>
          <DSValue
            :cell="item.cell"
            @navigate="emit('selectNode', $event)"
            @hover-node="emit('hoverNode', $event)"
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
          @hover-field="emit('hoverField', $event)"
        />
      </svg>
    </div>
  </div>
</template>
