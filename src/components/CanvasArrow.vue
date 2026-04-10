<script setup lang="ts">
import type { ArrowStyle, FieldDirection } from '~/composables/interpreter/types'
import { computed, shallowRef } from 'vue'

const props = defineProps<{
  fromPos: { x: number, y: number }
  fromSize: { w: number, h: number }
  toPos?: { x: number, y: number }
  toSize?: { w: number, h: number }
  fieldAddress: number
  fromFieldY?: number
  isCycle?: boolean
  isDangling?: boolean
  danglingLabel?: string
  direction?: FieldDirection
  /** Custom arrow color from @color annotation */
  color?: string
  /** Arrow path style from @style annotation */
  arrowStyle?: ArrowStyle
}>()

const emit = defineEmits<{
  hoverField: [address: number | null]
}>()

const ARROW_SIZE = 6
const DANGLING_LENGTH = 40

const hovered = shallowRef(false)

const dir = computed(() => props.direction ?? 'right')

/** Find the nearest point on a rectangle's border to an external target point. */
function nearestBorderPoint(
  rect: { x: number, y: number, w: number, h: number },
  target: { x: number, y: number },
): { x: number, y: number } {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const dx = target.x - cx
  const dy = target.y - cy

  if (dx === 0 && dy === 0)
    return { x: cx + rect.w / 2, y: cy } // default: right edge center

  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const scaleX = (rect.w / 2) / (absDx || 1)
  const scaleY = (rect.h / 2) / (absDy || 1)

  if (scaleX < scaleY) {
    const edgeX = dx > 0 ? rect.x + rect.w : rect.x
    const edgeY = cy + dy * scaleX
    return { x: edgeX, y: Math.max(rect.y, Math.min(rect.y + rect.h, edgeY)) }
  }
  else {
    const edgeX = cx + dx * scaleY
    const edgeY = dy > 0 ? rect.y + rect.h : rect.y
    return { x: Math.max(rect.x, Math.min(rect.x + rect.w, edgeX)), y: edgeY }
  }
}

