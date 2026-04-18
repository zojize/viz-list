<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import type { PointerArrow } from '~/composables/useHoverHighlight'
import { useLocalStorage } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { useInterpreterContext, useSetEndianness } from '~/composables/useInterpreterContext'
import AllocationMap from './AllocationMap.vue'
import ArrowOverlay from './ArrowOverlay.vue'
import ByteMap from './ByteMap.vue'

const props = defineProps<{
  mem: MemoryManager
  changedAddresses?: ReadonlySet<number>
  changedBytes?: Set<number>
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
  selectedAddress?: number | null
  /** Precise byte clicked in Bytes view — lets a struct field pointer pin
   *  its arrow even though the owning selection is the whole struct. */
  selectedByteAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
  selectByteCell: [address: number]
  hoverVariable: [name: string | null]
}>()

// Persist view preference across sessions.
const mode = useLocalStorage<'allocation' | 'byte'>('viz-list.memory-map-mode', 'allocation')
const showAllArrows = useLocalStorage('viz-list.show-all-pointer-arrows', false)

const hover = useHoverHighlight()
// Pinned arrows come from `selectedAddress` which is owned by the parent and
// outlives a view toggle. Gate their visibility through a local flag so a
// view switch dismisses the pinned arrow without closing the detail panel;
// the flag re-arms as soon as the user picks a new allocation.
//
// Also drop the hover-arrow on the way out — the cursor is moving to a tab
// button, not to an anchor in the next view, so the arrow it produced is
// semantically stale. We only clear `pointerArrow`, not the whole hover
// store, so the DS view's cross-highlighting stays intact.
//
// The two selection watchers are passed as separate getter sources rather
// than a single `() => [a, b]` getter — the latter returns a fresh array
// each tick, which Vue compares by reference and fires on every reactive
// update, constantly re-opening the gate and reviving stale pinned arrows.
const pinnedGateOpen = shallowRef(true)
watch(mode, () => {
  hover.setPointerArrow(null)
  pinnedGateOpen.value = false
})
watch(
  [() => props.selectedAddress, () => props.selectedByteAddress],
  () => { pinnedGateOpen.value = true },
)

// Host container for the absolutely-positioned ArrowOverlay. Scoping the
// overlay's [data-address] queries to this element avoids false matches in
// KeepAlive-cached views that may still have DOM attached elsewhere.
const viewHost = useTemplateRef<HTMLElement>('view-host')

const context = useInterpreterContext()
const setEndianness = useSetEndianness()
// Toggling triggers a live byte-swap of every scalar in the arena, keeping
// stored values semantically consistent across the switch.
function toggleEndianness() {
  setEndianness(context.endianness === 'le' ? 'be' : 'le')
}

/** Build an arrow from a pointer scalar's position. Returns null when the
 *  address doesn't lie inside a pointer (e.g. int field, padding) or when
 *  the owning allocation has since been freed — reading a dead scalar
 *  throws UseAfterFreeError, which would otherwise bubble out of the
 *  computed that calls us and leave every downstream consumer stuck on the
 *  previous value. */
function pointerArrowAt(address: number): PointerArrow | null {
  const info = props.mem.describeByte(address)
  if (!info || info.isPadding || info.allocation.dead)
    return null
  const leafType = info.leafType
  if (typeof leafType !== 'object' || leafType.type !== 'pointer')
    return null
  try {
    const target = props.mem.readScalar(info.leafBase, leafType) as number
    return { source: info.leafBase, sourceSize: info.leafSize, target }
  }
  catch {
    return null
  }
}

/** Enumerate arrows for every live pointer in the address space. Used by
 *  the "show all pointer arrows" toggle. */
function enumerateAllPointers(): PointerArrow[] {
  const out: PointerArrow[] = []
  for (const alloc of props.mem.space.allocations.values()) {
    if (alloc.dead)
      continue
    // Walk the layout, emitting one arrow per pointer-typed scalar.
    const visit = (nodeBase: number, node: import('~/composables/interpreter/layout').LayoutNode) => {
      if (node.kind === 'scalar') {
        if (typeof node.type === 'object' && node.type.type === 'pointer') {
          try {
            const target = props.mem.readScalar(nodeBase, node.type) as number
            out.push({ source: nodeBase, sourceSize: node.size, target })
          }
          catch {}
        }
        return
      }
      if (node.kind === 'array') {
        for (let i = 0; i < node.length; i++)
          visit(nodeBase + i * node.stride, node.element)
        return
      }
      // struct
      for (const f of node.fields)
        visit(nodeBase + f.offset, f.node)
    }
    visit(alloc.base, alloc.layout)
  }
  return out
}

