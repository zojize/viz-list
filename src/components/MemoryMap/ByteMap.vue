<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed, ref } from 'vue'
import ByteMapDetail from './ByteMapDetail.vue'
import MemoryMapByteRow from './MemoryMapByteRow.vue'

const props = defineProps<{
  mem: MemoryManager
  changedBytes?: Set<number>
}>()

// ---- Hover / pin state (internal — no cross-view emits) ----
const hoverAddr = ref<number | null>(null)
const pinnedAddr = ref<number | null>(null)

function onHover(addr: number) {
  hoverAddr.value = addr
}
function onClick(addr: number) {
  pinnedAddr.value = pinnedAddr.value === addr ? null : addr
}

const shownAddr = computed(() => pinnedAddr.value ?? hoverAddr.value)
const changed = computed(() => props.changedBytes ?? new Set<number>())

// ---- Address ranges ----

/** Number of extra "free" context bytes to show past the active region boundary */
const CONTEXT_BYTES = 8
const ROW_SIZE = 8

function alignDown(n: number, align: number): number {
  return Math.floor(n / align) * align
}
function alignUp(n: number, align: number): number {
  return Math.ceil(n / align) * align
}

/** Row start addresses for the stack column.
 *  Option A: start at 0x0000 (NULL byte is the first cell of row 0).
 *  Rows cover 0x0000..stackTop+context, aligned to 8-byte boundaries. */
const stackRows = computed<number[]>(() => {
  void props.mem.space.version
  const stackTop = props.mem.space.stackTop
  const end = alignUp(Math.min(props.mem.space.buffer.length, stackTop + CONTEXT_BYTES), ROW_SIZE)
  const rows: number[] = []
  for (let a = 0; a < end; a += ROW_SIZE) rows.push(a)
  return rows
})

/** Row start addresses for the heap column.
 *  Start at alignDown(heapBottom - context, 8), end at buffer length (already 8-aligned). */
const heapRows = computed<number[]>(() => {
  void props.mem.space.version
  const heapBottom = props.mem.space.heapBottom
  const total = props.mem.space.buffer.length
  const start = alignDown(Math.max(ROW_SIZE, heapBottom - CONTEXT_BYTES), ROW_SIZE)
  const rows: number[] = []
  for (let a = start; a < total; a += ROW_SIZE) rows.push(a)
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

        <!-- Scrollable 8-byte rows -->
        <div class="scrollbar-hidden flex-1 overflow-x-auto overflow-y-auto">
          <MemoryMapByteRow
            v-for="rowStart in stackRows"
            :key="rowStart"
            :row-start="rowStart"
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

        <!-- Scrollable 8-byte rows -->
        <div class="scrollbar-hidden flex-1 overflow-x-auto overflow-y-auto">
          <MemoryMapByteRow
            v-for="rowStart in heapRows"
            :key="rowStart"
            :row-start="rowStart"
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

    <!-- Detail panel — below both columns, full width -->
    <ByteMapDetail :mem="mem" :address="shownAddr" />
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
