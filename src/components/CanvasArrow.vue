<script setup lang="ts">
import { computed, shallowRef } from 'vue'

const props = defineProps<{
  /** Position of parent item in content coordinates */
  fromPos: { x: number, y: number }
  /** Size of parent item */
  fromSize: { w: number, h: number }
  /** Position of child item in content coordinates (undefined for dangling) */
  toPos?: { x: number, y: number }
  /** Size of child item (undefined for dangling) */
  toSize?: { w: number, h: number }
  /** Memory address of the pointer field (for hover highlighting) */
  fieldAddress: number
  /** Exact Y offset of the field within the parent item (measured from DOM).
   *  When provided, the arrow starts at this Y instead of computing from child position. */
  fromFieldY?: number
  /** Whether this edge forms a cycle (back-edge) */
  isCycle?: boolean
  /** Whether this is a dangling pointer (target freed/dead) */
  isDangling?: boolean
  /** Label for dangling arrow (stale address) */
  danglingLabel?: string
}>()

const emit = defineEmits<{
  hoverField: [address: number | null]
}>()

const ARROW_SIZE = 6
const DANGLING_LENGTH = 40

const hovered = shallowRef(false)

const pathData = computed(() => {
  const startX = props.fromPos.x + props.fromSize.w

  if (props.isDangling || !props.toPos || !props.toSize) {
    const startY = props.fromPos.y + props.fromSize.h / 2
    const endX = startX + DANGLING_LENGTH
    const endY = startY
    return { startX, startY, endX, endY, path: `M ${startX} ${startY} L ${endX} ${endY}` }
  }

  const endX = props.toPos.x
  const endY = props.toPos.y + props.toSize.h / 2

  // Start Y: use the exact field position if available (measured from DOM),
  // otherwise clamp to parent's vertical extent biased toward the child.
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

  const dx = endX - startX
  // Control point offset: at least 60% of distance for a smooth S-curve that
  // arrives horizontally into the arrowhead
  const cpOffset = Math.max(Math.abs(dx) * 0.6, 30)

  const path = `M ${startX} ${startY} C ${startX + cpOffset} ${startY}, ${endX - cpOffset} ${endY}, ${endX} ${endY}`

  return { startX, startY, endX, endY, path }
})

const arrowHeadPoints = computed(() => {
  const { endX, endY } = pathData.value
  if (props.isDangling)
    return null
  return `${endX},${endY} ${endX - ARROW_SIZE},${endY - ARROW_SIZE / 2} ${endX - ARROW_SIZE},${endY + ARROW_SIZE / 2}`
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

// Color scheme: normal=blue, cycle=amber, dangling=red
const strokeColor = computed(() => {
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
    <!-- Arrow head (triangle) for normal/cycle edges -->
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
        :stroke="strokeColor"
        stroke-width="2"
        opacity="0.8"
      />
      <line
        :x1="danglingX.x2a" :y1="danglingX.y2a"
        :x2="danglingX.x2b" :y2="danglingX.y2b"
        :stroke="strokeColor"
        stroke-width="2"
        opacity="0.8"
      />
    </template>
    <!-- Dangling label -->
    <text
      v-if="isDangling && danglingLabel"
      :x="pathData.endX + 8"
      :y="pathData.endY + 4"
      :fill="strokeColor"
      font-size="9"
      font-family="monospace"
      opacity="0.7"
    >
      {{ danglingLabel }}
    </text>
    <!-- Cycle back-arrow icon -->
    <text
      v-if="isCycle && arrowHeadPoints"
      :x="pathData.endX - ARROW_SIZE - 12"
      :y="pathData.endY - 8"
      :fill="strokeColor"
      font-size="10"
    >
      &#x21A9;
    </text>
  </g>
</template>
