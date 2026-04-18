<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { refThrottled, useElementSize, useVirtualList } from '@vueuse/core'
import { Pane, Splitpanes } from 'splitpanes'
import { computed, nextTick, onActivated, shallowRef, useTemplateRef, watch } from 'vue'
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

/** If the hovered byte lies inside a pointer scalar (either a top-level
 *  pointer allocation or a pointer field of a struct), publish an arrow from
 *  that scalar to its current target. Otherwise clear any previous arrow. */
function syncPointerArrow(addr: number): void {
  const info = props.mem.describeByte(addr)
  if (!info || info.isPadding || info.allocation.dead) {
    hover.setPointerArrow(null)
    return
  }
  const leafType = info.leafType
  if (typeof leafType !== 'object' || leafType.type !== 'pointer') {
    hover.setPointerArrow(null)
    return
  }
  // Dead alloc makes readScalar throw; swallow and drop the arrow — the
  // store stays stale otherwise and the last arrow would persist visually.
  try {
    const target = props.mem.readScalar(info.leafBase, leafType) as number
    hover.setPointerArrow({ source: info.leafBase, sourceSize: info.leafSize, target })
  }
  catch {
    hover.setPointerArrow(null)
  }
}

function onHoverStack(addr: number | null) {
  if (addr === null) {
    hover.setHover(null, null)
    return
  }
  hover.setHover(resolveForHover(addr), 'byte-stack')
  syncPointerArrow(addr)
}

function onHoverHeap(addr: number | null) {
  if (addr === null) {
    hover.setHover(null, null)
    return
  }
  hover.setHover(resolveForHover(addr), 'byte-heap')
  syncPointerArrow(addr)
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
const { width: stackWidthRaw } = useElementSize(stackColRef)
const { width: heapWidthRaw } = useElementSize(heapColRef)
// Throttled fallback for non-drag resizes (e.g. window resize) so
// rapid ResizeObserver events don't cascade into per-frame re-renders.
const stackWidthThrottled = refThrottled(stackWidthRaw, 60)
const heapWidthThrottled = refThrottled(heapWidthRaw, 60)
// Committed widths drive bytesPerRow. While the splitpane divider is
// actively being dragged we FREEZE these values, so the byte grid keeps
// its current bpr mid-drag (columns still resize visually because they're
// driven by splitpanes CSS). On drag end we snap to the final widths and
// recompute once. Trade-off: mid-drag the cell grid doesn't reflow.
const isDragging = shallowRef(false)
const stackWidth = shallowRef(0)
const heapWidth = shallowRef(0)
watch(stackWidthThrottled, (w) => {
  if (!isDragging.value)
    stackWidth.value = w
}, { immediate: true })
watch(heapWidthThrottled, (w) => {
  if (!isDragging.value)
    heapWidth.value = w
}, { immediate: true })

function onSplitStart() {
  isDragging.value = true
}
function onSplitEnd() {
  isDragging.value = false
  // Snap to latest observed widths (not the throttled ones, which may be
  // a few ms stale).
  stackWidth.value = stackWidthRaw.value
  heapWidth.value = heapWidthRaw.value
}

// Address label: w-14 (56px) — padding is inside the span's box.
// Each byte cell: w-8 (32px) in MemoryMapByteCell.
const ADDRESS_LABEL_WIDTH = 56
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
  scrollTo: stackScrollToIdx,
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

// KeepAlive preserves the scroll position across view toggles, which sounds
// right but doesn't suit the heap column — the "interesting" content is
// pinned at the bottom addresses. Snap back to the latest row whenever the
// Bytes view is reactivated so the user never sees a blank top.
onActivated(() => {
  if (heapBytesPerRow.value <= 0)
    return
  nextTick().then(() => {
    heapScrollToIdx(heapRows.value.length - 1)
  })
})

// ---- Scroll to pointer target ----
// When the user hovers a pointer, its target might be rendered outside the
// current viewport of the owning column (the heap especially, since the
// interesting allocations sit near the bottom). Mirrors the AllocationMap
// behaviour: bring the target row into view so the arrow has something to
// point at without the user manually scrolling.
watch(() => hover.pointerArrow.value?.target, (target) => {
  if (target == null || target <= 0)
    return
  const half = MEMORY_SIZE / 2
  if (target < half) {
    const bpr = stackBytesPerRow.value
    if (bpr > 0)
      stackScrollToIdx(Math.floor(target / bpr))
  }
  else {
    const bpr = heapBytesPerRow.value
    if (bpr > 0)
      heapScrollToIdx(Math.floor((target - half) / bpr))
  }
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden p-2">
    <!-- Splitpane-wrapped stack / heap columns so the user can drag the divider
         to change bytes-per-row ratio. -->
    <Splitpanes class="min-h-0 flex-1" @resize="onSplitStart" @resized="onSplitEnd">
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

        <!-- Virtual-list scrollable container. Rows are hidden until the
             column has been measured — otherwise the initial render uses the
             fallback 4 bytes-per-row and snaps to the responsive width a
             frame later, which looks like a layout flash when switching from
             Allocation view. -->
        <div
          v-bind="stackContainerProps"
          class="scrollbar-hidden relative min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-none"
        >
          <div v-show="stackWidth > 0" v-bind="stackWrapperProps">
            <!-- Key by virtual-list index, NOT item.data (row-start address).
                 When bytesPerRow changes (splitpane drag), row addresses shift
                 so keying by address would unmount/re-mount every visible row.
                 Keying by index reuses the same components and just updates
                 their props. -->
            <MemoryMapByteRow
              v-for="item in stackList"
              :key="item.index"
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
            v-show="stackWidth > 0"
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

        <!-- Virtual-list scrollable container (see stack column for why we
             gate the wrapper on a non-zero measured width). -->
        <div
          v-bind="heapContainerProps"
          class="scrollbar-hidden relative min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-none"
        >
          <div v-show="heapWidth > 0" v-bind="heapWrapperProps">
            <MemoryMapByteRow
              v-for="item in heapList"
              :key="item.index"
              :row-start="item.data"
              :bytes-per-row="heapBytesPerRow"
              :buffer-length="bufferLength"
              :mem="mem"
              @hover="onHoverHeap"
              @click="onClick"
            />
          </div>
          <div
            v-show="heapWidth > 0"
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
