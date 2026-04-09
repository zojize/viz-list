<script setup lang="ts">
import type { CppType, MemoryCell } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import { useInterpreterContext } from '~/composables/useInterpreterContext'

const props = defineProps<{
  cell: MemoryCell
  /** Optional prefix for array indices, e.g. "[0]" for nested display */
  indexPrefix?: string
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hoverNode: [address: number | null]
}>()

const context = useInterpreterContext()

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
  return Object.keys(structDef).map((name, i) => ({
    name,
    cell: context.memory.cells.get(v.base + 1 + i),
    type: structDef[name],
  }))
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
      <div v-else class="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 odd:bg-gray-100 dark:odd:bg-gray-800/50">
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
    <div class="text-purple-600 font-semibold dark:text-purple-400">
      {{ structName }} {
    </div>
    <template v-for="field in structFields" :key="field.name">
      <!-- Complex value (struct/array): field name then value below, indented -->
      <template v-if="field.cell && typeof field.cell.value === 'object' && (field.cell.value.type === 'struct' || field.cell.value.type === 'array')">
        <div class="py-0.5 pl-3">
          <span class="text-gray-500 font-mono">{{ field.name }}:</span>
          <div class="pl-2">
            <DSValue
              :cell="field.cell"

              @navigate="emit('navigate', $event)"
              @hover-node="emit('hoverNode', $event)"
            />
          </div>
        </div>
      </template>
      <!-- Simple value: inline row -->
      <div v-else class="flex items-baseline justify-between gap-4 rounded px-1 py-0.5 pl-3 odd:bg-gray-100 dark:odd:bg-gray-800/50">
        <span class="shrink-0 text-gray-500 font-mono">{{ field.name }}:</span>
        <DSValue
          v-if="field.cell"
          :cell="field.cell"

          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
        <span v-else class="text-gray-500">?</span>
      </div>
    </template>
    <div class="text-purple-600 font-semibold dark:text-purple-400">
      }
    </div>
  </div>

  <!-- Fallback -->
  <span v-else class="text-gray-500">
    {{ formatType(cell.type) }}
  </span>
</template>
