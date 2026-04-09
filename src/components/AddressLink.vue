<script setup lang="ts">
import { computed } from 'vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  address: number
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hover: [address: number | null]
}>()

const isNull = computed(() => props.address === NULL_ADDRESS)
const label = computed(() => isNull.value ? 'NULL' : `0x${props.address.toString(16).padStart(3, '0')}`)
</script>

<template>
  <span
    class="cursor-pointer font-mono hover:underline"
    :class="isNull ? 'text-red-400' : 'text-green-400'"
    @click.stop="!isNull && emit('navigate', address)"
    @pointerenter="!isNull && emit('hover', address)"
    @pointerleave="emit('hover', null)"
  >{{ label }}</span>
</template>
