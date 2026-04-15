<script setup lang="ts">
import type { Allocation } from '~/composables/interpreter/types'
import { computed } from 'vue'

const props = defineProps<{
  address: number
  byte: number
  allocation: Allocation | undefined
  isPadding: boolean
  isDead: boolean
  isChanged: boolean
}>()

defineEmits<{
  hover: [address: number]
  click: [address: number]
}>()

const classes = computed(() => {
  const cs: string[] = ['byte-cell']
  if (!props.allocation)
    cs.push('free')
  else if (props.isDead)
    cs.push('dead')
  else if (props.isPadding)
    cs.push('padding')
  else cs.push(`region-${props.allocation.region}`)
  if (props.isChanged)
    cs.push('changed')
  return cs
})

const hex = computed(() => props.byte.toString(16).padStart(2, '0'))
</script>

<template>
  <span
    :class="classes"
    @mouseenter="$emit('hover', address)"
    @click="$emit('click', address)"
  >
    {{ hex }}
  </span>
</template>

<style scoped>
.byte-cell {
  display: inline-block;
  width: 1.6em;
  font-family: monospace;
  text-align: center;
  font-size: 0.8em;
  cursor: pointer;
  border: 1px solid transparent;
}
.free {
  color: #aaa;
}
.padding {
  background: repeating-linear-gradient(45deg, transparent 0 2px, #eee 2px 4px);
  color: #888;
}
.dead {
  opacity: 0.4;
  text-decoration: line-through;
}
.region-global {
  background: #eef7ff;
}
.region-stack {
  background: #f0fff0;
}
.region-heap {
  background: #fff7eb;
}
.changed {
  outline: 2px solid #d84;
}
</style>
