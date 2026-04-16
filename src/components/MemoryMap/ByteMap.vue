<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { useElementSize, useVirtualList } from '@vueuse/core'
import { computed, nextTick, onMounted, useTemplateRef } from 'vue'
import { MEMORY_SIZE } from '~/composables/interpreter/types'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import MemoryMapByteRow from './MemoryMapByteRow.vue'

const props = defineProps<{
  mem: MemoryManager
  changedBytes?: Set<number>
}>()

const emit = defineEmits<{
  selectCell: [address: number]
}>()

function onHover(_addr: number): void {
  // hover state intentionally not tracked at this level
}
function onClick(addr: number) {
  emit('selectCell', addr)
}

const changed = computed(() => props.changedBytes ?? new Set<number>())

const context = useInterpreterContext()

// ---- Responsive bytes-per-row ----

const stackColRef = useTemplateRef<HTMLElement>('stack-col-sizer')
const heapColRef = useTemplateRef<HTMLElement>('heap-col-sizer')
const { width: stackWidth } = useElementSize(stackColRef)
const { width: heapWidth } = useElementSize(heapColRef)

// Address label: "0x0000" text in w-14 (56px) + 6px right-padding = ~62px
// Each byte cell: w-8 (32px) in MemoryMapByteCell
const ADDRESS_LABEL_WIDTH = 62
const BYTE_CELL_WIDTH = 32
const ROW_HEIGHT = 28 // h-7 = 28px

function bytesPerRowFor(width: number): number {
  const available = Math.max(0, width - ADDRESS_LABEL_WIDTH - 16 /* column padding */)
  return Math.max(4, Math.floor(available / BYTE_CELL_WIDTH))
}

const stackBytesPerRow = computed(() => bytesPerRowFor(stackWidth.value))
const heapBytesPerRow = computed(() => bytesPerRowFor(heapWidth.value))

// ---- Full-buffer row address arrays ----

/** Stack column: addresses 0 to MEMORY_SIZE/2 - 1, low addr at top */
const stackRows = computed<number[]>(() => {
  void context.memoryVersion
  const end = MEMORY_SIZE / 2
  const bpr = stackBytesPerRow.value
  const rows: number[] = []
  for (let a = 0; a < end; a += bpr) rows.push(a)
  return rows
})

/** Heap column: addresses MEMORY_SIZE/2 to MEMORY_SIZE - 1, low addr at top */
const heapRows = computed<number[]>(() => {
  void context.memoryVersion
  const start = MEMORY_SIZE / 2
  const bpr = heapBytesPerRow.value
  const rows: number[] = []
  for (let a = start; a < MEMORY_SIZE; a += bpr) rows.push(a)
  return rows
})

const bufferLength = computed(() => props.mem.space.buffer.length)

const stackBytesUsed = computed(() => {
  void context.memoryVersion
  return props.mem.space.stackTop - 1
})

const heapBytesUsed = computed(() => {
  void context.memoryVersion
  return MEMORY_SIZE - props.mem.space.heapBottom
})

// ---- Virtual lists ----

const {
  list: stackList,
  containerProps: stackContainerProps,
  wrapperProps: stackWrapperProps,
} = useVirtualList(stackRows, { itemHeight: ROW_HEIGHT })

const {
  list: heapList,
  containerProps: heapContainerProps,
  wrapperProps: heapWrapperProps,
} = useVirtualList(heapRows, { itemHeight: ROW_HEIGHT })

// ---- Initial scroll: stack to top (default), heap to bottom ----

onMounted(async () => {
  await nextTick()
  const heapEl = heapContainerProps.ref.value
  if (heapEl)
    heapEl.scrollTo({ top: heapEl.scrollHeight })
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

        <!-- Width sizer element (not scrollable) -->
        <div ref="stack-col-sizer" class="w-full" />

        <!-- Virtual-list scrollable container -->
        <div
          v-bind="stackContainerProps"
          class="scrollbar-hidden min-h-0 flex-1 overflow-x-auto overflow-y-auto"
        >
          <div v-bind="stackWrapperProps">
            <MemoryMapByteRow
              v-for="item in stackList"
              :key="item.data"
              :row-start="item.data"
              :bytes-per-row="stackBytesPerRow"
              :buffer-length="bufferLength"
              :mem="mem"
              :changed-bytes="changed"
              @hover="onHover"
              @click="onClick"
            />
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

        <!-- Width sizer element (not scrollable) -->
        <div ref="heap-col-sizer" class="w-full" />

        <!-- Virtual-list scrollable container -->
        <div
          v-bind="heapContainerProps"
          class="scrollbar-hidden min-h-0 flex-1 overflow-x-auto overflow-y-auto"
        >
          <div v-bind="heapWrapperProps">
            <MemoryMapByteRow
              v-for="item in heapList"
              :key="item.data"
              :row-start="item.data"
              :bytes-per-row="heapBytesPerRow"
              :buffer-length="bufferLength"
              :mem="mem"
              :changed-bytes="changed"
              @hover="onHover"
              @click="onClick"
            />
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
