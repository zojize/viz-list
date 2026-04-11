<script setup lang="ts">
import type { CppType, MemoryCell } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import { formatType } from '~/composables/interpreter/helpers'
import { useInterpreterContext } from '~/composables/useInterpreterContext'

const props = defineProps<{
  cell: MemoryCell
  /** Optional prefix for array indices, e.g. "[0]" for nested display */
  indexPrefix?: string
  /** Field address to highlight (from referenced-by hover or arrow hover) */
  highlightedFieldAddress?: number | null
  /** Statement LHS/RHS addresses for per-field code highlighting */
  statementLhsAddresses?: ReadonlySet<number>
  statementRhsAddresses?: ReadonlySet<number>
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hoverNode: [address: number | null]
}>()

const context = useInterpreterContext()

// ---- Computed data ----

/** Fresh cell value — re-reads from reactive memory each step */
const freshValue = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memory.version // reactive dependency
  return context.memory.cells.get(props.cell.address)?.value ?? props.cell.value
})

const isPrimitive = computed(() => typeof props.cell.type === 'string')
const isPointer = computed(() => {
  const v = freshValue.value
  return typeof v === 'object' && v.type === 'pointer'
})
const isArray = computed(() => {
  const v = freshValue.value
  return typeof v === 'object' && v.type === 'array'
})
const isStruct = computed(() => {
  const v = freshValue.value
  return typeof v === 'object' && v.type === 'struct'
})

const structName = computed(() => {
  if (typeof props.cell.type === 'object' && props.cell.type.type === 'struct')
    return props.cell.type.name
  return null
})

interface FieldEntry {
  name: string
  cell: MemoryCell | undefined
  type: CppType
}

const structFields = computed((): FieldEntry[] => {
  if (!structName.value)
    return []
  // eslint-disable-next-line ts/no-unused-expressions
  context.memory.version // reactive dependency — re-evaluate each step
  const freshCell = context.memory.cells.get(props.cell.address)
  const v = freshCell?.value
  if (!v || typeof v !== 'object' || v.type !== 'struct')
    return []
  const structDef = context.structs[v.name]
  if (!structDef)
    return []
  const entries: FieldEntry[] = []

  /** Recursively flatten array elements with subscript prefix (handles n-d arrays) */
  function flattenArray(prefix: string, elemType: CppType, cell: MemoryCell | undefined) {
    if (!cell)
      return
    const arrVal = cell.value
    if (typeof arrVal !== 'object' || arrVal.type !== 'array')
      return
    for (let i = 0; i < arrVal.length; i++) {
      const elemCell = context.memory.cells.get(arrVal.base + 1 + i)
      const subscript = `${prefix}[${i}]`
      // Nested array: recurse
      if (typeof elemType === 'object' && elemType.type === 'array' && elemCell) {
        flattenArray(subscript, elemType.of, elemCell)
      }
      else {
        entries.push({ name: subscript, cell: elemCell, type: elemType })
      }
    }
  }

  for (const [name, fieldType] of Object.entries(structDef)) {
    const fieldIdx = Object.keys(structDef).indexOf(name)
    const fieldCell = context.memory.cells.get(v.base + 1 + fieldIdx)
    if (typeof fieldType === 'object' && fieldType.type === 'array' && fieldCell) {
      flattenArray(name, fieldType.of, fieldCell)
      continue
    }
    entries.push({ name, cell: fieldCell, type: fieldType })
  }
  return entries
})

interface ArrayEntry {
  index: number
  cell: MemoryCell | undefined
  prefix: string
}

const arrayElements = computed((): ArrayEntry[] => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memory.version // reactive dependency — re-evaluate each step
  const freshCell = context.memory.cells.get(props.cell.address)
  const v = freshCell?.value
  if (!v || typeof v !== 'object' || v.type !== 'array')
    return []
  const prefix = props.indexPrefix ?? ''
  return Array.from({ length: v.length }, (_, i) => ({
    index: i,
    cell: context.memory.cells.get(v.base + 1 + i),
    prefix: `${prefix}[${i}]`,
  }))
})
</script>

