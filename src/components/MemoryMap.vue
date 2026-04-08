<script setup lang="ts">
import type { CppType, CppValue, InterpreterContext, MemoryCell as MemoryCellType } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  changedAddresses: ReadonlySet<number>
  highlightedAddress?: number | null
  highlightedFieldAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
}>()

const hoveredTarget = shallowRef<number | null>(null)

// ---- Helpers ----

function getFieldValues(cell: MemoryCellType): Map<string, { type: CppType, value: CppValue, address: number }> | undefined {
  if (typeof cell.type !== 'object' || cell.type.type !== 'struct')
    return undefined
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

function formatAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(2, '0')}`
}

function formatValue(value: CppValue): string {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value === 'object') {
    if (value.type === 'pointer')
      return value.address === NULL_ADDRESS ? 'NULL' : formatAddr(value.address)
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

function isCellHighlighted(address: number): boolean {
  return props.highlightedAddress === address
}

function isFieldHighlighted(fieldAddress: number): boolean {
  return props.highlightedFieldAddress === fieldAddress
}

function handleHoverPointer(address: number | null) {
  hoveredTarget.value = address
}

function handleClickPointer(address: number) {
  if (address !== NULL_ADDRESS)
    emit('selectCell', address)
}

// ---- Stack entries ----

interface StackEntry {
  name: string
  type: CppType
  address: number
  cell: MemoryCellType
  inScope: boolean
  fields?: Map<string, { type: CppType, value: CppValue, address: number }>
}

const stackEntries = computed(() => {
  const entries: StackEntry[] = []
  const envLen = props.context.envStack.length

  // All envStack entries are in the current function — never dim them
  for (let i = envLen - 1; i >= 0; i--) {
    const env = props.context.envStack[i]
    for (const [name, entry] of Object.entries(env)) {
      const cell = props.context.memory.cells.get(entry.address)
      if (!cell || cell.dead)
        continue
      entries.push({
        name,
        type: entry.type,
        address: entry.address,
        cell,
        inScope: true,
        fields: getFieldValues(cell),
      })
    }
  }

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
          inScope: false,
          fields: getFieldValues(cell),
        })
      }
    }
  }

  for (const [name, entry] of Object.entries(props.context.globalEnv)) {
    const cell = props.context.memory.cells.get(entry.address)
    if (!cell || cell.dead)
      continue
    entries.push({
      name,
      type: entry.type,
      address: entry.address,
      cell,
      inScope: false,
      fields: getFieldValues(cell),
    })
  }

  return entries
})

// ---- Heap entries ----

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

// Scroll highlighted cell into view
const containerRef = useTemplateRef('memory-map-container')

watch(() => props.highlightedAddress, (addr) => {
  if (addr === null || addr === undefined || !containerRef.value)
    return
  const el = containerRef.value.querySelector(`[data-address="${addr}"]`)
  if (el)
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

// Also scroll when hovering pointer values within the memory map
watch(hoveredTarget, (addr) => {
  if (addr === null || addr === undefined || addr === NULL_ADDRESS || !containerRef.value)
    return
  const el = containerRef.value.querySelector(`[data-address="${addr}"]`)
  if (el)
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

watch(() => props.highlightedFieldAddress, (addr) => {
  if (addr === null || addr === undefined || !containerRef.value)
    return
  const el = containerRef.value.querySelector(`[data-field-address="${addr}"]`)
  if (el)
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})
</script>

<template>
  <div ref="memory-map-container" class="h-full flex gap-2 overflow-hidden p-2">
    <!-- Stack column -->
    <div class="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      <div class="mb-1 text-[10px] text-gray-500 tracking-wide uppercase">
        Stack
      </div>
      <TransitionGroup name="stack-cell">
        <div
          v-for="entry in stackEntries"
          :key="entry.address"
          :data-address="entry.address"
          class="cursor-pointer border-l-3 border-transparent rounded bg-gray-50 font-mono transition-all duration-200 dark:bg-gray-800/80"
          :class="{
            'border-l-yellow-400!': changedAddresses.has(entry.address),
            'border-l-blue-400!': hoveredTarget === entry.address || isCellHighlighted(entry.address),
            'opacity-40': !entry.inScope,
          }"
          @click="emit('selectCell', entry.address)"
        >
          <!-- Address bar: address left, var name + type right -->
          <div class="flex items-center justify-between rounded-t bg-gray-200/80 px-2 py-0.5 text-[10px] dark:bg-gray-700/50">
            <span class="text-gray-500 dark:text-gray-400">{{ formatAddr(entry.address) }}</span>
            <div class="flex items-center gap-1">
              <span class="text-blue-600/80 dark:text-blue-300/80">{{ entry.name }}</span>
              <span class="text-gray-400 dark:text-gray-500">{{ formatType(entry.type) }}</span>
            </div>
          </div>

          <!-- Value area -->
          <div class="px-2 py-1 text-xs">
            <!-- Struct: show fields -->
            <template v-if="entry.fields">
              <div
                v-for="[name, field] in entry.fields"
                :key="name"
                :data-field-address="field.address"
                class="flex items-baseline justify-between py-0.5 transition-colors"
                :class="{ 'bg-blue-500/15 rounded px-1 -mx-1': isFieldHighlighted(field.address) }"
              >
                <span class="text-gray-500">{{ name }}</span>
                <span
                  v-if="isPointerValue(field.value)"
                  class="cursor-pointer hover:underline"
                  :class="field.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
                  @click.stop="handleClickPointer(field.value.address)"
                  @pointerenter="handleHoverPointer(field.value.address)"
                  @pointerleave="handleHoverPointer(null)"
                >{{ formatValue(field.value) }}</span>
                <span v-else class="text-orange-600 font-semibold dark:text-orange-300">{{ formatValue(field.value) }}</span>
              </div>
            </template>

            <!-- Pointer -->
            <template v-else-if="isPointerValue(entry.cell.value)">
              <span
                class="cursor-pointer hover:underline"
                :class="entry.cell.value.address === NULL_ADDRESS ? 'text-red-400' : 'text-green-400'"
                @click.stop="handleClickPointer(entry.cell.value.address)"
                @pointerenter="handleHoverPointer(entry.cell.value.address)"
                @pointerleave="handleHoverPointer(null)"
              >{{ formatValue(entry.cell.value) }}</span>
            </template>

            <!-- Primitive -->
            <template v-else>
              <span class="text-orange-600 font-semibold dark:text-orange-300">{{ formatValue(entry.cell.value) }}</span>
            </template>
          </div>
        </div>
      </TransitionGroup>

      <div v-if="stackEntries.length === 0" class="text-xs text-gray-500 italic">
        No stack variables
      </div>
    </div>

    <!-- Heap column -->
    <div class="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      <div class="mb-1 text-[10px] text-gray-500 tracking-wide uppercase">
        Heap
      </div>
      <MemoryCell
        v-for="entry in heapEntries"
        :key="entry.cell.address"
        :data-address="entry.cell.address"
        :cell="entry.cell"
        :field-values="entry.fields"
        :changed="changedAddresses.has(entry.cell.address)"
        :highlighted-field-address="highlightedFieldAddress"
        :class="{ 'border-l-blue-400!': hoveredTarget === entry.cell.address || isCellHighlighted(entry.cell.address) }"
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

<style scoped>
.stack-cell-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.stack-cell-enter-active {
  transition: all 0.25s ease-out;
}
.stack-cell-leave-active {
  transition: all 0.3s ease-in;
  position: absolute;
  width: 100%;
}
.stack-cell-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.stack-cell-move {
  transition: transform 0.3s ease;
}
</style>
