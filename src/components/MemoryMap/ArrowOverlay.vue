<script setup lang="ts">
import type { PointerArrow } from '~/composables/useHoverHighlight'
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useHoverHighlight } from '~/composables/useHoverHighlight'
import { ARROW_STYLES } from './highlightColors'

const props = defineProps<{
  /** Element whose box defines the overlay's coordinate origin. Queries for
   *  anchors are scoped to this element so that cached KeepAlive instances
   *  (attached elsewhere in the DOM) don't contribute stale endpoints. */
  host: HTMLElement | null
}>()

const hover = useHoverHighlight()
const svgRef = useTemplateRef<SVGSVGElement>('svg')

// `tick` is a reactive kick we bump on scroll / resize / frame so the
// computed endpoints recalculate without wiring each event into Vue refs.
const tick = shallowRef(0)
function bump() {
  tick.value++
}

let rafHandle: number | null = null
function schedule() {
  if (rafHandle !== null)
    return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null
    bump()
  })
}

// Arrow endpoints come from `getBoundingClientRect()`, which isn't a Vue
// reactive dep — if the host subtree swaps (KeepAlive toggling Bytes ↔
// Allocations) without firing a scroll or resize, the `arrows` computed
// would keep returning the previous view's coordinates. A MutationObserver
// on the host detects child swaps and schedules a recompute on the next
// frame, after the layout has settled.
let observer: MutationObserver | null = null
let attached: HTMLElement | null = null
function attach(el: HTMLElement | null) {
  if (attached) {
    attached.removeEventListener('transitionstart', onAnimationStart)
    attached.removeEventListener('transitionend', onAnimationEnd)
    attached.removeEventListener('transitioncancel', onAnimationEnd)
    attached.removeEventListener('animationstart', onAnimationStart)
    attached.removeEventListener('animationend', onAnimationEnd)
    attached.removeEventListener('animationcancel', onAnimationEnd)
  }
  observer?.disconnect()
  observer = null
  attached = null
  if (!el)
    return
  attached = el
  observer = new MutationObserver(schedule)
  observer.observe(el, { childList: true, subtree: true })
  // Transition/animation events bubble, so a single listener on host covers
  // every descendant card or row that's being animated in or out.
  el.addEventListener('transitionstart', onAnimationStart)
  el.addEventListener('transitionend', onAnimationEnd)
  el.addEventListener('transitioncancel', onAnimationEnd)
  el.addEventListener('animationstart', onAnimationStart)
  el.addEventListener('animationend', onAnimationEnd)
  el.addEventListener('animationcancel', onAnimationEnd)
}

// CSS transitions (TransitionGroup enter/leave on the allocation cards)
// don't mutate the DOM on every frame — they just interpolate
// `transform` / `opacity`, which getBoundingClientRect reflects but Vue
// doesn't track. Bump `tick` every frame while at least one transition or
// keyframe animation is running under `host`, so arrows anchored to a
// leaving element follow it smoothly instead of snapping at the end.
let activeAnimations = 0
let animLoopHandle: number | null = null
function runAnimLoop() {
  if (animLoopHandle !== null)
    return
  const step = () => {
    bump()
    animLoopHandle = activeAnimations > 0 ? requestAnimationFrame(step) : null
  }
  animLoopHandle = requestAnimationFrame(step)
}
function onAnimationStart() {
  activeAnimations++
  runAnimLoop()
}
function onAnimationEnd() {
  activeAnimations = Math.max(0, activeAnimations - 1)
  // Ensure a final bump after the last animation commits its end state.
  schedule()
}

onMounted(() => {
  window.addEventListener('resize', schedule)
  // Capture-phase listener catches scrolls on nested overflow containers
  // (the ByteMap's virtual-list scrollers) without having to register on each.
  document.addEventListener('scroll', schedule, true)
  attach(props.host)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', schedule)
  document.removeEventListener('scroll', schedule, true)
  attach(null)
  if (rafHandle !== null)
    cancelAnimationFrame(rafHandle)
  if (animLoopHandle !== null)
    cancelAnimationFrame(animLoopHandle)
})
watch(() => props.host, host => attach(host))

type Emphasis = 'primary' | 'ambient'

interface ArrowPath {
  key: string
  d: string
  emphasis: Emphasis
}

