<script setup lang="ts">
import type { CppType, CppValue, InterpreterContext, MemoryCell } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  cell: MemoryCell
  context: Readonly<InterpreterContext>
  changedAddresses: ReadonlySet<number>
}>()

const emit = defineEmits<{
  navigate: [address: number]
}>()

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : `0x${value.address.toString(16).padStart(2, '0')}`
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

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})

interface FieldRow {
  name: string
  type: CppType
  value: CppValue
  address: number
  isPointer: boolean
  pointerAddress: number
  changed: boolean
}

const structBase = computed(() => {
  const v = props.cell.value
  if (typeof v === 'object' && v.type === 'struct')
    return v.base
  return props.cell.address
})

const fields = computed((): FieldRow[] => {
  if (!structName.value)
    return []
  const structDef = props.context.structs[structName.value]
  if (!structDef)
    return []
  const base = structBase.value
  return Object.keys(structDef).map((name, i) => {
    const addr = base + 1 + i
    const fieldCell = props.context.memory.cells.get(addr)
    const value = fieldCell?.value ?? 0
    return {
      name,
      type: structDef[name],
      value,
      address: addr,
      isPointer: typeof value === 'object' && value.type === 'pointer',
      pointerAddress: (typeof value === 'object' && value.type === 'pointer') ? value.address : 0,
      changed: props.changedAddresses.has(addr),
    }
  })
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span v-if="structName" class="text-purple-600 font-bold dark:text-purple-400">{{ structName }}</span>
      <span class="text-xs text-gray-500 font-mono">at 0x{{ cell.address.toString(16).padStart(2, '0') }}</span>
      <span
        class="rounded px-1.5 py-0.5 text-[10px]"
        :class="{
          'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300': cell.region === 'heap',
          'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300': cell.region === 'stack',
          'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300': cell.region === 'global',
        }"
      >{{ cell.region }}</span>
    </div>
    <div v-if="fields.length" class="rounded bg-gray-100 dark:bg-gray-800">
      <div
        v-for="field in fields"
        :key="field.name"
        class="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 text-xs font-mono last:border-b-0 dark:border-gray-700"
        :class="{ 'bg-yellow-500/10': field.changed }"
      >
        <span class="text-gray-400">{{ field.name }}</span>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-600">{{ formatType(field.type) }}</span>
          <span
            v-if="field.isPointer"
            class="cursor-pointer font-bold hover:underline"
            :class="field.pointerAddress === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
            @click="field.pointerAddress !== NULL_ADDRESS && emit('navigate', field.pointerAddress)"
          >{{ formatValue(field.value) }}</span>
          <span v-else class="text-orange-600 font-bold dark:text-orange-300">{{ formatValue(field.value) }}</span>
        </div>
      </div>
    </div>
    <div v-else class="rounded bg-gray-100 px-3 py-2 text-xs font-mono dark:bg-gray-800">
      <span class="text-[10px] text-gray-600">{{ formatType(cell.type) }}</span>
      <span class="ml-2 text-orange-600 font-bold dark:text-orange-300">{{ formatValue(cell.value) }}</span>
    </div>
  </div>
</template>
