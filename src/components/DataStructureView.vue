<script setup lang="ts">
import type { CppType, CppValue, MemoryCell } from '~/composables/interpreter/types'
import { computed, nextTick, onUpdated, shallowRef, watch } from 'vue'
import DSValue from '~/components/DSValue.vue'
import LinkedListChain from '~/components/LinkedListChain.vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import { usePannableCanvas } from '~/composables/usePannableCanvas'
import { usePlacementEngine } from '~/composables/usePlacementEngine'

const props = defineProps<{
  highlightedAddress?: number | null
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
  hoverVariable: [name: string | null]
}>()

const context = useInterpreterContext()

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
  panToElement,
} = usePannableCanvas({
  canvasRef,
  hasContent: () => hasContent.value,
  onDragEnd(key, dx, dy) {
    const pos = placementRef?.getPosition(key)
    if (pos)
      placementRef?.setPosition(key, pos.x + dx, pos.y + dy)
  },
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

/** Chain keys for isChain detection */
const chainKeys = computed(() => new Set(chains.value.map(c => c.id)))

/** Measure and place all visible items after render */
function measureAndPlace() {
  if (!contentRef.value)
    return
  const els = contentRef.value.querySelectorAll<HTMLElement>('[data-place-key]')
  for (const el of els) {
    const key = el.dataset.placeKey!
    placement.setSize(key, el.offsetWidth, el.offsetHeight)
    placement.placeNew(key, el.offsetWidth, el.offsetHeight, chainKeys.value.has(key))
  }
  const activeKeys = new Set<string>()
  for (const el of els)
    activeKeys.add(el.dataset.placeKey!)
  placement.retainOnly(activeKeys)
}

onUpdated(() => nextTick(measureAndPlace))

/** Get the final visual position of an item: placement + transient drag delta.
 *  Uses transform (GPU-accelerated) instead of left/top (triggers layout). */
function getItemStyle(key: string) {
  const pos = placement.getPosition(key) ?? { x: 0, y: 0 }
  const delta = getDragDelta(key)
  const isDragging = delta.x !== 0 || delta.y !== 0
  return {
    position: 'absolute' as const,
    transform: `translate(${pos.x + delta.x}px, ${pos.y + delta.y}px)`,
    willChange: isDragging ? 'transform' : 'auto',
    transition: isDragging ? 'none' : undefined,
  }
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
    class="h-full select-none overflow-hidden p-2"
    :class="hasContent ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''"
  >
    <div ref="contentRef" :style="{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }" class="relative">
      <div v-if="!hasContent" class="text-sm text-gray-500 italic">
        No data to display
      </div>

      <!-- Linked list chains -->
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
        :did-drag="didDrag"
        :style="getItemStyle(chain.id)"
        @select-node="emit('selectNode', $event)"
        @hover-node="emit('hoverNode', $event)"
        @hover-field="emit('hoverField', $event)"
      />

      <!-- Standalone data items -->
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
          isNodeHighlighted(item.address) ? 'bg-blue-500/10!' : '',
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
  </div>
</template>