<template>
  <!-- Primitive value -->
  <span v-if="isPrimitive" class="text-orange-600 font-semibold dark:text-orange-300">
    {{ freshValue }}
  </span>

  <!-- Pointer value -->
  <AddressLink
    v-else-if="isPointer && typeof freshValue === 'object' && freshValue.type === 'pointer'"
    :address="freshValue.address"
    @navigate="emit('navigate', $event)"
    @hover="emit('hoverNode', $event)"
  />

  <!-- Array: render each element recursively -->
  <div v-else-if="isArray" class="flex flex-col">
    <template v-for="elem in arrayElements" :key="elem.index">
      <!-- If element is itself an array, recurse without extra wrapper -->
      <template v-if="elem.cell && typeof elem.cell.value === 'object' && elem.cell.value.type === 'array'">
        <DSValue
          :cell="elem.cell"

          :index-prefix="elem.prefix"
          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
      </template>
      <!-- Leaf element -->
      <div v-else class="flex items-baseline justify-between gap-2 rounded px-1 py-0.5">
        <span class="text-gray-500 font-mono">{{ elem.prefix }}</span>
        <DSValue
          v-if="elem.cell"
          :cell="elem.cell"

          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
        <span v-else class="text-gray-500">?</span>
      </div>
    </template>
  </div>

  <!-- Struct: render fields -->
  <div v-else-if="isStruct && structFields.length > 0" class="flex flex-col">
    <div class="text-accent-cyan font-semibold">
      {{ structName }} {
    </div>
    <template v-for="field in structFields" :key="field.name">
      <!-- Complex value (struct/array): field name then value below, indented -->
      <template v-if="field.cell && typeof field.cell.value === 'object' && (field.cell.value.type === 'struct' || field.cell.value.type === 'array')">
        <div
          class="py-0.5 pl-3"
          :class="[
            highlightedFieldAddress === field.cell?.address ? 'bg-blue-500/15 rounded' : '',
            statementLhsAddresses?.has(field.cell?.address ?? -1) ? 'bg-blue-500/10 rounded' : '',
            statementRhsAddresses?.has(field.cell?.address ?? -1) && !statementLhsAddresses?.has(field.cell?.address ?? -1) ? 'bg-green-500/10 rounded' : '',
          ]"
          :data-field-addr="field.cell?.address"
        >
          <span class="text-gray-500 font-mono">{{ field.name }}:</span>
          <div class="pl-2">
            <DSValue
              :cell="field.cell"
              :highlighted-field-address="highlightedFieldAddress"
              @navigate="emit('navigate', $event)"
              @hover-node="emit('hoverNode', $event)"
            />
          </div>
        </div>
      </template>
      <!-- Simple value: inline row -->
      <div
        v-else
        class="flex items-baseline justify-between gap-4 rounded px-1 py-0.5 pl-3"
        :class="[
          highlightedFieldAddress === field.cell?.address ? 'bg-blue-500/15' : '',
          statementLhsAddresses?.has(field.cell?.address ?? -1) ? 'bg-blue-500/10' : '',
          statementRhsAddresses?.has(field.cell?.address ?? -1) && !statementLhsAddresses?.has(field.cell?.address ?? -1) ? 'bg-green-500/10' : '',
        ]"
        :data-field-addr="field.cell?.address"
      >
        <span class="shrink-0 text-gray-500 font-mono">{{ field.name }}:</span>
        <DSValue
          v-if="field.cell"
          :cell="field.cell"
          :highlighted-field-address="highlightedFieldAddress"
          :statement-lhs-addresses="statementLhsAddresses"
          :statement-rhs-addresses="statementRhsAddresses"
          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
        <span v-else class="text-gray-500">?</span>
      </div>
    </template>
    <div class="text-accent-cyan font-semibold">
      }
    </div>
  </div>

  <!-- Fallback -->
  <span v-else class="text-gray-500">
    {{ formatType(cell.type) }}
  </span>
</template>
