<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed } from 'vue'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import MemoryMapByteCell from './MemoryMapByteCell.vue'

const props = defineProps<{
  /** Address of the first byte in this row */
  rowStart: number
  /** Number of bytes to display per row */
  bytesPerRow: number
  /** Total buffer length — used to clamp out-of-range addresses */
  bufferLength: number
  mem: MemoryManager
  changedBytes: Set<number>
}>()

defineEmits<{
  hover: [address: number]
  click: [address: number]
}>()

const context = useInterpreterContext()

/** Per-cell info for each of the bytesPerRow slots in the row */
const cells = computed(() => {
  void context.memoryVersion
  return Array.from({ length: props.bytesPerRow }, (_, i) => {
    const addr = props.rowStart + i
    if (addr >= props.bufferLength) {
      return { addr, inBuffer: false, isNull: false, byte: 0, allocation: undefined, isPadding: false, isDead: false, isBoundary: false, leafType: undefined }
    }
    if (addr === 0) {
      return { addr, inBuffer: true, isNull: true, byte: 0, allocation: undefined, isPadding: false, isDead: false, isBoundary: false, leafType: undefined }
    }
    const alloc = props.mem.findAllocation(addr)
    const desc = props.mem.describeByte(addr)
    return {
      addr,
      inBuffer: true,
      isNull: false,
      byte: props.mem.space.buffer[addr],
      allocation: alloc,
      isPadding: desc?.isPadding ?? false,
      isDead: alloc?.dead ?? false,
      isBoundary: alloc?.base === addr,
      leafType: desc?.leafType,
    }
  })
})

const addrLabel = computed(() =>
  `0x${props.rowStart.toString(16).padStart(4, '0')}`,
)
</script>

<template>
  <div class="flex items-center gap-0 text-xs font-mono">
    <!-- Address label (left-aligned to row start) -->
    <span class="w-14 shrink-0 pr-1.5 text-right text-[10px] text-gray-400 leading-7 dark:text-gray-500">
      {{ addrLabel }}
    </span>

    <!-- 8 byte cells side-by-side -->
    <template v-for="cell in cells" :key="cell.addr">
      <!-- NULL sentinel cell (addr 0) — non-interactive gray badge -->
      <div
        v-if="cell.isNull"
        class="h-7 w-8 flex shrink-0 items-center justify-center"
      >
        <span class="rounded bg-gray-200 px-0.5 py-0.5 text-[8px] text-gray-500 leading-none dark:bg-gray-700 dark:text-gray-400">
          NULL
        </span>
      </div>

      <!-- Out-of-buffer slot — blank placeholder -->
      <div
        v-else-if="!cell.inBuffer"
        class="h-7 w-8 shrink-0"
      />

      <!-- Normal interactive byte cell -->
      <MemoryMapByteCell
        v-else
        :address="cell.addr"
        :byte="cell.byte"
        :allocation="cell.allocation"
        :is-padding="cell.isPadding"
        :is-dead="cell.isDead"
        :is-changed="changedBytes.has(cell.addr)"
        :is-boundary="cell.isBoundary"
        :leaf-type="cell.leafType"
        class="w-8 shrink-0"
        @hover="$emit('hover', $event)"
        @click="$emit('click', $event)"
      />
    </template>
  </div>
</template>
