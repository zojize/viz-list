<script setup lang="ts">
import AddressLink from '~/components/AddressLink.vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

export interface ChainNode {
  address: number
  base: number
  data: string
  nextAddr: number | null
  prevAddr: number | null
  nextFieldAddress: number | undefined
  prevFieldAddress: number | undefined
}

const props = defineProps<{
  nodes: ChainNode[]
  hasPrev: boolean
  highlightedAddress?: number | null
  selectedAddress?: number | null
  /** Whether a drag just happened (suppress click) */
  didDrag?: boolean
}>()

const emit = defineEmits<{
  selectNode: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
}>()

function formatAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(3, '0')}`
}

function isNodeHighlighted(address: number): boolean {
  return props.highlightedAddress === address
}

function isNodeSelected(address: number): boolean {
  return props.selectedAddress === address
}

// ---- Arrow hover (for field highlighting in memory map) ----

function handleArrowEnter(_source: number, _target: number | null, _type: string, fieldAddress: number | undefined) {
  if (fieldAddress)
    emit('hoverField', fieldAddress)
}

function handleArrowLeave() {
  emit('hoverField', null)
}
</script>

<template>
  <div class="relative flex items-center gap-0 py-3 pl-2">
    <!-- First node's prev pointer -->
    <template v-if="hasPrev && nodes.length > 0">
      <AddressLink
        :address="nodes[0].prevAddr ?? NULL_ADDRESS"
        class="shrink-0 text-xs opacity-60"
        @navigate="emit('selectNode', $event)"
        @hover="(addr) => handleArrowEnter(nodes[0].address, nodes[0].prevAddr, 'prev', nodes[0].prevFieldAddress)"
      />
      <span
        class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-orange-400 hover:text-orange-300"
        @pointerenter="handleArrowEnter(nodes[0].address, nodes[0].prevAddr, 'prev', nodes[0].prevFieldAddress)"
        @pointerleave="handleArrowLeave()"
      >&#8592;</span>
    </template>

    <template v-for="(node, i) in nodes" :key="node.address">
      <!-- Arrows between nodes -->
      <div v-if="i > 0" class="flex shrink-0 flex-col items-center">
        <!-- Next arrow -->
        <span
          class="shrink-0 cursor-pointer px-1 py-0.5 text-sm text-green-400 transition-opacity hover:opacity-100"
          @pointerenter="handleArrowEnter(nodes[i - 1].address, node.address, 'next', nodes[i - 1].nextFieldAddress)"
          @pointerleave="handleArrowLeave()"
        >&#8594;</span>
        <!-- Prev arrow -->
        <span
          v-if="hasPrev"
          class="shrink-0 cursor-pointer px-1 py-0.5 text-sm text-orange-400 transition-opacity hover:opacity-100"
          @pointerenter="handleArrowEnter(node.address, nodes[i - 1].address, 'prev', node.prevFieldAddress)"
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
    <template v-if="nodes.length > 0">
      <span
        class="shrink-0 cursor-pointer px-0.5 py-1 text-sm text-green-400 hover:text-green-300"
        @pointerenter="nodes.at(-1)!.nextFieldAddress && handleArrowEnter(nodes.at(-1)!.address, nodes.at(-1)!.nextAddr, 'next', nodes.at(-1)!.nextFieldAddress)"
        @pointerleave="handleArrowLeave()"
      >&#8594;</span>
      <AddressLink
        v-if="nodes.at(-1)!.nextAddr === null"
        :address="NULL_ADDRESS"
        class="shrink-0 text-xs"
        @hover="(addr) => handleArrowEnter(nodes.at(-1)!.address, null, 'next', nodes.at(-1)!.nextFieldAddress)"
      />
      <AddressLink
        v-else
        :address="nodes.at(-1)!.nextAddr!"
        class="shrink-0 text-xs"
        @navigate="emit('selectNode', $event)"
      />
    </template>
  </div>
</template>
