<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'

const props = defineProps<{
  from: HTMLElement | null
  to: HTMLElement | null
  color?: string
  container: HTMLElement | null
}>()

const uid = useId()
const markerId = computed(() => `arrow-${props.color ?? 'default'}-${uid}`)
const path = ref('')

function updatePath() {
  if (!props.from || !props.to || !props.container)
    return

  const containerRect = props.container.getBoundingClientRect()
  const fromRect = props.from.getBoundingClientRect()
  const toRect = props.to.getBoundingClientRect()

  const x1 = fromRect.right - containerRect.left
  const y1 = fromRect.top + fromRect.height / 2 - containerRect.top
  const x2 = toRect.left - containerRect.left
  const y2 = toRect.top + toRect.height / 2 - containerRect.top

  const dx = x2 - x1
  const cp = Math.min(Math.abs(dx) * 0.4, 40)

  path.value = `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  updatePath()
  resizeObserver = new ResizeObserver(updatePath)
  if (props.container)
    resizeObserver.observe(props.container)
})

onUnmounted(() => resizeObserver?.disconnect())

watch(() => [props.from, props.to, props.container], updatePath, { flush: 'post' })
</script>

<template>
  <svg
    v-if="path"
    class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  >
    <defs>
      <marker
        :id="markerId"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" :fill="color ?? '#4caf50'" />
      </marker>
    </defs>
    <path
      :d="path"
      :stroke="color ?? '#4caf50'"
      stroke-width="1.5"
      fill="none"
      :marker-end="`url(#${markerId})`"
    />
  </svg>
</template>
