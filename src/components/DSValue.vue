<script setup lang="ts">
import type { CppType } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import { formatType } from '~/composables/interpreter/helpers'
import { useInterpreterContext } from '~/composables/useInterpreterContext'

const props = defineProps<{
  /** Base address of the memory location to render */
  address: number
  /** CppType for this location (scalar, pointer, struct, array) */
  type: CppType
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

const isPrimitive = computed(() => typeof props.type === 'string')
const isPointer = computed(() => typeof props.type === 'object' && props.type.type === 'pointer')
const isArray = computed(() => typeof props.type === 'object' && props.type.type === 'array')
const isStruct = computed(() => typeof props.type === 'object' && props.type.type === 'struct')

const structName = computed(() => {
  if (typeof props.type === 'object' && props.type.type === 'struct')
    return props.type.name
  return null
})

/** Formatted primitive value (re-reads from reactive memory each step) */
const primitiveDisplay = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  if (!isPrimitive.value)
    return ''
  try {
    const v = context.memory.readScalar(props.address, props.type as Parameters<typeof context.memory.readScalar>[1])
    return String(v)
  }
  catch {
    return '?'
  }
})

/** Pointer target address */
const pointerAddress = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  if (!isPointer.value || typeof props.type !== 'object' || props.type.type !== 'pointer')
    return 0
  try {
    return context.memory.readScalar(props.address, props.type) as number
  }
  catch {
    return 0
  }
})

interface FieldEntry {
  name: string
  address: number
  type: CppType
}

const structFields = computed((): FieldEntry[] => {
  if (!structName.value)
    return []
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency — re-evaluate each step
  const layout = context.structLayouts[structName.value]
  if (!layout || layout.kind !== 'struct')
    return []
  const entries: FieldEntry[] = []

  /** Recursively flatten array elements with subscript prefix (handles n-d arrays) */
  function flattenArray(prefix: string, elemType: CppType, elemAddr: number, arrayLength: number, stride: number) {
    for (let i = 0; i < arrayLength; i++) {
      const addr = elemAddr + i * stride
      const subscript = `${prefix}[${i}]`
      // Nested array: recurse
      if (typeof elemType === 'object' && elemType.type === 'array') {
        const innerLayout = layout.kind === 'struct' ? null : null // placeholder — use field node
        void innerLayout
        // For nested arrays, recurse using the element type
        const innerStride = Math.floor(stride / elemType.size) || 1
        flattenArray(subscript, elemType.of, addr, elemType.size, innerStride)
      }
      else {
        entries.push({ name: subscript, address: addr, type: elemType })
      }
    }
  }

  for (const field of layout.fields) {
    const fieldAddr = props.address + field.offset
    if (field.node.kind === 'array') {
      const elemType = fieldNodeToType(field.node.element)
      flattenArray(field.name, elemType, fieldAddr, field.node.length, field.node.stride)
      continue
    }
    entries.push({ name: field.name, address: fieldAddr, type: fieldNodeToType(field.node) })
  }
  return entries
})

interface ArrayEntry {
  index: number
  address: number
  type: CppType
  prefix: string
}

const arrayElements = computed((): ArrayEntry[] => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency — re-evaluate each step
  if (typeof props.type !== 'object' || props.type.type !== 'array')
    return []
  const alloc = context.memory.findAllocation(props.address)
  if (!alloc || alloc.layout.kind !== 'array')
    return []
  const arrLayout = alloc.layout
  const prefix = props.indexPrefix ?? ''
  return Array.from({ length: arrLayout.length }, (_, i) => ({
    index: i,
    address: props.address + i * arrLayout.stride,
    type: fieldNodeToType(arrLayout.element),
    prefix: `${prefix}[${i}]`,
  }))
})

/** Convert a LayoutNode to a CppType for child rendering */
function fieldNodeToType(node: import('~/composables/interpreter/layout').LayoutNode): CppType {
  if (node.kind === 'scalar')
    return node.type
  if (node.kind === 'array')
    return { type: 'array', of: fieldNodeToType(node.element), size: node.length }
  return { type: 'struct', name: node.structName }
}
</script>

<template>
  <!-- Primitive value -->
  <span v-if="isPrimitive" class="text-orange-600 font-semibold dark:text-orange-300">
    {{ primitiveDisplay }}
  </span>

  <!-- Pointer value -->
  <AddressLink
    v-else-if="isPointer"
    :address="pointerAddress"
    @navigate="emit('navigate', $event)"
    @hover="emit('hoverNode', $event)"
  />

  <!-- Array: render each element recursively -->
  <div v-else-if="isArray" class="flex flex-col">
    <template v-for="elem in arrayElements" :key="elem.index">
      <!-- If element is itself an array, recurse without extra wrapper -->
      <template v-if="typeof elem.type === 'object' && elem.type.type === 'array'">
        <DSValue
          :address="elem.address"
          :type="elem.type"
          :index-prefix="elem.prefix"
          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
      </template>
      <!-- Leaf element -->
      <div
        v-else
        class="flex items-baseline justify-between gap-2 rounded px-1 py-0.5"
        :class="[
          highlightedFieldAddress === elem.address ? 'bg-blue-500/15' : '',
          statementLhsAddresses?.has(elem.address) ? 'bg-blue-500/10' : '',
          statementRhsAddresses?.has(elem.address) && !statementLhsAddresses?.has(elem.address) ? 'bg-green-500/10' : '',
        ]"
      >
        <span class="text-gray-500 font-mono">{{ elem.prefix }}</span>
        <DSValue
          :address="elem.address"
          :type="elem.type"
          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
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
      <template v-if="typeof field.type === 'object' && (field.type.type === 'struct' || field.type.type === 'array')">
        <div
          class="py-0.5 pl-3"
          :class="[
            highlightedFieldAddress === field.address ? 'bg-blue-500/15 rounded' : '',
            statementLhsAddresses?.has(field.address) ? 'bg-blue-500/10 rounded' : '',
            statementRhsAddresses?.has(field.address) && !statementLhsAddresses?.has(field.address) ? 'bg-green-500/10 rounded' : '',
          ]"
          :data-field-addr="field.address"
        >
          <span class="text-gray-500 font-mono">{{ field.name }}:</span>
          <div class="pl-2">
            <DSValue
              :address="field.address"
              :type="field.type"
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
          highlightedFieldAddress === field.address ? 'bg-blue-500/15' : '',
          statementLhsAddresses?.has(field.address) ? 'bg-blue-500/10' : '',
          statementRhsAddresses?.has(field.address) && !statementLhsAddresses?.has(field.address) ? 'bg-green-500/10' : '',
        ]"
        :data-field-addr="field.address"
      >
        <span class="shrink-0 text-gray-500 font-mono">{{ field.name }}:</span>
        <DSValue
          :address="field.address"
          :type="field.type"
          :highlighted-field-address="highlightedFieldAddress"
          :statement-lhs-addresses="statementLhsAddresses"
          :statement-rhs-addresses="statementRhsAddresses"
          @navigate="emit('navigate', $event)"
          @hover-node="emit('hoverNode', $event)"
        />
      </div>
    </template>
    <div class="text-accent-cyan font-semibold">
      }
    </div>
  </div>

  <!-- Fallback -->
  <span v-else class="text-gray-500">
    {{ formatType(type) }}
  </span>
</template>
