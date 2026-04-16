<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { useLocalStorage } from '@vueuse/core'
import AllocationMap from './AllocationMap.vue'
import ByteMap from './ByteMap.vue'

const props = defineProps<{
  mem: MemoryManager
  changedAddresses?: ReadonlySet<number>
  changedBytes?: Set<number>
  highlightedAddress?: number | null
  highlightedFieldAddress?: number | null
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
  selectByteCell: [address: number]
  hoverPointer: [address: number | null]
  hoverVariable: [name: string | null]
}>()

// Persist view preference across sessions.
const mode = useLocalStorage<'allocation' | 'byte'>('viz-list.memory-map-mode', 'allocation')
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
    </div>
    <div class="mm-body">
      <AllocationMap
        v-if="mode === 'allocation'"
        :changed-addresses="changedAddresses ?? new Set()"
        :highlighted-address="highlightedAddress"
        :highlighted-field-address="highlightedFieldAddress"
        :statement-lhs-addresses="statementLhsAddresses"
        :statement-rhs-addresses="statementRhsAddresses"
        :selected-address="selectedAddress"
        @select-cell="emit('selectCell', $event)"
        @hover-pointer="emit('hoverPointer', $event)"
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
