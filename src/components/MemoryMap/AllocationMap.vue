<script setup lang="ts">
import type { LayoutNode } from '~/composables/interpreter/layout'
import type { Allocation, CppType, CppValue } from '~/composables/interpreter/types'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import DSValue from '~/components/DSValue.vue'
import MemoryCell from '~/components/MemoryCell.vue'
import { formatAddr, formatType, isPointerValue } from '~/composables/interpreter/helpers'
import { NULL_ADDRESS } from '~/composables/interpreter/types'
import { useInterpreterContext } from '~/composables/useInterpreterContext'

const props = defineProps<{
  changedAddresses: ReadonlySet<number>
  highlightedAddress?: number | null
  highlightedFieldAddress?: number | null
  /** Addresses involved in the current statement: LHS (write targets) */
  statementLhsAddresses?: ReadonlySet<number>
  /** Addresses involved in the current statement: RHS (read sources) */
  statementRhsAddresses?: ReadonlySet<number>
  /** Currently selected cell address (for selected state styling) */
  selectedAddress?: number | null
}>()

const emit = defineEmits<{
  selectCell: [address: number]
  hoverPointer: [address: number | null]
  hoverVariable: [name: string | null]
}>()

const context = useInterpreterContext()

const hoveredTarget = shallowRef<number | null>(null)
const hoverSource = shallowRef<'stack' | 'heap' | null>(null)

// ---- Synthetic cell type (mirrors the shim in MemoryCell.vue) ----

interface SyntheticCell {
  address: number
  type: CppType
  value: CppValue
  region: import('~/composables/interpreter/types').MemoryRegion
  dead: boolean
}

// ---- Helpers ----

function fieldNodeToType(node: LayoutNode): CppType {
  if (node.kind === 'scalar')
    return node.type
  if (node.kind === 'array')
    return { type: 'array', of: fieldNodeToType(node.element), size: node.length }
  return { type: 'struct', name: node.structName }
}

function layoutToType(alloc: Allocation): CppType {
  const l = alloc.layout
  if (l.kind === 'scalar')
    return l.type
  if (l.kind === 'array')
    return { type: 'array', of: fieldNodeToType(l.element), size: l.length }
  return { type: 'struct', name: l.structName }
}

function readValue(address: number, alloc: Allocation): CppValue {
  const l = alloc.layout
  if (l.kind === 'struct') {
    return { type: 'struct', name: l.structName, base: address }
  }
  if (l.kind === 'array') {
    return { type: 'array', base: address, length: l.length, elementType: fieldNodeToType(l.element) }
  }
  // scalar (including pointer)
  try {
    const v = context.memory.readScalar(address, l.type)
    return v
  }
  catch {
    return 0
  }
}

function makeSyntheticCell(address: number, alloc: Allocation): SyntheticCell {
  return {
    address,
    type: layoutToType(alloc),
    value: readValue(address, alloc),
    region: alloc.region,
    dead: alloc.dead,
  }
}

/** Build a field-values map for a struct allocation (equivalent to old getFieldValues) */
function getFieldValues(address: number, alloc: Allocation): Map<string, { type: CppType, value: CppValue, address: number }> | undefined {
  if (alloc.layout.kind !== 'struct')
    return undefined
  const structName = alloc.layout.structName
  const layout = context.structLayouts[structName]
  if (!layout || layout.kind !== 'struct')
    return undefined
  const map = new Map<string, { type: CppType, value: CppValue, address: number }>()
  for (const field of layout.fields) {
    const fieldAddr = address + field.offset
    const fieldType = fieldNodeToType(field.node)
    const fieldAlloc = context.memory.findAllocation(fieldAddr)
    const fieldValue: CppValue = fieldAlloc ? readValue(fieldAddr, fieldAlloc) : 0
    map.set(field.name, { type: fieldType, value: fieldValue, address: fieldAddr })
  }
  return map
}

function isFieldHighlighted(fieldAddress: number): boolean {
  return props.highlightedFieldAddress === fieldAddress
}

/** Whether this cell is being hovered from DS view or pointer hover */
function isHoverTarget(address: number): boolean {
  return hoveredTarget.value === address || props.highlightedAddress === address
}