const pathData = computed(() => {
  const d = dir.value

  // ---- Dangling: short stub ----
  if (props.isDangling || !props.toPos || !props.toSize) {
    const startX = d === 'left' ? props.fromPos.x : props.fromPos.x + props.fromSize.w
    const startY = props.fromFieldY ?? props.fromPos.y + props.fromSize.h / 2
    const sign = d === 'left' ? -1 : 1
    const endX = startX + sign * DANGLING_LENGTH
    const endY = startY
    return { startX, startY, endX, endY, path: `M ${startX} ${startY} L ${endX} ${endY}` }
  }

  const isStraight = props.arrowStyle === 'straight'

  // ---- Dynamic: nearest border ----
  if (d === 'dynamic') {
    const fromRect = { ...props.fromPos, w: props.fromSize.w, h: props.fromSize.h }
    const toRect = { ...props.toPos, w: props.toSize.w, h: props.toSize.h }
    const toCenter = { x: props.toPos.x + props.toSize.w / 2, y: props.toPos.y + props.toSize.h / 2 }
    const fromCenter = { x: props.fromPos.x + props.fromSize.w / 2, y: props.fromPos.y + props.fromSize.h / 2 }

    const start = nearestBorderPoint(fromRect, toCenter)
    const end = nearestBorderPoint(toRect, fromCenter)

    let path: string
    if (isStraight) {
      path = `M ${start.x} ${start.y} L ${end.x} ${end.y}`
    }
    else {
      const dx = end.x - start.x
      const dy = end.y - start.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const cpDist = Math.max(dist * 0.4, 20)
      const nx = dist > 0 ? dx / dist : 1
      const ny = dist > 0 ? dy / dist : 0
      path = `M ${start.x} ${start.y} C ${start.x + nx * cpDist} ${start.y + ny * cpDist}, ${end.x - nx * cpDist} ${end.y - ny * cpDist}, ${end.x} ${end.y}`
    }
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, path }
  }

  // ---- Right / Left: field-aligned ----
  const isLeft = d === 'left'
  const startX = isLeft ? props.fromPos.x : props.fromPos.x + props.fromSize.w
  const endX = isLeft ? props.toPos.x + props.toSize.w : props.toPos.x
  const endY = props.toPos.y + props.toSize.h / 2

  let startY: number
  if (props.fromFieldY != null) {
    startY = props.fromFieldY
  }
  else {
    const parentTop = props.fromPos.y
    const parentBottom = props.fromPos.y + props.fromSize.h
    const margin = Math.min(props.fromSize.h * 0.15, 8)
    startY = Math.max(parentTop + margin, Math.min(parentBottom - margin, endY))
  }

  let path: string
  let actualEndX = endX
  let actualEndY = endY

  if (isStraight) {
    path = `M ${startX} ${startY} L ${endX} ${endY}`
  }
  else if (props.arrowStyle === 'horizontal') {
    // Pure horizontal line from start to the target's border at startY.
    // End point is where the horizontal line hits the target rect's edge.
    const targetLeft = props.toPos!.x
    const targetRight = props.toPos!.x + props.toSize!.w
    actualEndX = isLeft ? targetRight : targetLeft
    actualEndY = startY
    path = `M ${startX} ${startY} L ${actualEndX} ${actualEndY}`
  }
  else if (props.arrowStyle === 'orthogonal') {
    // H-V-H step line: horizontal, vertical, horizontal into endpoint
    const midX = (startX + endX) / 2
    path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`
  }
  else {
    const dx = endX - startX
    const cpOffset = Math.max(Math.abs(dx) * 0.6, 30)
    const sign = isLeft ? -1 : 1
    path = `M ${startX} ${startY} C ${startX + sign * cpOffset} ${startY}, ${endX - sign * cpOffset} ${endY}, ${endX} ${endY}`
  }

  return { startX, startY, endX: actualEndX, endY: actualEndY, path }
})

/** Compute arrowhead triangle aligned to the approach direction of the path. */
const arrowHeadPoints = computed(() => {
  const { endX, endY, startX, startY } = pathData.value
  if (props.isDangling)
    return null

  // For bezier/horizontal right/left, the path arrives horizontally into the endpoint,
  // so the approach direction is purely horizontal.
  // For straight/dynamic, the approach matches the actual line angle.
  const useLineAngle = props.arrowStyle === 'straight' || dir.value === 'dynamic'

  let nx: number, ny: number
  if (useLineAngle) {
    const dx = endX - startX
    const dy = endY - startY
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    nx = dx / len
    ny = dy / len
  }
  else {
    // Bezier arrives horizontally
    nx = dir.value === 'left' ? -1 : 1
    ny = 0
  }

  const px = -ny
  const py = nx
  return [
    `${endX},${endY}`,
    `${endX - nx * ARROW_SIZE + px * ARROW_SIZE / 2},${endY - ny * ARROW_SIZE + py * ARROW_SIZE / 2}`,
    `${endX - nx * ARROW_SIZE - px * ARROW_SIZE / 2},${endY - ny * ARROW_SIZE - py * ARROW_SIZE / 2}`,
  ].join(' ')
})

const danglingX = computed(() => {
  if (!props.isDangling)
    return null
  const { endX, endY } = pathData.value
  const s = 4
  return {
    x1a: endX - s,
    y1a: endY - s,
    x1b: endX + s,
    y1b: endY + s,
    x2a: endX - s,
    y2a: endY + s,
    x2b: endX + s,
    y2b: endY - s,
  }
})

const strokeColor = computed(() => {
  // Custom color from @color annotation (no hover variant — use as-is)
  if (props.color)
    return props.color
  if (props.isDangling)
    return hovered.value ? '#fca5a5' : '#f87171'
  if (props.isCycle)
    return hovered.value ? '#fbbf24' : '#f59e0b'
  return hovered.value ? '#93c5fd' : '#60a5fa'
})

const strokeWidth = computed(() => hovered.value ? 2 : 1.5)

function onEnter() {
  hovered.value = true
  emit('hoverField', props.fieldAddress)
}

function onLeave() {
  hovered.value = false
  emit('hoverField', null)
}
</script>

<template>
  <g>
    <!-- Invisible wider stroke for easier hover target -->
    <path
      :d="pathData.path"
      fill="none"
      stroke="transparent"
      :stroke-width="12"
      class="cursor-pointer"
      style="pointer-events: stroke"
      @pointerenter="onEnter"
      @pointerleave="onLeave"
    />
    <!-- Visible stroke -->
    <path
      :d="pathData.path"
      fill="none"
      :stroke="strokeColor"
      :stroke-width="strokeWidth"
      :stroke-dasharray="isCycle || isDangling ? '4 3' : undefined"
      :opacity="isDangling && !hovered ? 0.7 : 1"
    />
    <!-- Arrow head -->
    <polygon
      v-if="arrowHeadPoints"
      :points="arrowHeadPoints"
      :fill="strokeColor"
    />
    <!-- X mark for dangling edges -->
    <template v-if="danglingX">
      <line
        :x1="danglingX.x1a" :y1="danglingX.y1a"
        :x2="danglingX.x1b" :y2="danglingX.y1b"
        :stroke="strokeColor" stroke-width="2" opacity="0.8"
      />
      <line
        :x1="danglingX.x2a" :y1="danglingX.y2a"
        :x2="danglingX.x2b" :y2="danglingX.y2b"
        :stroke="strokeColor" stroke-width="2" opacity="0.8"
      />
    </template>
    <!-- Dangling label -->
    <text
      v-if="isDangling && danglingLabel"
      :x="pathData.endX + (dir === 'left' ? -40 : 8)"
      :y="pathData.endY + 4"
      :fill="strokeColor" font-size="9" font-family="monospace" opacity="0.7"
    >
      {{ danglingLabel }}
    </text>
    <!-- Cycle back-arrow icon -->
    <text
      v-if="isCycle && arrowHeadPoints"
      :x="pathData.endX - ARROW_SIZE - 12"
      :y="pathData.endY - 8"
      :fill="strokeColor" font-size="10"
    >
      &#x21A9;
    </text>
  </g>
</template>
