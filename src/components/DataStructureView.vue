<script setup lang="ts">
import type { CppType, CppValue, InterpreterContext, MemoryCell } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  highlightedAddress?: number | null
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
}>()

const hoveredArrow = shallowRef<{ source: number, target: number | null, type: string, fieldAddress: number } | null>(null)

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
  return props.context.structs.Node
}

function readNodeField(nodeBase: number, fieldName: string): CppValue | undefined {
  const nodeDef = getNodeDef()
  if (!nodeDef)
    return undefined
  const idx = Object.keys(nodeDef).indexOf(fieldName)
  if (idx === -1)
    return undefined
  return props.context.memory.cells.get(nodeBase + 1 + idx)?.value
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
  const cell = props.context.memory.cells.get(address)
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
    const cell = props.context.memory.cells.get(cur)
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
  const listDef = props.context.structs.LinkedList
  if (listDef) {
    const seenBases = new Set<number>()
    for (const cell of props.context.memory.cells.values()) {
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
        const fieldCell = props.context.memory.cells.get(v.base + 1 + idx)
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

  for (const cell of props.context.memory.cells.values()) {
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
  for (const cell of props.context.memory.cells.values()) {
    if (cell.dead)
      continue
    const v = cell.value
    if (typeof v === 'object' && v.type === 'struct') {
      const structDef = props.context.structs[v.name]
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

  // In-scope stack variables
  for (let i = props.context.envStack.length - 1; i >= 0; i--) {
    const env = props.context.envStack[i]
    for (const [name, entry] of Object.entries(env)) {
      const cell = props.context.memory.cells.get(entry.address)
      if (!cell || cell.dead)
        continue
      if (chainAddresses.value.has(cell.address))
        continue
      if (subCells.has(cell.address))
        continue
      items.push({
        address: cell.address,
        cell,
        label: name,
        kind: getKind(cell),
        display: formatValue(cell.value),
      })
    }
  }

  // Live heap data not in chains
  for (const cell of props.context.memory.cells.values()) {
    if (cell.dead || cell.region !== 'heap')
      continue
    if (chainAddresses.value.has(cell.address))
      continue
    if (subCells.has(cell.address))
      continue
    items.push({
      address: cell.address,
      cell,
      label: formatType(cell.type),
      kind: getKind(cell),
      display: formatValue(cell.value),
    })
  }

  return items
})

/** Array items need special rendering — read their elements */
function getArrayElements(cell: MemoryCell): { address: number, value: CppValue }[] {
  const v = cell.value
  if (typeof v !== 'object' || v.type !== 'array')
    return []
  const elems: { address: number, value: CppValue }[] = []
  for (let i = 0; i < v.length; i++) {
    const elemCell = props.context.memory.cells.get(v.base + 1 + i)
    elems.push({ address: v.base + 1 + i, value: elemCell?.value ?? 0 })
  }
  return elems
}

// ---- Whether anything is shown ----

const hasContent = computed(() => chains.value.length > 0 || standaloneItems.value.length > 0)

// ---- Cross-chain logic ----

const allNodeAddresses = computed(() => {
  const chainMap = new Map<number, number[]>()
  chains.value.forEach((chain, ci) => {
    for (const node of chain.nodes) {
      if (!chainMap.has(node.address))
        chainMap.set(node.address, [])
      chainMap.get(node.address)!.push(ci)
    }
  })
  return chainMap
})

function isNodeInDifferentChain(address: number | null, currentChainIdx: number): boolean {
  if (address === null)
    return false
  const indices = allNodeAddresses.value.get(address)
  return !!indices && indices.some(ci => ci !== currentChainIdx)
}

function isNodeHighlighted(address: number): boolean {
  if (props.highlightedAddress === address)
    return true
  if (hoveredArrow.value && (hoveredArrow.value.source === address || hoveredArrow.value.target === address))
    return true
  return false
}

function isNodeSelected(address: number): boolean {
  return props.selectedAddress === address
}

function handleArrowEnter(source: number, target: number | null, type: string, fieldAddress: number | undefined) {
  hoveredArrow.value = { source, target, type, fieldAddress: fieldAddress ?? 0 }
  if (fieldAddress)
    emit('hoverField', fieldAddress)
}

function handleArrowLeave() {
  hoveredArrow.value = null
  emit('hoverField', null)
}

// ---- Pannable canvas ----

const canvasRef = shallowRef<HTMLElement | null>(null)
const panOffset = reactive({ x: 0, y: 0 })
const isPanning = shallowRef(false)
const panStart = reactive({ x: 0, y: 0, ox: 0, oy: 0 })

// ---- Draggable items ----

const dragOffsets = reactive(new Map<string, { x: number, y: number }>())
const dragging = shallowRef<{ key: string, pointerId: number } | null>(null)
const dragStart = reactive({ x: 0, y: 0, ox: 0, oy: 0 })

function getDragOffset(key: string): { x: number, y: number } {
  return dragOffsets.get(key) ?? { x: 0, y: 0 }
}

/** Find the drag key for an element (chain id or item key), or null for non-draggable. */
function getDragKey(el: HTMLElement): string | null {
  const chain = el.closest('[data-drag-key]') as HTMLElement | null
  return chain?.dataset.dragKey ?? null
}

function onPointerDown(e: PointerEvent) {
  if (!hasContent.value)
    return

  // Left-click on a draggable item → prepare drag (no pointer capture so clicks still work)
  if (e.button === 0) {
    const dragKey = getDragKey(e.target as HTMLElement)
    if (dragKey) {
      dragging.value = { key: dragKey, pointerId: e.pointerId }
      const offset = getDragOffset(dragKey)
      dragStart.x = e.clientX
      dragStart.y = e.clientY
      dragStart.ox = offset.x
      dragStart.oy = offset.y
      // No setPointerCapture here — that would redirect click events away from child nodes
      return
    }
  }

  // Middle-click anywhere, or left-click on empty canvas → pan
  if (e.button === 1 || e.button === 0) {
    isPanning.value = true
    panStart.x = e.clientX
    panStart.y = e.clientY
    panStart.ox = panOffset.x
    panStart.oy = panOffset.y
    canvasRef.value?.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
}

const didDrag = shallowRef(false)

function onPointerMove(e: PointerEvent) {
  if (dragging.value) {
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (Math.abs(dx) >= 4 || Math.abs(dy) >= 4) {
      didDrag.value = true
      dragOffsets.set(dragging.value.key, {
        x: dragStart.ox + dx,
        y: dragStart.oy + dy,
      })
    }
    return
  }
  if (isPanning.value) {
    panOffset.x = panStart.ox + (e.clientX - panStart.x)
    panOffset.y = panStart.oy + (e.clientY - panStart.y)
  }
}

function onPointerUp() {
  isPanning.value = false
  dragging.value = null
  // Reset drag flag after a tick so click handlers can check it
  nextTick(() => {
    didDrag.value = false
  })
}

// Auto-pan to selected node
watch(() => props.selectedAddress, (addr) => {
  if (addr === null || !canvasRef.value)
    return
  nextTick(() => nextTick(() => {
    const el = canvasRef.value?.querySelector(`[data-testid="ds-node-${addr}"], [data-testid="ds-item-${addr}"]`) as HTMLElement | null
    if (!el || !canvasRef.value)
      return
    const container = canvasRef.value.getBoundingClientRect()
    const node = el.getBoundingClientRect()

    const margin = 16
    const clippedLeft = node.left < container.left + margin
    const clippedRight = node.right > container.right - margin
    const clippedTop = node.top < container.top + margin
    const clippedBottom = node.bottom > container.bottom - margin

    if (!clippedLeft && !clippedRight && !clippedTop && !clippedBottom)
      return

    if (clippedLeft || clippedRight) {
      const nodeXInContent = node.left - container.left - panOffset.x
      panOffset.x = -(nodeXInContent - container.width / 2 + node.width / 2)
    }

    if (clippedTop || clippedBottom) {
      const nodeYInContent = node.top - container.top - panOffset.y
      panOffset.y = -(nodeYInContent - container.height / 2 + node.height / 2)
    }
  }))
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
    class="h-full select-none overflow-hidden p-2"
    :class="hasContent ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div :style="{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }" class="inline-flex flex-col gap-3">
      <div v-if="!hasContent" class="text-sm text-gray-500 italic">
        No data to display
      </div>

      <!-- Linked list chains -->
      <div
        v-for="(chain, chainIdx) in chains"
        :key="chain.id"
        :data-testid="`chain-${chain.id}`"
        :data-drag-key="chain.id"
        class="relative flex items-center gap-0 py-3 pl-2"
        :style="{
          transform: `translate(${getDragOffset(chain.id).x}px, ${getDragOffset(chain.id).y}px)`,
        }"
      >
        <!-- First node's prev pointer -->
        <template v-if="hasPrev && chain.nodes.length > 0">
          <span
            class="shrink-0 cursor-pointer px-1 text-xs font-mono hover:underline"
            :class="chain.nodes[0].prevAddr === null ? 'text-red-400 opacity-60' : 'text-orange-400'"
            @pointerenter="handleArrowEnter(chain.nodes[0].address, chain.nodes[0].prevAddr, 'prev', chain.nodes[0].prevFieldAddress)"
            @pointerleave="handleArrowLeave()"
          >{{ chain.nodes[0].prevAddr === null ? 'NULL' : formatAddr(chain.nodes[0].prevAddr) }}</span>
          <span
            class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-orange-400 hover:text-orange-300"
            @pointerenter="handleArrowEnter(chain.nodes[0].address, chain.nodes[0].prevAddr, 'prev', chain.nodes[0].prevFieldAddress)"
            @pointerleave="handleArrowLeave()"
          >&#8592;</span>
        </template>

        <template v-for="(node, i) in chain.nodes" :key="node.address">
          <!-- Arrows between nodes -->
          <div v-if="i > 0" class="flex shrink-0 flex-col items-center">
            <span
              class="shrink-0 cursor-pointer px-1 py-0.5 text-sm transition-opacity hover:opacity-100"
              :class="{
                'text-green-400': !isNodeInDifferentChain(node.address, chainIdx),
                'text-green-400/30': isNodeInDifferentChain(node.address, chainIdx),
              }"
              @pointerenter="handleArrowEnter(chain.nodes[i - 1].address, node.address, 'next', chain.nodes[i - 1].nextFieldAddress)"
              @pointerleave="handleArrowLeave()"
            >&#8594;</span>
            <span
              v-if="hasPrev"
              class="shrink-0 cursor-pointer px-1 py-0.5 text-sm transition-opacity hover:opacity-100"
              :class="{
                'text-orange-400': !isNodeInDifferentChain(chain.nodes[i - 1].address, chainIdx),
                'text-orange-400/30': isNodeInDifferentChain(chain.nodes[i - 1].address, chainIdx),
              }"
              @pointerenter="handleArrowEnter(node.address, chain.nodes[i - 1].address, 'prev', node.prevFieldAddress)"
              @pointerleave="handleArrowLeave()"
            >&#8592;</span>
          </div>

          <!-- Node box -->
          <div
            :data-testid="`ds-node-${node.address}`"
            class="shrink-0 cursor-pointer border rounded px-3 py-2 text-center font-mono transition-all"
            :class="{
              'border-blue-400 bg-blue-500/20 outline outline-2 outline-blue-400': isNodeSelected(node.address),
              'border-blue-400 bg-blue-500/10': isNodeHighlighted(node.address) && !isNodeSelected(node.address),
              'border-gray-300 hover:border-blue-400 dark:border-gray-600': !isNodeHighlighted(node.address) && !isNodeSelected(node.address),
            }"
            @click="!didDrag && emit('selectNode', node.address)"
            @pointerenter="emit('hoverNode', node.address)"
            @pointerleave="emit('hoverNode', null)"
          >
            <div class="text-sm text-orange-600 dark:text-orange-300">
              {{ node.data }}
            </div>
            <div class="text-[9px] text-gray-500">
              {{ formatAddr(node.address) }}
            </div>
          </div>
        </template>

        <!-- Last node's next pointer -->
        <template v-if="chain.nodes.length > 0">
          <span
            class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-green-400 hover:text-green-300"
            @pointerenter="chain.nodes.at(-1)!.nextFieldAddress && handleArrowEnter(chain.nodes.at(-1)!.address, chain.nodes.at(-1)!.nextAddr, 'next', chain.nodes.at(-1)!.nextFieldAddress)"
            @pointerleave="handleArrowLeave()"
          >&#8594;</span>
          <span
            v-if="chain.nodes.at(-1)!.nextAddr === null"
            class="shrink-0 px-1 text-xs text-red-400"
          >NULL</span>
          <span
            v-else
            class="shrink-0 cursor-pointer px-1 text-xs text-green-400 font-mono hover:underline"
            @click="emit('selectNode', chain.nodes.at(-1)!.nextAddr!)"
          >{{ formatAddr(chain.nodes.at(-1)!.nextAddr!) }} &#x21A9;</span>
        </template>
      </div>

      <!-- Standalone data items -->
      <div v-if="standaloneItems.length > 0" class="flex flex-wrap gap-2 py-2">
        <template v-for="item in standaloneItems" :key="item.address">
          <!-- Array: row per element -->
          <div
            v-if="item.kind === 'array'"
            :data-testid="`ds-item-${item.address}`"
            :data-drag-key="`item-${item.address}`"
            class="cursor-pointer border-2 rounded p-1.5 font-mono transition-all"
            :class="[
              kindColors.array,
              kindBg.array,
              isNodeSelected(item.address) ? 'outline outline-2 outline-blue-400' : '',
              isNodeHighlighted(item.address) ? 'bg-blue-500/10!' : '',
            ]"
            :style="{
              transform: `translate(${getDragOffset(`item-${item.address}`).x}px, ${getDragOffset(`item-${item.address}`).y}px)`,
            }"
            @click="!didDrag && emit('selectNode', item.address)"
            @pointerenter="emit('hoverNode', item.address)"
            @pointerleave="emit('hoverNode', null)"
          >
            <div class="mb-1 flex items-baseline gap-1.5 text-[9px]">
              <span class="text-orange-500 font-semibold">{{ item.label }}</span>
              <span class="text-gray-500">{{ formatAddr(item.address) }}</span>
            </div>
            <div
              v-for="(elem, ei) in getArrayElements(item.cell)"
              :key="ei"
              class="flex items-baseline justify-between py-0.5 text-[10px]"
            >
              <span class="text-gray-500">[{{ ei }}]</span>
              <span
                v-if="typeof elem.value === 'object' && elem.value.type === 'pointer'"
                class="cursor-pointer hover:underline"
                :class="elem.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
                @click.stop="elem.value.address !== NULL_ADDRESS && emit('selectNode', elem.value.address)"
              >{{ formatValue(elem.value) }}</span>
              <span v-else class="text-orange-600 dark:text-orange-300">{{ formatValue(elem.value) }}</span>
            </div>
          </div>

          <!-- Primitive / pointer / struct: simple box -->
          <div
            v-else
            :data-testid="`ds-item-${item.address}`"
            class="cursor-pointer border-2 rounded px-3 py-2 text-center font-mono transition-all"
            :class="[
              kindColors[item.kind],
              kindBg[item.kind],
              isNodeSelected(item.address) ? 'outline outline-2 outline-blue-400' : '',
              isNodeHighlighted(item.address) ? 'bg-blue-500/10!' : '',
            ]"
            :style="{
              transform: `translate(${getDragOffset(`item-${item.address}`).x}px, ${getDragOffset(`item-${item.address}`).y}px)`,
            }"
            :data-drag-key="`item-${item.address}`"
            @click="!didDrag && emit('selectNode', item.address)"
            @pointerenter="emit('hoverNode', item.address)"
            @pointerleave="emit('hoverNode', null)"
          >
            <div class="text-[9px] text-gray-500">
              {{ item.label }}
            </div>
            <span
              v-if="item.kind === 'pointer' && typeof item.cell.value === 'object' && item.cell.value.type === 'pointer'"
              class="cursor-pointer text-sm hover:underline"
              :class="item.cell.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
              @click.stop="item.cell.value.address !== NULL_ADDRESS && emit('selectNode', item.cell.value.address)"
              @pointerenter="item.cell.value.address !== NULL_ADDRESS && emit('hoverNode', item.cell.value.address)"
              @pointerleave="emit('hoverNode', null)"
            >{{ item.display }}</span>
            <div v-else class="text-sm text-orange-600 dark:text-orange-300">
              {{ item.display }}
            </div>
            <div class="text-[8px] text-gray-500">
              {{ formatAddr(item.address) }}
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
