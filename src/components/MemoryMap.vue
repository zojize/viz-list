<script setup lang="ts">
import type { CppType, CppValue, InterpreterContext, MemoryCell as MemoryCellType } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  changedAddresses: ReadonlySet<number>
}>()

const emit = defineEmits<{
  selectCell: [address: number]
}>()

const hoveredTarget = ref<number | null>(null)

// ---- Stack: show ALL scopes (not just current), with variable names and types ----

interface StackEntry {
  name: string
  type: CppType
  address: number
  cell: MemoryCellType
  scope: string
  dimmed: boolean // true for variables outside the current innermost scope
  fields?: Map<string, { type: CppType, value: CppValue, address: number }>
}

function getFieldValues(cell: MemoryCellType): Map<string, { type: CppType, value: CppValue, address: number }> | undefined {
  if (typeof cell.type !== 'object' || cell.type.type !== 'struct')
    return undefined
  // Use the struct's base address from the value, not the cell's own address
  const structValue = cell.value
  if (typeof structValue !== 'object' || structValue.type !== 'struct')
    return undefined
  const base = structValue.base
  const structDef = props.context.structs[cell.type.name]
  if (!structDef)
    return undefined
  const map = new Map<string, { type: CppType, value: CppValue, address: number }>()
  const fieldNames = Object.keys(structDef)
  for (let i = 0; i < fieldNames.length; i++) {
    const fieldAddr = base + 1 + i
    const fieldCell = props.context.memory.cells.get(fieldAddr)
    if (fieldCell)
      map.set(fieldNames[i], { type: structDef[fieldNames[i]], value: fieldCell.value, address: fieldAddr })
  }
  return map
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

const stackEntries = computed(() => {
  const entries: StackEntry[] = []

  // Current function's scopes (envStack), innermost first
  const envLen = props.context.envStack.length
  for (let i = envLen - 1; i >= 0; i--) {
    const env = props.context.envStack[i]
    const isCurrentScope = i === envLen - 1
    for (const [name, entry] of Object.entries(env)) {
      const cell = props.context.memory.cells.get(entry.address)
      if (!cell || cell.dead)
        continue
      entries.push({
        name,
        type: entry.type,
        address: entry.address,
        cell,
        scope: i === 0 ? 'current' : `scope ${i}`,
        dimmed: !isCurrentScope,
        fields: getFieldValues(cell),
      })
    }
  }

  // Caller scopes from callStack (newest caller first)
  for (let ci = props.context.callStack.length - 1; ci >= 0; ci--) {
    const savedEnvs = props.context.callStack[ci].env
    for (let i = savedEnvs.length - 1; i >= 0; i--) {
      const env = savedEnvs[i]
      for (const [name, entry] of Object.entries(env)) {
        const cell = props.context.memory.cells.get(entry.address)
        if (!cell || cell.dead)
          continue
        entries.push({
          name,
          type: entry.type,
          address: entry.address,
          cell,
          scope: `caller ${ci}`,
          dimmed: true,
          fields: getFieldValues(cell),
        })
      }
    }
  }

  // Globals
  for (const [name, entry] of Object.entries(props.context.globalEnv)) {
    const cell = props.context.memory.cells.get(entry.address)
    if (!cell || cell.dead)
      continue
    entries.push({
      name,
      type: entry.type,
      address: entry.address,
      cell,
      scope: 'global',
      dimmed: envLen > 0,
      fields: getFieldValues(cell),
    })
  }
  return entries
})

// ---- Heap: all live struct headers ----

interface HeapEntry {
  cell: MemoryCellType
  fields?: Map<string, { type: CppType, value: CppValue, address: number }>
}

const heapEntries = computed(() => {
  const entries: HeapEntry[] = []
  for (const cell of props.context.memory.cells.values()) {
    if (cell.dead || cell.region !== 'heap')
      continue
    if (typeof cell.type !== 'object' || cell.type.type !== 'struct')
      continue
    entries.push({ cell, fields: getFieldValues(cell) })
  }
  return entries
})

function handleHoverPointer(address: number | null) {
  hoveredTarget.value = address
}

function handleClickPointer(address: number) {
  if (address !== NULL_ADDRESS)
    emit('selectCell', address)
}

function formatAddress(addr: number): string {
  return `0x${addr.toString(16).padStart(2, '0')}`
}

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : formatAddress(value.address)
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
</script>

<template>
  <div class="h-full flex gap-2 overflow-hidden p-2">
    <!-- Stack column -->
    <div class="flex flex-1 flex-col gap-1 overflow-y-auto">
      <div class="text-[10px] text-gray-500 tracking-wide uppercase">
        Stack
      </div>
      <div
        v-for="entry in stackEntries"
        :key="entry.address"
        class="cursor-pointer border-l-3 border-transparent rounded bg-gray-100 p-2 text-xs font-mono transition-all dark:bg-gray-800"
        :class="{
          'border-l-yellow-400!': changedAddresses.has(entry.address),
          'border-l-blue-400!': hoveredTarget === entry.address,
          'opacity-50': entry.dimmed,
        }"
        @click="emit('selectCell', entry.address)"
      >
        <!-- Variable header: name, type, scope -->
        <div class="mb-1 flex items-center justify-between gap-1">
          <div class="flex items-center gap-1.5">
            <span class="text-blue-300 font-bold">{{ entry.name }}</span>
            <span class="text-[10px] text-gray-500">{{ formatType(entry.type) }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-[9px] text-gray-600">{{ entry.scope }}</span>
            <span class="text-[10px] text-gray-500">{{ formatAddress(entry.address) }}</span>
          </div>
        </div>

        <!-- Struct: show fields inline -->
        <template v-if="entry.fields">
          <div
            v-for="[name, field] in entry.fields"
            :key="name"
            class="flex justify-between py-0.5"
          >
            <span class="text-gray-500">{{ name }}:</span>
            <span
              v-if="isPointerValue(field.value)"
              class="cursor-pointer text-green-400 hover:underline"
              :class="{ 'text-red-400!': field.value.address === NULL_ADDRESS }"
              @click.stop="handleClickPointer(field.value.address)"
              @pointerenter="handleHoverPointer(field.value.address)"
              @pointerleave="handleHoverPointer(null)"
            >{{ formatValue(field.value) }}</span>
            <span v-else class="text-orange-300">{{ formatValue(field.value) }}</span>
          </div>
        </template>

        <!-- Pointer: just show the address -->
        <template v-else-if="isPointerValue(entry.cell.value)">
          <span
            class="cursor-pointer text-green-400 hover:underline"
            :class="{ 'text-red-400!': entry.cell.value.address === NULL_ADDRESS }"
            @click.stop="handleClickPointer(entry.cell.value.address)"
            @pointerenter="handleHoverPointer(entry.cell.value.address)"
            @pointerleave="handleHoverPointer(null)"
          >{{ formatValue(entry.cell.value) }}</span>
        </template>

        <!-- Primitive: show value -->
        <template v-else>
          <span class="text-orange-300">{{ formatValue(entry.cell.value) }}</span>
        </template>
      </div>

      <div v-if="stackEntries.length === 0" class="text-xs text-gray-500 italic">
        No stack variables
      </div>
    </div>

    <!-- Heap column -->
    <div class="flex flex-1 flex-col gap-1 overflow-y-auto">
      <div class="text-[10px] text-gray-500 tracking-wide uppercase">
        Heap
      </div>
      <MemoryCell
        v-for="entry in heapEntries"
        :key="entry.cell.address"
        :cell="entry.cell"
        :field-values="entry.fields"
        :changed="changedAddresses.has(entry.cell.address)"
        :class="{ 'border-l-blue-400!': hoveredTarget === entry.cell.address }"
        @click-pointer="handleClickPointer"
        @hover-pointer="handleHoverPointer"
        @click-cell="emit('selectCell', $event)"
      />
      <div v-if="heapEntries.length === 0" class="text-xs text-gray-500 italic">
        No heap allocations
      </div>
    </div>
  </div>
</template>
