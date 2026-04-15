<script setup lang="ts">
import type { AddressSpace, Allocation } from '~/composables/interpreter/types'
import MemoryMapByteCell from './MemoryMapByteCell.vue'

defineProps<{
  space: AddressSpace
  rowStart: number
  bytesPerRow: number
  findAllocation: (addr: number) => Allocation | undefined
  describeByte: (addr: number) => { isPadding: boolean } | undefined
  changedBytes: Set<number>
}>()

defineEmits<{
  hover: [address: number]
  click: [address: number]
}>()
</script>

<template>
  <div class="mm-row">
    <span class="mm-addr">0x{{ rowStart.toString(16).padStart(4, '0') }}</span>
    <MemoryMapByteCell
      v-for="i in bytesPerRow"
      :key="rowStart + i - 1"
      :address="rowStart + i - 1"
      :byte="space.buffer[rowStart + i - 1]"
      :allocation="findAllocation(rowStart + i - 1)"
      :is-padding="describeByte(rowStart + i - 1)?.isPadding ?? false"
      :is-dead="findAllocation(rowStart + i - 1)?.dead ?? false"
      :is-changed="changedBytes.has(rowStart + i - 1)"
      @hover="$emit('hover', $event)"
      @click="$emit('click', $event)"
    />
  </div>
</template>

<style scoped>
.mm-row {
  display: flex;
  align-items: center;
  gap: 0.2em;
}
.mm-addr {
  font-family: monospace;
  font-size: 0.75em;
  color: #888;
  width: 5em;
}
</style>
