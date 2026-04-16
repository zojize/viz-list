<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { useElementSize, useVirtualList } from '@vueuse/core'
import { Pane, Splitpanes } from 'splitpanes'
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { MEMORY_SIZE } from '~/composables/interpreter/types'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import ByteMapOverlay from './ByteMapOverlay.vue'
import MemoryMapByteRow from './MemoryMapByteRow.vue'

const props = defineProps<{
  mem: MemoryManager
  changedBytes?: Set<number>
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
}>()

const hover = useHoverHighlight()

/** Resolve a byte address to its owning allocation's base, or the byte itself
 *  if unallocated. Padding bytes inside a struct resolve to the struct's base
 *  so the DS view lights up the enclosing node rather than a stray byte. */
function resolveForHover(addr: number): number {
  const alloc = props.mem.findAllocation(addr)
  return alloc ? alloc.base : addr
}

function onHoverStack(addr: number | null) {
  if (addr === null)
    hover.setHover(null, null)
  else
    hover.setHover(resolveForHover(addr), 'byte-stack')
}

function onHoverHeap(addr: number | null) {
  if (addr === null)
    hover.setHover(null, null)
  else
    hover.setHover(resolveForHover(addr), 'byte-heap')
}

function onClick(addr: number) {
  emit('selectCell', addr)
}

const changed = computed(() => props.changedBytes ?? new Set<number>())
const lhsSet = computed<ReadonlySet<number>>(() => props.statementLhsAddresses ?? new Set<number>())
const rhsSet = computed<ReadonlySet<number>>(() => props.statementRhsAddresses ?? new Set<number>())
const selected = computed<number | null>(() => props.selectedAddress ?? null)

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

// Full virtual-content height for each column (row count × row height). The
// overlay SVG spans this height so its coordinate system matches the scroll
// container's internal content frame — scrolling the container moves both the
// virtual-list wrapper and the absolutely-positioned overlay together.
const stackTotalHeight = computed(() => stackRows.value.length * ROW_HEIGHT)
const heapTotalHeight = computed(() => heapRows.value.length * ROW_HEIGHT)

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
  scrollTo: heapScrollToIdx,
  containerProps: heapContainerProps,
  wrapperProps: heapWrapperProps,
} = useVirtualList(heapRows, { itemHeight: ROW_HEIGHT })

// ---- Heap scroll: snap to bottom on every width/bpr change ----
// Fires on initial measurement AND whenever the splitpane drag changes bpr.
// Without this, a mid-session drag would leave scrollTop pointing beyond the
// new total content height and the heap would render empty.

watch(heapBytesPerRow, (bpr) => {
  if (bpr <= 0)
    return
  nextTick().then(() => {
    heapScrollToIdx(heapRows.value.length - 1)
  })
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden p-2">
    <!-- Splitpane-wrapped stack / heap columns so the user can drag the divider
         to change bytes-per-row ratio. -->
    <Splitpanes class="min-h-0 flex-1">
      <!-- ── Stack column (+ globals) ── -->
      <Pane :size="50" :min-size="15" class="min-h-0 flex flex-col border border-gray-200 rounded-lg dark:border-gray-800">
        <!-- Sticky header -->
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
          <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">
            Stack &amp; Globals
          </span>
          <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
            {{ stackBytesUsed }} {{ stackBytesUsed === 1 ? 'byte' : 'bytes' }} used
          </span>
        </div>

        <!-- Width sizer element (not scrollable) -->
        <div ref="stack-col-sizer" class="w-full" />

        <!-- Virtual-list scrollable container -->
        <div
          v-bind="stackContainerProps"
          class="scrollbar-hidden relative min-h-0 flex-1 overflow-x-auto overflow-y-auto"
        >
          <div v-bind="stackWrapperProps">
            <MemoryMapByteRow
              v-for="item in stackList"
              :key="item.data"
              :row-start="item.data"
              :bytes-per-row="stackBytesPerRow"
              :buffer-length="bufferLength"
              :mem="mem"
              @hover="onHoverStack"
              @click="onClick"
            />
          </div>
          <!-- Overlay: absolute within the scroll container, spans the full
               virtual-content height so its coordinate frame matches rows in
               the wrapper. Scrolls with content; pointer-events disabled. -->
          <div
            class="pointer-events-none absolute left-0 top-0 w-full"
            :style="{ height: `${stackTotalHeight}px` }"
          >
            <ByteMapOverlay
              :mem="mem"
              region="stack"
              :region-start="0"
              :region-end="MEMORY_SIZE / 2"
              :bytes-per-row="stackBytesPerRow"
              :cell-width="BYTE_CELL_WIDTH"
              :row-height="ROW_HEIGHT"
              :label-width="ADDRESS_LABEL_WIDTH"
              :lhs="lhsSet"
              :rhs="rhsSet"
              :changed="changed"
              :selected-address="selected"
            />
          </div>
        </div>
      </Pane>

      <!-- ── Heap column ── -->
      <Pane :size="50" :min-size="15" class="min-h-0 flex flex-col border border-gray-200 rounded-lg dark:border-gray-800">
        <!-- Sticky header -->
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
          <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">
            Heap
          </span>
          <span class="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/60 dark:text-green-300">
            {{ heapBytesUsed }} {{ heapBytesUsed === 1 ? 'byte' : 'bytes' }} used
          </span>
        </div>

        <!-- Width sizer element (not scrollable) -->
        <div ref="heap-col-sizer" class="w-full" />

        <!-- Virtual-list scrollable container -->
        <div
          v-bind="heapContainerProps"
          class="scrollbar-hidden relative min-h-0 flex-1 overflow-x-auto overflow-y-auto"
        >
          <div v-bind="heapWrapperProps">
            <MemoryMapByteRow
              v-for="item in heapList"
              :key="item.data"
              :row-start="item.data"
              :bytes-per-row="heapBytesPerRow"
              :buffer-length="bufferLength"
              :mem="mem"
              @hover="onHoverHeap"
              @click="onClick"
            />
          </div>
          <div
            class="pointer-events-none absolute left-0 top-0 w-full"
            :style="{ height: `${heapTotalHeight}px` }"
          >
            <ByteMapOverlay
              :mem="mem"
              region="heap"
              :region-start="MEMORY_SIZE / 2"
              :region-end="MEMORY_SIZE"
              :bytes-per-row="heapBytesPerRow"
              :cell-width="BYTE_CELL_WIDTH"
              :row-height="ROW_HEIGHT"
              :label-width="ADDRESS_LABEL_WIDTH"
              :lhs="lhsSet"
              :rhs="rhsSet"
              :changed="changed"
              :selected-address="selected"
            />
          </div>
        </div>
      </Pane>
    </Splitpanes>
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
