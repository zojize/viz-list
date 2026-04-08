<script setup lang="ts">
import type { CppValue, InterpreterContext } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
}>()

const emit = defineEmits<{
  selectNode: [address: number]
}>()

interface ListChain {
  listAddress: number
  nodes: { address: number, data: string }[]
}

const chains = computed((): ListChain[] => {
  const result: ListChain[] = []

  // Deduplicate: track which LinkedList base addresses we've already processed
  const seenBases = new Set<number>()

  for (const [, cell] of props.context.memory.cells) {
    if (cell.dead || typeof cell.type !== 'object' || cell.type.type !== 'struct' || cell.type.name !== 'LinkedList')
      continue
    // Use the struct's base address, not the cell's own address
    const structValue = cell.value
    if (typeof structValue !== 'object' || structValue.type !== 'struct')
      continue
    const base = structValue.base
    if (seenBases.has(base))
      continue
    seenBases.add(base)

    const structDef = props.context.structs.LinkedList
    if (!structDef)
      continue

    const headIdx = Object.keys(structDef).indexOf('head')
    if (headIdx === -1)
      continue

    const headCell = props.context.memory.cells.get(base + 1 + headIdx)
    if (!headCell)
      continue

    const nodes: { address: number, data: string }[] = []
    let cur = headCell.value
    const seen = new Set<number>()

    while (typeof cur === 'object' && cur.type === 'pointer' && cur.address !== NULL_ADDRESS) {
      if (seen.has(cur.address))
        break
      seen.add(cur.address)

      const nodeCell = props.context.memory.cells.get(cur.address)
      if (!nodeCell || nodeCell.dead)
        break

      const nodeDef = props.context.structs.Node
      if (!nodeDef)
        break
      // Use the Node's base address for field lookups
      const nodeValue = nodeCell.value
      const nodeBase = (typeof nodeValue === 'object' && nodeValue.type === 'struct') ? nodeValue.base : cur.address
      const dataIdx = Object.keys(nodeDef).indexOf('data')
      const dataCell = dataIdx >= 0 ? props.context.memory.cells.get(nodeBase + 1 + dataIdx) : undefined
      nodes.push({ address: cur.address, data: dataCell ? String(dataCell.value) : '?' })

      const nextIdx = Object.keys(nodeDef).indexOf('next')
      if (nextIdx === -1)
        break
      const nextCell = props.context.memory.cells.get(nodeBase + 1 + nextIdx)
      cur = nextCell?.value as CppValue
    }

    result.push({ listAddress: base, nodes })
  }

  return result
})
</script>

<template>
  <div class="flex flex-col gap-4 p-2">
    <div v-if="chains.length === 0" class="text-sm text-gray-500 italic">
      No linked lists detected
    </div>
    <div v-for="chain in chains" :key="chain.listAddress" class="flex items-center gap-1 overflow-x-auto">
      <template v-for="(node, i) in chain.nodes" :key="node.address">
        <span v-if="i > 0" class="text-sm text-green-400">&#8594;</span>
        <div
          class="shrink-0 cursor-pointer border border-gray-600 rounded px-3 py-2 text-center font-mono transition hover:border-blue-400"
          @click="emit('selectNode', node.address)"
        >
          <div class="text-sm text-orange-300">
            {{ node.data }}
          </div>
          <div class="text-[9px] text-gray-500">
            0x{{ node.address.toString(16).padStart(2, '0') }}
          </div>
        </div>
      </template>
      <span class="text-sm text-red-400">&#8594; NULL</span>
    </div>
  </div>
</template>
