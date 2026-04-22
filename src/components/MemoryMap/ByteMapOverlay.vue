<script setup lang="ts">
import type { HighlightKind } from './highlightColors'
import type { OverlayGeometry } from './overlayGeometry'
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed } from 'vue'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import { BOOST_STROKE, BOOST_WIDTH, SVG_STYLES } from './highlightColors'
import { allocationPath } from './overlayGeometry'

const props = defineProps<{
  mem: MemoryManager
  region: 'stack' | 'heap'
  regionStart: number
  /** exclusive */
  regionEnd: number
  bytesPerRow: number
  cellWidth: number
  rowHeight: number
  labelWidth: number
  /** Horizontal gutter when rows are centered — see OverlayGeometry docs. */
  xOffset: number
  lhs: ReadonlySet<number>
  rhs: ReadonlySet<number>
  changed: ReadonlySet<number>
  selectedAddress: number | null
}>()

const hover = useHoverHighlight()
const context = useInterpreterContext()

interface OverlayShape {
  key: string
  kind: HighlightKind
  boost: boolean
  /** SVG path `d` tracing the allocation's perimeter, already stroke-inset. */
  d: string
}

const geometry = computed<OverlayGeometry>(() => ({
  bytesPerRow: props.bytesPerRow,
  cellWidth: props.cellWidth,
  rowHeight: props.rowHeight,
  labelWidth: props.labelWidth,
  xOffset: props.xOffset,
  regionStart: props.regionStart,
}))

// Precedence: selected > lhs > rhs > changed > hover.
function kindFor(base: number, size: number): { kind: HighlightKind, boost: boolean } | null {
  const touches = (s: ReadonlySet<number>) => {
    for (let i = 0; i < size; i++) {
      if (s.has(base + i))
        return true
    }
    return false
  }
  const isSelected = props.selectedAddress !== null
    && props.selectedAddress >= base && props.selectedAddress < base + size
  const isHover = hover.address.value !== null
    && hover.address.value >= base && hover.address.value < base + size
  const arrow = hover.pointerArrow.value
  const isArrowSource = arrow !== null
    && arrow.source >= base && arrow.source < base + size
  const isArrowTarget = arrow !== null
    && arrow.target >= base && arrow.target < base + size
  const isLhs = touches(props.lhs)
  const isRhs = touches(props.rhs)
  const isChanged = touches(props.changed)

  if (isSelected)
    return { kind: 'selected', boost: false }
  if (isLhs)
    return { kind: 'lhs', boost: isHover || isArrowSource || isArrowTarget }
  if (isRhs)
    return { kind: 'rhs', boost: isHover || isArrowSource || isArrowTarget }
  if (isChanged)
    return { kind: 'changed', boost: isHover || isArrowSource || isArrowTarget }
  // When an arrow is active, colour the two ends differently so the tail and
  // head are distinguishable at a glance (violet = source, amber = target).
  if (isArrowSource)
    return { kind: 'pointer-source', boost: false }
  if (isArrowTarget)
    return { kind: 'pointer-target', boost: false }
  if (isHover)
    return { kind: 'hover', boost: false }
  return null
}

const shapes = computed<OverlayShape[]>(() => {
  // Reactive dep — mem is markRaw so space.version wouldn't track; use the
  // interpreter's memoryVersion which the whole codebase uses for this.
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion

  const out: OverlayShape[] = []
  const g = geometry.value
  for (const alloc of props.mem.space.allocations.values()) {
    if (alloc.dead)
      continue
    if (alloc.base < props.regionStart || alloc.base >= props.regionEnd)
      continue
    const pick = kindFor(alloc.base, alloc.size)
    if (!pick)
      continue
    // Inset the path by half the stroke width so the centered stroke fits
    // inside the drawable region (prevents top/bottom clipping at row 0 and
    // last row).
    const inset = SVG_STYLES[pick.kind].strokeWidth / 2
    out.push({
      key: `${alloc.base}-${pick.kind}-${pick.boost ? 'b' : ''}`,
      kind: pick.kind,
      boost: pick.boost,
      d: allocationPath(alloc.base, alloc.size, g, inset),
    })
  }
  return out
})
</script>

<template>
  <svg
    class="pointer-events-none absolute inset-0 h-full w-full"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- One <path> per shape traces the whole allocation's perimeter, so the
         row-boundary edges between head/middle/tail don't render as internal
         borders. Stroke-inset (applied in `shapes`) keeps the centered stroke
         inside the scroll container's clip region.
         Boost halo: a wider stroke on the same path, drawn UNDER the base
         so its outer 2px shows as a glow around the base stroke. -->
    <g v-for="shape in shapes" :key="shape.key">
      <path
        v-if="shape.boost"
        :d="shape.d"
        fill="none"
        :stroke="BOOST_STROKE"
        :stroke-width="SVG_STYLES[shape.kind].strokeWidth + BOOST_WIDTH * 2"
        stroke-linejoin="round"
      />
      <path
        :d="shape.d"
        :fill="SVG_STYLES[shape.kind].fill ?? 'none'"
        :stroke="SVG_STYLES[shape.kind].stroke"
        :stroke-width="SVG_STYLES[shape.kind].strokeWidth"
        stroke-linejoin="round"
      />
    </g>
  </svg>
</template>
