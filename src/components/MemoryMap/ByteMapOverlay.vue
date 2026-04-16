<script setup lang="ts">
import type { HighlightKind } from './highlightColors'
import type { OverlayGeometry } from './overlayGeometry'
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed } from 'vue'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { BOOST_STROKE, BOOST_WIDTH, SVG_STYLES } from './highlightColors'
import { allocationRects } from './overlayGeometry'

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
  lhs: ReadonlySet<number>
  rhs: ReadonlySet<number>
  changed: ReadonlySet<number>
  selectedAddress: number | null
}>()

const hover = useHoverHighlight()

interface OverlayShape {
  key: string
  kind: HighlightKind
  boost: boolean
  rects: ReturnType<typeof allocationRects>
}

const geometry = computed<OverlayGeometry>(() => ({
  bytesPerRow: props.bytesPerRow,
  cellWidth: props.cellWidth,
  rowHeight: props.rowHeight,
  labelWidth: props.labelWidth,
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
  const isLhs = touches(props.lhs)
  const isRhs = touches(props.rhs)
  const isChanged = touches(props.changed)

  if (isSelected)
    return { kind: 'selected', boost: false }
  if (isLhs)
    return { kind: 'lhs', boost: isHover }
  if (isRhs)
    return { kind: 'rhs', boost: isHover }
  if (isChanged)
    return { kind: 'changed', boost: isHover }
  if (isHover)
    return { kind: 'hover', boost: false }
  return null
}

const shapes = computed<OverlayShape[]>(() => {
  // Reactive dep — bumped on every memory write
  void props.mem.space.version

  const out: OverlayShape[] = []
  for (const alloc of props.mem.space.allocations.values()) {
    if (alloc.dead)
      continue
    if (alloc.base < props.regionStart || alloc.base >= props.regionEnd)
      continue
    const pick = kindFor(alloc.base, alloc.size)
    if (!pick)
      continue
    out.push({
      key: `${alloc.base}-${pick.kind}-${pick.boost ? 'b' : ''}`,
      kind: pick.kind,
      boost: pick.boost,
      rects: allocationRects(alloc.base, alloc.size, geometry.value),
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
    <g v-for="shape in shapes" :key="shape.key">
      <rect
        v-for="(r, i) in shape.rects"
        :key="i"
        :x="r.x"
        :y="r.y"
        :width="r.width"
        :height="r.height"
        :fill="SVG_STYLES[shape.kind].fill ?? 'none'"
        :stroke="SVG_STYLES[shape.kind].stroke"
        :stroke-width="SVG_STYLES[shape.kind].strokeWidth"
        rx="3"
      />
      <rect
        v-for="(r, i) in (shape.boost ? shape.rects : [])"
        :key="`b${i}`"
        :x="r.x - 2"
        :y="r.y - 2"
        :width="r.width + 4"
        :height="r.height + 4"
        fill="none"
        :stroke="BOOST_STROKE"
        :stroke-width="BOOST_WIDTH"
        rx="5"
      />
    </g>
  </svg>
</template>
