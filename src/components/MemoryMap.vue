<script setup lang="ts">
/**
 * MemoryMap.vue — STUB for Task 13.
 *
 * This component will be fully replaced in Task 16 with a byte-level
 * memory-map view. For now it renders a placeholder so the build passes.
 * Props/emits are kept identical to avoid breaking index.vue.
 */

defineProps<{
  changedAddresses: ReadonlySet<number>
  highlightedAddress?: number | null
  highlightedFieldAddress?: number | null
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
  selectedAddress?: number | null
}>()

defineEmits<{
  selectCell: [address: number]
  hoverPointer: [address: number | null]
  hoverVariable: [name: string | null]
}>()
</script>

<template>
  <div class="h-full flex items-center justify-center text-sm text-gray-400 italic">
    Memory map coming in Task 16
  </div>
</template>
