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
  /** When true, show a border-left allocation-boundary indicator */
  isBoundary?: boolean
}>()

defineEmits<{
  hover: [address: number]
  click: [address: number]
}>()

const hex = computed(() => props.byte.toString(16).padStart(2, '0'))

/** Region of the owning allocation, if any */
const region = computed(() => props.allocation?.region)

const rowClasses = computed(() => {
  const cs: string[] = []

  if (!props.allocation) {
    // Free / unallocated
    cs.push('bg-transparent')
  }
  else if (props.isDead) {
    cs.push('opacity-40', 'bg-gray-100', 'dark:bg-gray-800/40')
  }
  else if (props.isPadding) {
    cs.push('byte-cell-padding', 'bg-gray-100', 'dark:bg-gray-800/40')
  }
  else if (region.value === 'stack') {
    cs.push('bg-blue-500/5', 'dark:bg-blue-400/10')
  }
  else if (region.value === 'heap') {
    cs.push('bg-green-500/5', 'dark:bg-green-400/10')
  }
  else if (region.value === 'global') {
    cs.push('bg-gray-500/5', 'dark:bg-gray-400/10')
  }

  // Allocation boundary: stronger left border
  if (props.isBoundary && props.allocation && !props.isDead) {
    if (region.value === 'stack')
      cs.push('border-l-2', 'border-blue-400', 'dark:border-blue-500')
    else if (region.value === 'heap')
      cs.push('border-l-2', 'border-green-400', 'dark:border-green-500')
    else if (region.value === 'global')
      cs.push('border-l-2', 'border-gray-400', 'dark:border-gray-500')
  }

  // Changed byte: amber ring
  if (props.isChanged)
    cs.push('ring-2', 'ring-amber-400', 'dark:ring-amber-400')

  return cs
})

const hexClasses = computed(() => {
  const cs: string[] = ['font-mono', 'font-bold', 'text-sm']
  if (!props.allocation) {
    cs.push('text-gray-300', 'dark:text-gray-600')
  }
  else if (props.isDead) {
    cs.push('line-through', 'text-gray-400', 'dark:text-gray-600')
  }
  else if (props.isPadding) {
    cs.push('text-gray-400', 'dark:text-gray-500')
  }
  else if (region.value === 'stack') {
    cs.push('text-blue-700', 'dark:text-blue-300')
  }
  else if (region.value === 'heap') {
    cs.push('text-green-700', 'dark:text-green-300')
  }
  else if (region.value === 'global') {
    cs.push('text-gray-600', 'dark:text-gray-300')
  }
  return cs
})
</script>

<template>
  <div
    class="h-7 flex cursor-pointer items-center gap-1.5 border-l-2 border-transparent px-1.5 transition-colors hover:brightness-95 dark:hover:brightness-110"
    :class="rowClasses"
    @mouseenter="$emit('hover', address)"
    @click="$emit('click', address)"
  >
    <span :class="hexClasses">{{ hex }}</span>
  </div>
</template>

<style scoped>
/* Diagonal stripe for padding bytes */
.byte-cell-padding {
  background-image: repeating-linear-gradient(
    45deg,
    transparent 0 2px,
    color-mix(in srgb, currentColor 8%, transparent) 2px 4px
  );
}
</style>
