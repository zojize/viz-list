<script setup lang="ts">
import type { CppType, CppValue, MemoryCell } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  cell: MemoryCell
  fields?: Record<string, CppType>
  fieldValues?: Map<string, { type: CppType, value: CppValue, address: number }>
  changed?: boolean
}>()

const emit = defineEmits<{
  clickPointer: [address: number]
  hoverPointer: [address: number | null]
  clickCell: [address: number]
}>()

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : `0x${value.address.toString(16).padStart(2, '0')}`
    if (value.type === 'struct')
      return `${value.name} {...}`
    if (value.type === 'array')
      return `[${value.length}]`
  }
  return String(value)
}

function isPointerValue(value: CppValue): value is { type: 'pointer', address: number } {
  return typeof value === 'object' && value.type === 'pointer'
}

function formatAddress(addr: number): string {
  return `0x${addr.toString(16).padStart(2, '0')}`
}

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})
</script>

<template>
  <div
    class="cursor-pointer border-l-3 border-transparent rounded bg-gray-100 p-2 text-xs font-mono transition-all dark:bg-gray-800"
    :class="{
      'border-l-yellow-400!': changed,
    }"
    @click="emit('clickCell', cell.address)"
  >
    <div class="mb-1 flex items-center justify-between">
      <span class="text-gray-400">{{ formatAddress(cell.address) }}</span>
      <span v-if="structName" class="text-[10px] text-purple-400">{{ structName }}</span>
    </div>

    <!-- Struct with fields -->
    <template v-if="fieldValues && structName">
      <div
        v-for="[name, field] in fieldValues"
        :key="name"
        class="flex justify-between py-0.5"
      >
        <span class="text-gray-500">{{ name }}:</span>
        <span
          v-if="isPointerValue(field.value)"
          class="cursor-pointer text-green-400 hover:underline"
          :class="{ 'text-red-400!': field.value.address === NULL_ADDRESS }"
          @click.stop="emit('clickPointer', field.value.address)"
          @pointerenter="emit('hoverPointer', field.value.address)"
          @pointerleave="emit('hoverPointer', null)"
        >{{ formatValue(field.value) }}</span>
        <span v-else class="text-orange-300">{{ formatValue(field.value) }}</span>
      </div>
    </template>

    <!-- Primitive -->
    <template v-else>
      <span
        v-if="isPointerValue(cell.value)"
        class="cursor-pointer text-green-400 hover:underline"
        :class="{ 'text-red-400!': cell.value.address === NULL_ADDRESS }"
        @click.stop="emit('clickPointer', cell.value.address)"
        @pointerenter="emit('hoverPointer', cell.value.address)"
        @pointerleave="emit('hoverPointer', null)"
      >{{ formatValue(cell.value) }}</span>
      <span v-else class="text-orange-300">{{ formatValue(cell.value) }}</span>
    </template>
  </div>
</template>
