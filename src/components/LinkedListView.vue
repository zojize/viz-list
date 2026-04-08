<script setup lang="ts">
import type { CppValue, InterpreterContext } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  highlightedAddress?: number | null
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
}>()

const hoveredArrow = shallowRef<{ source: number, target: number | null, type: string, fieldAddress: number } | null>(null)

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

// ---- Build chains ----

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

  // Collect starting points from LinkedList struct fields
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

  // Build chains from starting points
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

  // Find orphaned heap Nodes and build chains from them
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

  // Remove chains that are strict subsets of another chain
  // (e.g., a singleton chain for a node that's already in a longer chain)
  const filtered = result.filter((chain, i) => {
    return !result.some((other, j) => {
      if (i === j || other.nodes.length <= chain.nodes.length)
        return false
      return chain.nodes.every(n => other.nodes.some(o => o.address === n.address))
    })
  })

  return filtered
})

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

function handleArrowEnter(source: number, target: number | null, type: string, fieldAddress: number | undefined) {
  hoveredArrow.value = { source, target, type, fieldAddress: fieldAddress ?? 0 }
  if (fieldAddress)
    emit('hoverField', fieldAddress)
}

function handleArrowLeave() {
  hoveredArrow.value = null
  emit('hoverField', null)
}
</script>

<template>
  <div class="flex flex-col gap-3 p-2">
    <div v-if="chains.length === 0" class="text-sm text-gray-500 italic">
      No linked lists detected
    </div>
    <div v-for="(chain, chainIdx) in chains" :key="chain.id" class="relative flex items-center gap-0 overflow-x-auto py-3 pl-2">
      <!-- First node's prev pointer (show actual value, not hardcoded NULL) -->
      <template v-if="hasPrev && chain.nodes.length > 0">
        <span
          class="shrink-0 cursor-pointer px-1 text-xs font-mono hover:underline"
          :class="chain.nodes[0].prevAddr === null ? 'text-red-400 opacity-60' : 'text-orange-400'"
          @pointerenter="handleArrowEnter(chain.nodes[0].address, chain.nodes[0].prevAddr, 'prev', chain.nodes[0].prevFieldAddress)"
          @pointerleave="handleArrowLeave()"
        >{{ chain.nodes[0].prevAddr === null ? 'NULL' : `0x${chain.nodes[0].prevAddr.toString(16).padStart(2, '0')}` }}</span>
        <span
          class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-orange-400 hover:text-orange-300"
          @pointerenter="handleArrowEnter(chain.nodes[0].address, chain.nodes[0].prevAddr, 'prev', chain.nodes[0].prevFieldAddress)"
          @pointerleave="handleArrowLeave()"
        >&#8592;</span>
      </template>

      <template v-for="(node, i) in chain.nodes" :key="node.address">
        <!-- Arrows between nodes -->
        <div v-if="i > 0" class="flex shrink-0 flex-col items-center">
          <!-- Next arrow (top) -->
          <span
            class="shrink-0 cursor-pointer px-1 py-0.5 text-sm transition-opacity hover:opacity-100"
            :class="{
              'text-green-400': !isNodeInDifferentChain(node.address, chainIdx),
              'text-green-400/30': isNodeInDifferentChain(node.address, chainIdx),
            }"
            @pointerenter="handleArrowEnter(chain.nodes[i - 1].address, node.address, 'next', chain.nodes[i - 1].nextFieldAddress)"
            @pointerleave="handleArrowLeave()"
          >&#8594;</span>
          <!-- Prev arrow (bottom) -->
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
          class="shrink-0 cursor-pointer border rounded px-3 py-2 text-center font-mono transition-all"
          :class="{
            'border-blue-400 bg-blue-500/10': isNodeHighlighted(node.address),
            'border-gray-300 hover:border-blue-400 dark:border-gray-600': !isNodeHighlighted(node.address),
          }"
          @click="emit('selectNode', node.address)"
          @pointerenter="emit('hoverNode', node.address)"
          @pointerleave="emit('hoverNode', null)"
        >
          <div class="text-sm text-orange-600 dark:text-orange-300">
            {{ node.data }}
          </div>
          <div class="text-[9px] text-gray-500">
            0x{{ node.address.toString(16).padStart(2, '0') }}
          </div>
        </div>
      </template>

      <!-- Last node's next pointer -->
      <span
        v-if="chain.nodes.length > 0"
        class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-green-400 hover:text-green-300"
        @pointerenter="chain.nodes.at(-1)!.nextFieldAddress && handleArrowEnter(chain.nodes.at(-1)!.address, null, 'next', chain.nodes.at(-1)!.nextFieldAddress)"
        @pointerleave="handleArrowLeave()"
      >&#8594;</span>
      <span class="shrink-0 px-1 text-xs text-red-400">NULL</span>
    </div>
  </div>
</template>
