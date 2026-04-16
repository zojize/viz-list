<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { useElementSize } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'
import MemoryMapByteRow from './MemoryMapByteRow.vue'

const props = defineProps<{
  mem: MemoryManager
  changedBytes?: Set<number>
}>()

const emit = defineEmits<{
  selectCell: [address: number]
}>()

// ---- Hover state (internal — visual cue only, no cross-view emits) ----
const hoverAddrRef = ref<number | null>(null)

function onHover(addr: number): void {
  hoverAddrRef.value = addr
}
function onClick(addr: number) {
  emit('selectCell', addr)
}

const changed = computed(() => props.changedBytes ?? new Set<number>())

// ---- Responsive bytes-per-row ----

const stackColRef = useTemplateRef<HTMLElement>('stack-col')
const heapColRef = useTemplateRef<HTMLElement>('heap-col')
const { width: stackWidth } = useElementSize(stackColRef)
const { width: heapWidth } = useElementSize(heapColRef)

// Address label: "0x0000" text in w-14 (56px) + 6px right-padding = ~62px
// Each byte cell: w-8 (32px) in MemoryMapByteCell
const ADDRESS_LABEL_WIDTH = 62
const BYTE_CELL_WIDTH = 32

function bytesPerRowFor(width: number): number {
  const available = Math.max(0, width - ADDRESS_LABEL_WIDTH - 16 /* column padding */)
  return Math.max(4, Math.floor(available / BYTE_CELL_WIDTH))
}

const stackBytesPerRow = computed(() => bytesPerRowFor(stackWidth.value))
const heapBytesPerRow = computed(() => bytesPerRowFor(heapWidth.value))

// ---- Address ranges ----

/** Number of extra "free" context bytes to show past the active region boundary */
const CONTEXT_BYTES = 8

function alignDown(n: number, align: number): number {
  return Math.floor(n / align) * align
}
function alignUp(n: number, align: number): number {
  return Math.ceil(n / align) * align
}

/** Row start addresses for the stack column.
 *  Option A: start at 0x0000 (NULL byte is the first cell of row 0).
 *  Rows cover 0x0000..stackTop+context, aligned to bytesPerRow boundaries. */
const stackRows = computed<number[]>(() => {
  void props.mem.space.version
  const bpr = stackBytesPerRow.value
  const stackTop = props.mem.space.stackTop
  const end = alignUp(Math.min(props.mem.space.buffer.length, stackTop + CONTEXT_BYTES), bpr)
  const rows: number[] = []
  for (let a = 0; a < end; a += bpr) rows.push(a)
  return rows
})

/** Row start addresses for the heap column.
 *  Start at alignDown(heapBottom - context, bpr), end at buffer length. */
const heapRows = computed<number[]>(() => {
  void props.mem.space.version
  const bpr = heapBytesPerRow.value
  const heapBottom = props.mem.space.heapBottom
  const total = props.mem.space.buffer.length
  const start = alignDown(Math.max(bpr, heapBottom - CONTEXT_BYTES), bpr)
  const rows: number[] = []
  for (let a = start; a < total; a += bpr) rows.push(a)
  return rows
})

const bufferLength = computed(() => props.mem.space.buffer.length)

const stackBytesUsed = computed(() => {
  void props.mem.space.version
  return props.mem.space.stackTop - 1
})

const heapBytesUsed = computed(() => {
  void props.mem.space.version
  const total = props.mem.space.buffer.length
  return total - props.mem.space.heapBottom
})
</script>

<template>
  <div class="h-full flex flex-col gap-2 overflow-hidden p-2">
    <!-- Two-column layout: stack (left) + heap (right) -->
    <div class="min-h-0 flex flex-1 flex-col gap-2 md:flex-row">
      <!-- ── Stack column (+ globals) ── -->
      <div class="min-h-0 flex flex-1 flex-col border border-gray-200 rounded-lg dark:border-gray-800">
        <!-- Sticky header -->
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
          <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">
            Stack &amp; Globals
          </span>
          <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
            {{ stackBytesUsed }} bytes used
          </span>
        </div>

        <!-- Scrollable rows -->
        <div ref="stack-col" class="scrollbar-hidden flex-1 overflow-x-auto overflow-y-auto">
          <MemoryMapByteRow
            v-for="rowStart in stackRows"
            :key="rowStart"
            :row-start="rowStart"
            :bytes-per-row="stackBytesPerRow"
            :buffer-length="bufferLength"
            :mem="mem"
            :changed-bytes="changed"
            @hover="onHover"
            @click="onClick"
          />
          <div
            v-if="stackRows.length === 0"
            class="px-3 py-4 text-center text-xs text-gray-400 italic dark:text-gray-600"
          >
            No stack / global allocations yet
          </div>
        </div>
      </div>

      <!-- ── Heap column ── -->
      <div class="min-h-0 flex flex-1 flex-col border border-gray-200 rounded-lg dark:border-gray-800">
        <!-- Sticky header -->
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
          <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">
            Heap
          </span>
          <span class="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/60 dark:text-green-300">
            {{ heapBytesUsed }} bytes used
          </span>
        </div>

        <!-- Scrollable rows -->
        <div ref="heap-col" class="scrollbar-hidden flex-1 overflow-x-auto overflow-y-auto">
          <MemoryMapByteRow
            v-for="rowStart in heapRows"
            :key="rowStart"
            :row-start="rowStart"
            :bytes-per-row="heapBytesPerRow"
            :buffer-length="bufferLength"
            :mem="mem"
            :changed-bytes="changed"
            @hover="onHover"
            @click="onClick"
          />
          <div
            v-if="heapBytesUsed === 0"
            class="px-3 py-4 text-center text-xs text-gray-400 italic dark:text-gray-600"
          >
            No heap allocations yet
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hidden {
  scrollbar-width: none;
}
.scrollbar-hidden::-webkit-scrollbar {
  display: none;
}
</style>