const mergedArrows = computed<{ arrow: PointerArrow, emphasis: Emphasis }[]>(() => {
  const out: { arrow: PointerArrow, emphasis: Emphasis }[] = []
  const seen = new Set<number>()
  const h = hover.pointerArrow.value
  if (h) {
    out.push({ arrow: h, emphasis: 'primary' })
    seen.add(h.source)
  }
  for (const a of hover.pinnedArrows.value) {
    if (seen.has(a.source))
      continue
    out.push({ arrow: a, emphasis: 'primary' })
    seen.add(a.source)
  }
  for (const a of hover.ambientArrows.value) {
    if (seen.has(a.source))
      continue
    out.push({ arrow: a, emphasis: 'ambient' })
    seen.add(a.source)
  }
  return out
})

/** Source anchor: prefer an explicit pointer-source element (AddressLink
 *  underline in Allocations view) over the plain byte cell — the link is
 *  where the arrow visually originates in the Allocations UI. */
function sourceAnchor(addr: number): HTMLElement | null {
  if (!props.host)
    return null
  return props.host.querySelector<HTMLElement>(`[data-pointer-source="${addr}"]`)
    ?? props.host.querySelector<HTMLElement>(`[data-address="${addr}"]`)
}

function targetAnchor(addr: number): HTMLElement | null {
  if (!props.host)
    return null
  return props.host.querySelector<HTMLElement>(`[data-address="${addr}"]`)
}

interface Point { x: number, y: number }

/** Endpoint for an anchor: the center of its box by default. Elements can
 *  opt into a specific edge via `data-anchor-edge`:
 *   - `bottom`  → horizontal center of the bottom edge (AddressLink under-
 *     line, where the source arrow visually leaves the text).
 *   - `left`    → vertical center of the left edge (allocation cards, so
 *     incoming arrows land exactly on the `border-l-*` hover accent the
 *     target is already drawing). */
function endpointOf(el: HTMLElement, hostBox: DOMRect): Point {
  const r = el.getBoundingClientRect()
  const edge = el.dataset.anchorEdge
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  if (edge === 'bottom')
    return { x: cx - hostBox.left, y: r.bottom - hostBox.top }
  if (edge === 'left')
    return { x: r.left - hostBox.left, y: cy - hostBox.top }
  return { x: cx - hostBox.left, y: cy - hostBox.top }
}

/** Bow magnitude: inversely proportional to arrow length so short arrows
 *  curve noticeably and long arrows stay close to a straight line. */
function bowFor(length: number): number {
  const k = 2200
  const min = 6
  const max = 55
  return Math.min(max, Math.max(min, k / Math.max(length, 1)))
}

/** Quadratic bezier from a to b, bowed to the right of the segment direction
 *  so rightward-pointing arrows bow downward and return trips bow the other
 *  way — avoids two opposing arrows overlapping into a single line. */
function bezierPath(a: Point, b: Point): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0)
    return ''
  const bow = bowFor(len)
  // Perpendicular unit vector rotated 90° clockwise from (dx, dy).
  const nx = dy / len
  const ny = -dx / len
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const cx = mx + nx * bow
  const cy = my + ny * bow
  return `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`
}

const arrows = computed<ArrowPath[]>(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  tick.value
  if (!props.host || !svgRef.value)
    return []
  const hostBox = props.host.getBoundingClientRect()
  const out: ArrowPath[] = []
  for (const { arrow, emphasis } of mergedArrows.value) {
    const src = sourceAnchor(arrow.source)
    const tgt = targetAnchor(arrow.target)
    if (!src || !tgt)
      continue
    const sRect = src.getBoundingClientRect()
    const tRect = tgt.getBoundingClientRect()
    // Skip degenerate (detached / hidden) anchors — KeepAlive-stored
    // instances have zero-size rects until re-activated.
    if (sRect.width === 0 || tRect.width === 0)
      continue
    const a = endpointOf(src, hostBox)
    const b = endpointOf(tgt, hostBox)
    if (a.x === b.x && a.y === b.y)
      continue
    out.push({
      key: `${arrow.source}->${arrow.target}:${emphasis}`,
      d: bezierPath(a, b),
      emphasis,
    })
  }
  return out
})
</script>

<template>
  <svg
    ref="svg"
    class="pointer-events-none absolute inset-0 h-full w-full"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker id="arrow-head-primary" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" :fill="ARROW_STYLES.primary.headFill" />
      </marker>
      <marker id="arrow-head-ambient" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" :fill="ARROW_STYLES.ambient.headFill" />
      </marker>
    </defs>
    <path
      v-for="a in arrows"
      :key="a.key"
      :d="a.d"
      fill="none"
      :stroke="ARROW_STYLES[a.emphasis].stroke"
      :stroke-width="ARROW_STYLES[a.emphasis].width"
      stroke-linecap="round"
      :marker-end="`url(#arrow-head-${a.emphasis})`"
    />
  </svg>
</template>
