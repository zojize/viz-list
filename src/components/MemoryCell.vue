<script setup lang="ts">
import type { CppType, CppValue, MemoryCell } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  cell: MemoryCell
  fields?: Record<string, CppType>
  fieldValues?: Map<string, { type: CppType, value: CppValue, address: number }>
  changed?: boolean
  highlightedFieldAddress?: number | null
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

function formatType(type: CppType): string {
  if (typeof type === 'string')
    return type
  if (type.type === 'pointer')
    return `${formatType(type.to)}*`
  if (type.type === 'array')
    return `${formatType(type.of)}[${type.size}]`
  if (type.type === 'struct')
    return type.name
  return '?'
}

function isPointerValue(value: CppValue): value is { type: 'pointer', address: number } {
  return typeof value === 'object' && value.type === 'pointer'
}

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})
</script>

<template>
  <div
    class="cursor-pointer border-l-3 border-transparent rounded bg-gray-100 p-2 text-xs transition-all dark:bg-gray-800"
    :class="{
      'border-l-yellow-400!': changed,
    }"
    @click="emit('clickCell', cell.address)"
  >
    <!-- Header: struct name prominent, address + type subtle -->
    <div class="mb-1.5 flex items-baseline justify-between gap-2">
      <div class="flex items-baseline gap-1.5">
        <span v-if="structName" class="text-sm text-purple-600 font-bold dark:text-purple-400">{{ structName }}</span>
        <span v-else class="text-sm text-gray-600 dark:text-gray-400">{{ formatType(cell.type) }}</span>
      </div>
      <span class="text-[10px] text-gray-500 font-mono">{{ `0x${cell.address.toString(16).padStart(2, '0')}` }}</span>
    </div>

    <!-- Struct with fields -->
    <template v-if="fieldValues && structName">
      <div
        v-for="[name, field] in fieldValues"
        :key="name"
        :data-field-address="field.address"
        class="flex items-baseline justify-between border-b border-gray-200 py-1 font-mono transition-colors last:border-b-0 dark:border-gray-200/10"
        :class="{ 'bg-blue-500/15 rounded px-1 -mx-1': highlightedFieldAddress === field.address }"
      >
        <div class="flex items-baseline gap-1.5">
          <span class="text-gray-500">{{ name }}</span>
          <span class="text-[9px] text-gray-600">{{ formatType(field.type) }}</span>
        </div>
        <span
          v-if="isPointerValue(field.value)"
          class="cursor-pointer font-mono hover:underline"
          :class="field.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
          @click.stop="emit('clickPointer', field.value.address)"
          @pointerenter="emit('hoverPointer', field.value.address)"
          @pointerleave="emit('hoverPointer', null)"
        >{{ formatValue(field.value) }}</span>
        <span v-else class="text-orange-600 font-semibold font-mono dark:text-orange-300">{{ formatValue(field.value) }}</span>
      </div>
    </template>

    <!-- Primitive value -->
    <template v-else>
      <div class="font-mono">
        <span
          v-if="isPointerValue(cell.value)"
          class="cursor-pointer hover:underline"
          :class="cell.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
          @click.stop="emit('clickPointer', cell.value.address)"
          @pointerenter="emit('hoverPointer', cell.value.address)"
          @pointerleave="emit('hoverPointer', null)"
        >{{ formatValue(cell.value) }}</span>
        <span v-else class="text-orange-300 font-semibold">{{ formatValue(cell.value) }}</span>
      </div>
    </template>
  </div>
</template>
