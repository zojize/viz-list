<script setup lang="ts">
import type { CppType, CppValue, MemoryCell } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import DSValue from '~/components/DSValue.vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'
import { useInterpreterContext } from '~/composables/useInterpreterContext'

const props = defineProps<{
  cell: MemoryCell
  changedAddresses: ReadonlySet<number>
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hoverField: [address: number | null]
  hoverPointer: [address: number | null]
}>()

const context = useInterpreterContext()

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : `0x${value.address.toString(16).padStart(3, '0')}`
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

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})

const isArray = computed(() => {
  return typeof props.cell.value === 'object' && props.cell.value.type === 'array'
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

// ---- Referenced-by: find all pointer cells pointing to this cell's address ----

interface RefEntry {
  address: number
  label: string
}

const referencedBy = computed((): RefEntry[] => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memory.version // reactive dependency
  const targetAddr = props.cell.address
  const refs: RefEntry[] = []
  for (const cell of context.memory.cells.values()) {
    if (cell.dead)
      continue
    if (typeof cell.value === 'object' && cell.value.type === 'pointer' && cell.value.address === targetAddr)
      refs.push({ address: cell.address, label: `0x${cell.address.toString(16).padStart(3, '0')}` })
  }
  return refs
})

const fields = computed((): FieldRow[] => {
  if (!structName.value)
    return []
  const structDef = context.structs[structName.value]
  if (!structDef)
    return []
  const base = structBase.value
  return Object.keys(structDef).map((name, i) => {
    const addr = base + 1 + i
    const fieldCell = context.memory.cells.get(addr)
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
  <div data-testid="field-table" class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span v-if="structName" class="text-accent-cyan font-bold">{{ structName }}</span>
      <span class="text-xs text-gray-500 font-mono">at 0x{{ cell.address.toString(16).padStart(3, '0') }}</span>
      <span
        class="rounded px-1.5 py-0.5 text-[10px]"
        :class="{
          'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300': cell.region === 'heap',
          'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300': cell.region === 'stack',
          'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300': cell.region === 'global',
        }"
      >{{ cell.region }}</span>
    </div>
    <!-- Array / general: recursive rendering -->
    <div v-if="isArray" class="rounded bg-gray-100 p-2 dark:bg-gray-800">
      <DSValue
        :cell="cell"
        :context="context"
        @navigate="emit('navigate', $event)"
      />
    </div>

    <!-- Struct fields -->
    <div v-else-if="fields.length" class="rounded bg-gray-100 dark:bg-gray-800">
      <template v-for="field in fields" :key="field.name">
        <!-- Complex value (struct/array): own row with value below -->
        <div
          v-if="typeof field.value === 'object' && (field.value.type === 'struct' || field.value.type === 'array')"
          :data-testid="`field-${field.name}`"
          class="border-b border-gray-200 px-3 py-1.5 text-xs font-mono last:border-b-0 dark:border-gray-700"
          :class="{ 'bg-yellow-500/10': field.changed }"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-gray-400">{{ field.name }}:</span>
            <span class="text-[10px] text-gray-600">{{ formatType(field.type) }}</span>
          </div>
          <div class="pl-2 pt-0.5">
            <DSValue
              :cell="context.memory.cells.get(field.address)!"

              @navigate="emit('navigate', $event)"
            />
          </div>
        </div>
        <!-- Simple value: inline row -->
        <div
          v-else
          :data-testid="`field-${field.name}`"
          class="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 text-xs font-mono last:border-b-0 dark:border-gray-700"
          :class="{ 'bg-yellow-500/10': field.changed }"
        >
          <span class="text-gray-400">{{ field.name }}</span>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-gray-600">{{ formatType(field.type) }}</span>
            <AddressLink
              v-if="field.isPointer"
              :address="field.pointerAddress"
              @navigate="emit('navigate', $event)"
            />
            <span v-else class="text-orange-600 font-bold dark:text-orange-300">{{ formatValue(field.value) }}</span>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="rounded bg-gray-100 px-3 py-2 text-xs font-mono dark:bg-gray-800">
      <span class="text-[10px] text-gray-600">{{ formatType(cell.type) }}</span>
      <span class="ml-2 text-orange-600 font-bold dark:text-orange-300">{{ formatValue(cell.value) }}</span>
    </div>

    <!-- Referenced by -->
    <div v-if="referencedBy.length > 0" class="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
      <div class="mb-1 text-[10px] text-gray-500 tracking-wide uppercase">
        Referenced by
      </div>
      <div class="flex flex-wrap gap-1">
        <AddressLink
          v-for="ref in referencedBy"
          :key="ref.address"
          :address="ref.address"
          class="text-xs"
          @navigate="emit('navigate', $event)"
          @hover="(addr) => { emit('hoverField', addr); emit('hoverPointer', addr) }"
        />
      </div>
    </div>
  </div>
</template>
