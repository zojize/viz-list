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
  <div class="mm-wrapper">
    <div class="mm-toolbar">
      <button
        class="mm-tab"
        :class="{ active: mode === 'allocation' }"
        type="button"
        title="Allocation view — structured by struct/array/variable"
        @click="mode = 'allocation'"
      >
        Allocation
      </button>
      <button
        class="mm-tab"
        :class="{ active: mode === 'byte' }"
        type="button"
        title="Byte view — raw bytes with type/padding hover details (CompArch view)"
        @click="mode = 'byte'"
      >
        Bytes
      </button>
      <!-- Endianness toggle — only shown in Bytes mode -->
      <button
        v-if="mode === 'byte'"
        class="mm-endian"
        type="button"
        :title="`Switch to ${context.endianness === 'le' ? 'big' : 'little'}-endian (live byte-swaps every scalar)`"
        @click="toggleEndianness"
      >
        {{ context.endianness === 'le' ? 'LE' : 'BE' }}
      </button>
    </div>
    <div class="mm-body">
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
        @select-cell="emit('selectByteCell', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.mm-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mm-toolbar {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
  font-size: 0.75rem;
}
.mm-endian {
  margin-left: auto;
  background: transparent;
  border: 1px solid rgba(127, 127, 127, 0.25);
  padding: 0.15rem 0.5rem;
  border-radius: 0.35rem;
  cursor: pointer;
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
}
.mm-endian:hover {
  background: rgba(127, 127, 127, 0.12);
}
.mm-tab {
  background: transparent;
  border: none;
  padding: 0.2rem 0.6rem;
  border-radius: 0.35rem;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
}
.mm-tab:hover {
  opacity: 0.85;
}
.mm-tab.active {
  opacity: 1;
  background: rgba(127, 127, 127, 0.12);
  font-weight: 600;
}
.mm-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