/** Whether this cell has a code execution highlight (LHS/RHS/changed) */
function hasCodeHighlight(address: number): boolean {
  return isStatementLhs(address) || isStatementRhs(address) || props.changedAddresses.has(address)
}

/** Intensity 2: hover overlaps with existing code execution highlight */
function isHoverBoosted(address: number): boolean {
  if (props.selectedAddress === address)
    return false
  return isHoverTarget(address) && hasCodeHighlight(address)
}

function handleHoverPointerStack(address: number | null) {
  hoveredTarget.value = address
  hoverSource.value = address !== null ? 'stack' : null
  emit('hoverPointer', address)
}

function handleHoverPointerHeap(address: number | null) {
  hoveredTarget.value = address
  hoverSource.value = address !== null ? 'heap' : null
  emit('hoverPointer', address)
}

function handleClickPointer(address: number) {
  if (address !== NULL_ADDRESS)
    emit('selectCell', address)
}

function isStatementLhs(address: number): boolean {
  return !!props.statementLhsAddresses?.has(address)
}

function isStatementRhs(address: number): boolean {
  return !!props.statementRhsAddresses?.has(address)
}

// ---- Stack entries ----

interface StackEntry {
  name: string
  type: CppType
  address: number
  cell: SyntheticCell
  inScope: boolean
  fields?: Map<string, { type: CppType, value: CppValue, address: number }>
}

const stackEntries = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  const entries: StackEntry[] = []
  const envLen = context.envStack.length

  // All envStack entries are in the current function — never dim them
  for (let i = envLen - 1; i >= 0; i--) {
    const env = context.envStack[i]
    for (const [name, entry] of Object.entries(env)) {
      const alloc = context.memory.findAllocation(entry.address)
      if (!alloc || alloc.dead)
        continue
      const cell = makeSyntheticCell(entry.address, alloc)
      entries.push({
        name,
        type: entry.type,
        address: entry.address,
        cell,
        inScope: true,
        fields: getFieldValues(entry.address, alloc),
      })
    }
  }

  for (let ci = context.callStack.length - 1; ci >= 0; ci--) {
    const savedEnvs = context.callStack[ci].env
    for (let i = savedEnvs.length - 1; i >= 0; i--) {
      const env = savedEnvs[i]
      for (const [name, entry] of Object.entries(env)) {
        const alloc = context.memory.findAllocation(entry.address)
        if (!alloc || alloc.dead)
          continue
        const cell = makeSyntheticCell(entry.address, alloc)
        entries.push({
          name,
          type: entry.type,
          address: entry.address,
          cell,
          inScope: false,
          fields: getFieldValues(entry.address, alloc),
        })
      }
    }
  }

  for (const [name, entry] of Object.entries(context.globalEnv)) {
    const alloc = context.memory.findAllocation(entry.address)
    if (!alloc || alloc.dead)
      continue
    const cell = makeSyntheticCell(entry.address, alloc)
    entries.push({
      name,
      type: entry.type,
      address: entry.address,
      cell,
      inScope: false,
      fields: getFieldValues(entry.address, alloc),
    })
  }

  return entries
})

// ---- Heap entries ----

interface HeapEntry {
  cell: SyntheticCell
  fields?: Map<string, { type: CppType, value: CppValue, address: number }>
}

const heapEntries = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  const entries: HeapEntry[] = []
  const subAllocationBases = new Set<number>()

  // First pass: collect all sub-allocation base addresses (struct fields and array elements)
  for (const alloc of context.memory.space.allocations.values()) {
    if (alloc.dead || alloc.region !== 'heap')
      continue
    const l = alloc.layout
    if (l.kind === 'struct') {
      // All byte addresses beyond the struct base belong to fields — skip them as top-level
      for (let i = 1; i < alloc.size; i++)
        subAllocationBases.add(alloc.base + i)
    }
    else if (l.kind === 'array') {
      for (let i = 1; i < alloc.size; i++)
        subAllocationBases.add(alloc.base + i)
    }
  }

  // Second pass: add all top-level heap allocations
  for (const alloc of context.memory.space.allocations.values()) {
    if (alloc.dead || alloc.region !== 'heap')
      continue
    if (subAllocationBases.has(alloc.base))
      continue
    const cell = makeSyntheticCell(alloc.base, alloc)
    entries.push({ cell, fields: getFieldValues(alloc.base, alloc) })
  }
  return entries
})

