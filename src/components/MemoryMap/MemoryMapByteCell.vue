<script setup lang="ts">
import type { Allocation, CppType } from '~/composables/interpreter/types'
import { computed } from 'vue'

const props = defineProps<{
  address: number
  byte: number
  allocation: Allocation | undefined
  isPadding: boolean
  isDead: boolean
  /** When true, show a border-left allocation-boundary indicator */
  isBoundary?: boolean
  /** Leaf type of this byte per describeByte(); drives colour-coding */
  leafType?: CppType
}>()

defineEmits<{
  hover: [address: number | null]
  click: [address: number]
}>()

const hex = computed(() => props.byte.toString(16).padStart(2, '0'))

/** Classify a CppType into one of the DSView kinds (int/float/char/bool/pointer/struct/array). */
type Kind = 'int' | 'float' | 'char' | 'bool' | 'pointer' | 'struct' | 'array'
function classify(t: CppType | undefined): Kind | null {
  if (t === undefined)
    return null
  if (typeof t === 'string') {
    if (t === 'float' || t === 'double')
      return 'float'
    if (t === 'char')
      return 'char'
    if (t === 'bool')
      return 'bool'
    return 'int' // int, void
  }
  if (t.type === 'pointer')
    return 'pointer'
  if (t.type === 'array')
    return 'array'
  return 'struct'
}

const kind = computed<Kind | null>(() => classify(props.leafType))

/** Background tint per kind — matches DataStructureView's kindBg sensibility but tuned for inline byte cells. */
const KIND_BG: Record<Kind, string[]> = {
  int: ['bg-blue-500/10', 'dark:bg-blue-400/15'],
  float: ['bg-amber-500/10', 'dark:bg-amber-400/15'],
  char: ['bg-purple-500/10', 'dark:bg-purple-400/15'],
  bool: ['bg-rose-500/10', 'dark:bg-rose-400/15'],
  pointer: ['bg-green-500/10', 'dark:bg-green-400/15'],
  struct: ['bg-cyan-500/10', 'dark:bg-cyan-400/15'],
  array: ['bg-orange-500/10', 'dark:bg-orange-400/15'],
}

const KIND_TEXT: Record<Kind, string[]> = {
  int: ['text-blue-700', 'dark:text-blue-300'],
  float: ['text-amber-700', 'dark:text-amber-300'],
  char: ['text-purple-700', 'dark:text-purple-300'],
  bool: ['text-rose-700', 'dark:text-rose-300'],
  pointer: ['text-green-700', 'dark:text-green-300'],
  struct: ['text-cyan-700', 'dark:text-cyan-300'],
  array: ['text-orange-700', 'dark:text-orange-300'],
}

const KIND_BORDER: Record<Kind, string[]> = {
  int: ['border-blue-400', 'dark:border-blue-500'],
  float: ['border-amber-400', 'dark:border-amber-500'],
  char: ['border-purple-400', 'dark:border-purple-500'],
  bool: ['border-rose-400', 'dark:border-rose-500'],
  pointer: ['border-green-400', 'dark:border-green-500'],
  struct: ['border-cyan-400', 'dark:border-cyan-500'],
  array: ['border-orange-400', 'dark:border-orange-500'],
}

const rowClasses = computed(() => {
  const cs: string[] = []

  if (!props.allocation) {
    cs.push('bg-transparent')
  }
  else if (props.isDead) {
    cs.push('opacity-40', 'bg-gray-100', 'dark:bg-gray-800/40')
  }
  else if (props.isPadding) {
    cs.push('byte-cell-padding', 'bg-gray-100', 'dark:bg-gray-800/40')
  }
  else if (kind.value) {
    cs.push(...KIND_BG[kind.value])
  }

  // Allocation boundary: stronger left border in the kind colour
  if (props.isBoundary && props.allocation && !props.isDead && kind.value)
    cs.push('border-l-2', ...KIND_BORDER[kind.value])

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
  else if (kind.value) {
    cs.push(...KIND_TEXT[kind.value])
  }
  return cs
})
</script>

<template>
  <div
    :data-address="address"
    class="h-7 flex cursor-pointer items-center gap-1.5 px-1.5 transition-colors hover:brightness-95 dark:hover:brightness-110"
    :class="rowClasses"
    @mouseenter="$emit('hover', address)"
    @mouseleave="$emit('hover', null)"
    @click="$emit('click', address)"
  >
    <span :class="hexClasses">{{ hex }}</span>
  </div>
</template>

<style scoped>
.byte-cell-padding {
  background-image: repeating-linear-gradient(
    45deg,
    transparent 0 2px,
    color-mix(in srgb, currentColor 8%, transparent) 2px 4px
  );
}
</style>
