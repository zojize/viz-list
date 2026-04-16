<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { useLocalStorage } from '@vueuse/core'
import { useInterpreterContext, useSetEndianness } from '~/composables/useInterpreterContext'
import AllocationMap from './AllocationMap.vue'
import ByteMap from './ByteMap.vue'

const props = defineProps<{
  mem: MemoryManager
  changedAddresses?: ReadonlySet<number>
  changedBytes?: Set<number>
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
  selectByteCell: [address: number]
  hoverVariable: [name: string | null]
}>()

// Persist view preference across sessions.
const mode = useLocalStorage<'allocation' | 'byte'>('viz-list.memory-map-mode', 'allocation')

const context = useInterpreterContext()
const setEndianness = useSetEndianness()
// Toggling triggers a live byte-swap of every scalar in the arena, keeping
// stored values semantically consistent across the switch.
function toggleEndianness() {
  setEndianness(context.endianness === 'le' ? 'be' : 'le')
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="flex items-center gap-1 border-b border-gray-200/60 px-2 py-1 text-xs dark:border-gray-700/60">
      <button
        type="button"
        class="cursor-pointer rounded border-none bg-transparent px-2.5 py-0.5 text-inherit transition-opacity"
        :class="mode === 'allocation' ? 'bg-gray-500/10 font-semibold opacity-100' : 'opacity-60 hover:opacity-85'"
        title="Allocation view — structured by struct/array/variable"
        @click="mode = 'allocation'"
      >
        Allocation
      </button>
      <button
        type="button"
        class="cursor-pointer rounded border-none bg-transparent px-2.5 py-0.5 text-inherit transition-opacity"
        :class="mode === 'byte' ? 'bg-gray-500/10 font-semibold opacity-100' : 'opacity-60 hover:opacity-85'"
        title="Byte view — raw bytes with type/padding hover details (CompArch view)"
        @click="mode = 'byte'"
      >
        Bytes
      </button>
      <!-- Endianness toggle — only shown in Bytes mode -->
      <button
        v-if="mode === 'byte'"
        type="button"
        class="ml-auto cursor-pointer border border-gray-500/25 rounded bg-transparent px-2 py-0.5 text-[0.7rem] text-inherit tracking-wider font-mono hover:bg-gray-500/12"
        :title="`Switch to ${context.endianness === 'le' ? 'big' : 'little'}-endian (live byte-swaps every scalar)`"
        @click="toggleEndianness"
      >
        {{ context.endianness === 'le' ? 'LE' : 'BE' }}
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <AllocationMap
        v-if="mode === 'allocation'"
        :changed-addresses="changedAddresses ?? new Set()"
        :statement-lhs-addresses="statementLhsAddresses"
        :statement-rhs-addresses="statementRhsAddresses"
        :selected-address="selectedAddress"
        @select-cell="emit('selectCell', $event)"
        @hover-variable="emit('hoverVariable', $event)"
      />
      <ByteMap
        v-else
        :mem="props.mem"
        :changed-bytes="changedBytes ?? (changedAddresses as Set<number> | undefined) ?? new Set()"
        :statement-lhs-addresses="statementLhsAddresses"
        :statement-rhs-addresses="statementRhsAddresses"
        :selected-address="selectedAddress"
        @select-cell="emit('selectByteCell', $event)"
      />
    </div>
  </div>
</template>