const pinnedArrows = computed<PointerArrow[]>(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion
  if (!pinnedGateOpen.value)
    return []
  // Prefer the precise byte (lets struct field pointers pin) and fall back
  // to the allocation-level selection for Allocations-view clicks.
  const candidates: number[] = []
  if (props.selectedByteAddress !== null && props.selectedByteAddress !== undefined)
    candidates.push(props.selectedByteAddress)
  if (props.selectedAddress !== null && props.selectedAddress !== undefined)
    candidates.push(props.selectedAddress)
  for (const c of candidates) {
    const pinned = pointerArrowAt(c)
    if (pinned)
      return [pinned]
  }
  return []
})

const ambientArrows = computed<PointerArrow[]>(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion
  return showAllArrows.value ? enumerateAllPointers() : []
})

// Publish pinned + ambient into the hover store so descendants (AddressLink
// underline, ArrowOverlay) can read them via the same injection the rest of
// the hover state flows through. Hover arrow still lives on pointerArrow.
watchEffect(() => hover.setPinnedArrows(pinnedArrows.value))
watchEffect(() => hover.setAmbientArrows(ambientArrows.value))
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="flex items-center gap-1 border-b border-gray-200/60 px-2 py-1 text-xs dark:border-gray-700/60">
      <!-- Tab buttons carry a transparent border so their box matches the
           adjacent LE/BE toggle (which has a 1px border) — prevents a 2px
           height jump in the toolbar when switching to Bytes mode. -->
      <button
        type="button"
        class="cursor-pointer border border-transparent rounded bg-transparent px-2.5 py-0.5 text-inherit transition-opacity"
        :class="mode === 'allocation' ? 'bg-gray-500/10 font-semibold opacity-100' : 'opacity-60 hover:opacity-85'"
        title="Allocations view — structured by struct/array/variable"
        @click="mode = 'allocation'"
      >
        Allocations
      </button>
      <button
        type="button"
        class="cursor-pointer border border-transparent rounded bg-transparent px-2.5 py-0.5 text-inherit transition-opacity"
        :class="mode === 'byte' ? 'bg-gray-500/10 font-semibold opacity-100' : 'opacity-60 hover:opacity-85'"
        title="Byte view — raw bytes with type/padding hover details (CompArch view)"
        @click="mode = 'byte'"
      >
        Bytes
      </button>
      <!-- Toggle: draw every live pointer's arrow permanently. Independent of
           hover/selection; "primary" arrows still render on top in blue. -->
      <button
        type="button"
        class="ml-auto cursor-pointer border border-gray-500/25 rounded bg-transparent px-2 py-0.5 text-[0.7rem] text-inherit tracking-wider font-mono transition-colors hover:bg-gray-500/12"
        :class="showAllArrows ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' : ''"
        :title="showAllArrows ? 'Hide all pointer arrows' : 'Show all pointer arrows'"
        @click="showAllArrows = !showAllArrows"
      >
        arrows
      </button>
      <!-- Endianness toggle — only shown in Bytes mode -->
      <button
        v-if="mode === 'byte'"
        type="button"
        class="cursor-pointer border border-gray-500/25 rounded bg-transparent px-2 py-0.5 text-[0.7rem] text-inherit tracking-wider font-mono hover:bg-gray-500/12"
        :title="`Switch to ${context.endianness === 'le' ? 'big' : 'little'}-endian (live byte-swaps every scalar)`"
        @click="toggleEndianness"
      >
        {{ context.endianness === 'le' ? 'LE' : 'BE' }}
      </button>
    </div>
    <div ref="view-host" class="relative min-h-0 flex-1 overflow-auto overscroll-none">
      <!-- KeepAlive caches both views across toggles so ByteMap's
           useElementSize measurements (and scroll position, virtual-list
           state, etc.) survive a switch away and back — no re-measure
           flash on repeat switches. -->
      <KeepAlive>
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
          :statement-lhs-addresses="statementLhsAddresses"
          :statement-rhs-addresses="statementRhsAddresses"
          :selected-address="selectedAddress"
          @select-cell="emit('selectByteCell', $event)"
        />
      </KeepAlive>
      <!-- Sibling overlay spans the same box as the view and uses
           getBoundingClientRect() on [data-address] anchors to draw arrows
           between memory chunks; pointer-events-none so clicks pass through. -->
      <ArrowOverlay :host="viewHost" />
    </div>
  </div>
</template>
