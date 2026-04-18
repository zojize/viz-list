<script setup lang="ts">
import type { CppType, CppValue } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import { formatAddr, formatType, formatValue, isPointerValue } from '~/composables/interpreter/helpers'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

/** Temporary shim — MemoryCell was removed in the byte-addressed refactor.
 *  MemoryCell.vue and its caller MemoryMap.vue will be replaced in Task 16. */
interface MemoryCell {
  address: number
  type: CppType
  value: CppValue
  region: import('~/composables/interpreter/types').MemoryRegion
  dead: boolean
}

const props = defineProps<{
  cell: MemoryCell
  fields?: Record<string, CppType>
  fieldValues?: Map<string, { type: CppType, value: CppValue, address: number }>
  changed?: boolean
  highlightedFieldAddress?: number | null
}>()

const emit = defineEmits<{
  clickPointer: [address: number]
  /** Emitted when the user hovers a pointer field/value inside this cell.
   *  `target` is the pointed-to address (null on leave); `source` is the
   *  byte address of the pointer itself, for arrow rendering. */
  hoverPointer: [target: number | null, source: number]
  clickCell: [address: number]
}>()

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})
</script>

<template>
  <div
    class="cursor-pointer border border-l-3 border-gray-200 border-l-transparent rounded-md bg-white p-2 text-xs shadow-sm transition-all dark:border-gray-700 dark:bg-gray-900"
    :class="{
      'border-l-yellow-400!': changed,
    }"
    @click="emit('clickCell', cell.address)"
  >
    <!-- Header: struct name prominent, address + type subtle -->
    <div class="mb-1.5 flex items-baseline justify-between gap-2">
      <div class="flex items-baseline gap-1.5">
        <span v-if="structName" class="text-sm text-accent-cyan font-bold">{{ structName }}</span>
        <span v-else class="text-sm text-gray-600 dark:text-gray-400">{{ formatType(cell.type) }}</span>
      </div>
      <span class="text-[10px] text-gray-500 font-mono">{{ formatAddr(cell.address) }}</span>
    </div>

    <!-- Struct with fields -->
    <template v-if="fieldValues && structName">
      <div
        v-for="[name, field] in fieldValues"
        :key="name"
        :data-field-address="field.address"
        class="flex items-baseline justify-between gap-4 border-b border-gray-200 py-1 font-mono transition-colors last:border-b-0 dark:border-gray-200/10"
        :class="{ 'bg-blue-500/15! rounded px-1 -mx-1': highlightedFieldAddress === field.address }"
      >
        <span class="shrink-0 text-gray-500">{{ name }}</span>
        <AddressLink
          v-if="isPointerValue(field.value)"
          :address="field.value.address"
          :source-address="field.address"
          @navigate="emit('clickPointer', $event)"
          @hover="emit('hoverPointer', $event, field.address)"
        />
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
          @pointerenter="emit('hoverPointer', cell.value.address, cell.address)"
          @pointerleave="emit('hoverPointer', null, cell.address)"
        >{{ formatValue(cell.value) }}</span>
        <span v-else class="text-orange-300 font-semibold">{{ formatValue(cell.value) }}</span>
      </div>
    </template>
  </div>
</template>