const stackAllocCount = computed(() => stackEntries.value.length)
const heapAllocCount = computed(() => heapEntries.value.length)

// Scroll highlighted cell into view
const containerRef = useTemplateRef('memory-map-container')

watch(() => props.highlightedAddress, (addr) => {
  if (addr === null || addr === undefined || !containerRef.value)
    return
  const el = containerRef.value.querySelector(`[data-address="${addr}"]`)
  if (el)
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

// Scroll when hovering pointer values — only cross-column (stack→heap or heap→stack)
watch(hoveredTarget, (addr) => {
  if (addr === null || addr === undefined || addr === NULL_ADDRESS || !containerRef.value)
    return
  // Determine which column the target is in
  const targetAlloc = context.memory.findAllocation(addr)
  if (!targetAlloc)
    return
  const targetColumn = targetAlloc.region === 'heap' ? 'heap' : 'stack'
  // Only scroll if target is in a different column than where the hover originated
  if (hoverSource.value === targetColumn)
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
  <div ref="memory-map-container" data-testid="memory-map" class="h-full flex gap-2 overflow-hidden p-2">
    <!-- Stack column -->
    <div data-testid="stack-column" class="min-h-0 flex flex-1 flex-col border border-gray-200 rounded-lg dark:border-gray-800">
      <!-- Sticky header -->
      <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
        <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">Stack</span>
        <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
          {{ stackAllocCount }} allocations
        </span>
      </div>
      <!-- Scrollable body -->
      <div class="scrollbar-hidden min-h-0 flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
        <TransitionGroup name="stack-cell">
          <div
            v-for="entry in stackEntries"
            :key="entry.address"
            :data-address="entry.address"
            :data-testid="`stack-entry-${entry.address}`"
            class="cursor-pointer border border-l-3 border-gray-200 border-l-transparent rounded-md bg-white font-mono shadow-sm transition-all duration-200 dark:border-gray-700 dark:bg-gray-900"
            :class="{
              'outline outline-2 outline-blue-400 bg-blue-500/20!': selectedAddress === entry.address,
              'border-l-blue-500!': isStatementLhs(entry.address),
              'border-l-green-500!': isStatementRhs(entry.address),
              'border-l-yellow-400!': changedAddresses.has(entry.address) && !isStatementLhs(entry.address) && !isStatementRhs(entry.address),
              'border-l-blue-400!': isHoverTarget(entry.address) && !hasCodeHighlight(entry.address) && selectedAddress !== entry.address,
              'ring-2 ring-blue-400/40': isHoverBoosted(entry.address),
              'opacity-40': !entry.inScope,
            }"
            @click="emit('selectCell', entry.address)"
            @pointerenter="entry.inScope && emit('hoverVariable', entry.name)"
            @pointerleave="emit('hoverVariable', null)"
          >
            <!-- Address bar: address left, var name + type right -->
            <div class="flex items-center justify-between border-b border-gray-200 rounded-t-md bg-gray-100 px-2 py-0.5 text-[10px] dark:border-gray-700 dark:bg-gray-800/80">
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
                <template v-for="[name, field] in entry.fields" :key="name">
                  <!-- Complex value (struct/array): field name then value below -->
                  <div
                    v-if="typeof field.value === 'object' && (field.value.type === 'struct' || field.value.type === 'array')"
                    :data-field-address="field.address"
                    class="py-0.5 transition-colors"
                  >
                    <span class="text-gray-500">{{ name }}:</span>
                    <div class="pl-2">
                      <DSValue
                        :address="field.address"
                        :type="field.type"
                        :highlighted-field-address="highlightedFieldAddress"
                        :statement-lhs-addresses="statementLhsAddresses"
                        :statement-rhs-addresses="statementRhsAddresses"
                        @navigate="handleClickPointer"
                        @hover-node="handleHoverPointerStack"
                      />
                    </div>
                  </div>
                  <!-- Simple value: inline row -->
                  <div
                    v-else
                    :data-field-address="field.address"
                    class="flex items-baseline justify-between gap-4 py-0.5 transition-colors"
                    :class="{
                      'bg-blue-500/15 rounded px-1 -mx-1': isFieldHighlighted(field.address),
                      'bg-blue-500/10 rounded px-1 -mx-1': isStatementLhs(field.address),
                      'bg-green-500/10 rounded px-1 -mx-1': isStatementRhs(field.address),
                    }"
                  >
                    <span class="shrink-0 text-gray-500">{{ name }}</span>
                    <AddressLink
                      v-if="isPointerValue(field.value)"
                      :address="field.value.address"
                      @navigate="handleClickPointer"
                      @hover="handleHoverPointerStack"
                    />
                    <span v-else class="text-orange-600 font-semibold dark:text-orange-300">{{ field.value }}</span>
                  </div>
                </template>
              </template>

              <!-- Array / Struct: recursive rendering -->
              <template v-else-if="typeof entry.cell.value === 'object' && (entry.cell.value.type === 'array' || entry.cell.value.type === 'struct')">
                <DSValue
                  :address="entry.address"
                  :type="entry.type"
                  :highlighted-field-address="highlightedFieldAddress"
                  :statement-lhs-addresses="statementLhsAddresses"
                  :statement-rhs-addresses="statementRhsAddresses"
                  @navigate="handleClickPointer"
                  @hover-node="handleHoverPointerStack"
                />
              </template>

              <!-- Pointer -->
              <template v-else-if="isPointerValue(entry.cell.value)">
                <AddressLink
                  :address="entry.cell.value.address"
                  @navigate="handleClickPointer"
                  @hover="handleHoverPointerStack"
                />
              </template>

              <!-- Primitive -->
              <template v-else>
                <span class="text-orange-600 font-semibold dark:text-orange-300">{{ entry.cell.value }}</span>
              </template>
            </div>
          </div>
        </TransitionGroup>

        <div v-if="stackEntries.length === 0" class="flex flex-1 items-center justify-center text-xs text-gray-500 italic">
          No stack variables
        </div>
      </div>
    </div>

    <!-- Heap column -->
    <div data-testid="heap-column" class="min-h-0 flex flex-1 flex-col border border-gray-200 rounded-lg dark:border-gray-800">
      <!-- Sticky header -->
      <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 rounded-t-lg bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
        <span class="text-[10px] text-gray-500 font-semibold tracking-wide uppercase dark:text-gray-400">Heap</span>
        <span class="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/60 dark:text-green-300">
          {{ heapAllocCount }} allocations
        </span>
      </div>
      <!-- Scrollable body -->
      <div class="scrollbar-hidden min-h-0 flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
        <TransitionGroup name="heap-cell">
          <MemoryCell
            v-for="entry in heapEntries"
            :key="entry.cell.address"
            :data-address="entry.cell.address"
            :data-testid="`heap-cell-${entry.cell.address}`"
            :cell="entry.cell"
            :field-values="entry.fields"
            :changed="changedAddresses.has(entry.cell.address)"
            :highlighted-field-address="highlightedFieldAddress"
            :class="{
              'outline outline-2 outline-blue-400': selectedAddress === entry.cell.address,
              'border-l-blue-500!': isStatementLhs(entry.cell.address),
              'border-l-green-500!': isStatementRhs(entry.cell.address),
              'border-l-blue-400!': isHoverTarget(entry.cell.address) && !hasCodeHighlight(entry.cell.address) && selectedAddress !== entry.cell.address,
              'ring-2 ring-blue-400/40': isHoverBoosted(entry.cell.address),
            }"
            @click-pointer="handleClickPointer"
            @hover-pointer="handleHoverPointerHeap"
            @click-cell="emit('selectCell', $event)"
          />
        </TransitionGroup>
        <div v-if="heapEntries.length === 0" class="flex flex-1 items-center justify-center text-xs text-gray-500 italic">
          No heap allocations
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hidden {
  scrollbar-width: none;
}
.scrollbar-hidden::-webkit-scrollbar {
  display: none;
}

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

.heap-cell-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.heap-cell-enter-active {
  transition: all 0.25s ease-out;
}
.heap-cell-leave-active {
  transition: all 0.35s ease-in;
  position: absolute;
  width: 100%;
}
.heap-cell-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.95);
}
.heap-cell-move {
  transition: transform 0.3s ease;
}
</style>
