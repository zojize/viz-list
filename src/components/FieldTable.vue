<script setup lang="ts">
import type { CppType } from '~/composables/interpreter/types'
import { computed } from 'vue'
import AddressLink from '~/components/AddressLink.vue'
import DSValue from '~/components/DSValue.vue'
import { formatAddr, formatType } from '~/composables/interpreter/helpers'
import { useInterpreterContext } from '~/composables/useInterpreterContext'
import { useMemoryDecoder } from '~/composables/useMemoryDecoder'

const props = defineProps<{
  /** Base address of the allocation to display */
  address: number
  /** CppType for this allocation (struct, array, or scalar) */
  type: CppType
  changedAddresses: ReadonlySet<number>
  /** Optional byte-level detail when a specific byte was clicked in the byte map */
  byteDetail?: {
    address: number
    byte: number
    path: (string | number)[]
    leafType: CppType
    isPadding: boolean
  } | null
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hoverField: [address: number | null]
  hoverPointer: [address: number | null]
}>()

const context = useInterpreterContext()
const { decode } = useMemoryDecoder(() => context.memory)

const alloc = computed(() => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  return context.memory.findAllocation(props.address)
})

const structName = computed(() => {
  if (typeof props.type === 'object' && props.type.type === 'struct')
    return props.type.name
  return null
})

const isArray = computed(() => {
  return typeof props.type === 'object' && props.type.type === 'array'
})

const region = computed(() => alloc.value?.region ?? 'stack')

interface FieldRow {
  name: string
  type: CppType
  displayValue: string
  address: number
  isPointer: boolean
  pointerAddress: number
  changed: boolean
}

/** Convert a LayoutNode to a CppType for rendering */
function fieldNodeToType(node: import('~/composables/interpreter/layout').LayoutNode): CppType {
  if (node.kind === 'scalar')
    return node.type
  if (node.kind === 'array')
    return { type: 'array', of: fieldNodeToType(node.element), size: node.length }
  return { type: 'struct', name: node.structName }
}

// ---- Referenced-by: find all pointer allocations pointing to this allocation's address ----

interface RefEntry {
  address: number
  label: string
}

const referencedBy = computed((): RefEntry[] => {
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  const targetAddr = props.address
  const refs: RefEntry[] = []
  for (const a of context.memory.space.allocations.values()) {
    if (a.dead)
      continue
    if (a.layout.kind !== 'scalar')
      continue
    const t = a.layout.type
    if (typeof t !== 'object' || t.type !== 'pointer')
      continue
    try {
      const ptr = context.memory.readScalar(a.base, t) as number
      if (ptr === targetAddr)
        refs.push({ address: a.base, label: formatAddr(a.base) })
    }
    catch {
      // ignore read errors
    }
  }
  return refs
})

const fields = computed((): FieldRow[] => {
  if (!structName.value)
    return []
  // eslint-disable-next-line ts/no-unused-expressions
  context.memoryVersion // reactive dependency
  const layout = context.structLayouts[structName.value]
  if (!layout || layout.kind !== 'struct')
    return []
  const rows: FieldRow[] = []

  /** Recursively flatten array elements with subscript prefix (handles n-d arrays) */
  function flattenArray(prefix: string, elemType: CppType, elemAddr: number, length: number, stride: number) {
    for (let i = 0; i < length; i++) {
      const addr = elemAddr + i * stride
      const subscript = `${prefix}[${i}]`
      // Nested array: recurse
      if (typeof elemType === 'object' && elemType.type === 'array') {
        const innerStride = stride / elemType.size || 1
        flattenArray(subscript, elemType.of, addr, elemType.size, innerStride)
        continue
      }
      const isPtr = typeof elemType === 'object' && elemType.type === 'pointer'
      let ptrAddr = 0
      if (isPtr) {
        try {
          ptrAddr = context.memory.readScalar(addr, elemType) as number
        }
        catch { /* ignore */ }
      }
      rows.push({
        name: subscript,
        type: elemType,
        displayValue: decode(addr, elemType),
        address: addr,
        isPointer: isPtr,
        pointerAddress: ptrAddr,
        changed: props.changedAddresses.has(addr),
      })
    }
  }

  for (const field of layout.fields) {
    const addr = props.address + field.offset
    const ftype = fieldNodeToType(field.node)

    if (field.node.kind === 'array') {
      const elemType = fieldNodeToType(field.node.element)
      flattenArray(field.name, elemType, addr, field.node.length, field.node.stride)
      continue
    }

    const isPtr = field.node.kind === 'scalar'
      && typeof field.node.type === 'object'
      && field.node.type.type === 'pointer'
    let ptrAddr = 0
    if (isPtr && field.node.kind === 'scalar' && typeof field.node.type === 'object') {
      try {
        ptrAddr = context.memory.readScalar(addr, field.node.type as { type: 'pointer', to: CppType }) as number
      }
      catch { /* ignore */ }
    }

    rows.push({
      name: field.name,
      type: ftype,
      displayValue: decode(addr, ftype),
      address: addr,
      isPointer: isPtr,
      pointerAddress: ptrAddr,
      changed: props.changedAddresses.has(addr),
    })
  }
  return rows
})
</script>

<template>
  <div data-testid="field-table" class="flex flex-col gap-2">
    <!-- Byte-level detail banner (shown whenever a byte was clicked in the byte map) -->
    <div
      v-if="byteDetail"
      class="rounded bg-gray-100 p-2 text-xs font-mono dark:bg-gray-800"
    >
      <div class="mb-1 text-[10px] text-gray-500 tracking-wide uppercase dark:text-gray-400">
        Byte detail
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt class="text-gray-500 dark:text-gray-400">
          address
        </dt>
        <dd class="text-orange-600 font-semibold dark:text-orange-300">
          0x{{ byteDetail.address.toString(16).padStart(4, '0') }}
        </dd>
        <dt class="text-gray-500 dark:text-gray-400">
          offset
        </dt>
        <dd class="text-gray-700 dark:text-gray-300">
          +{{ byteDetail.address - address }}
        </dd>
        <template v-if="byteDetail.path.length">
          <dt class="text-gray-500 dark:text-gray-400">
            path
          </dt>
          <dd class="text-gray-700 dark:text-gray-300">
            {{ byteDetail.path.join('.') }}
          </dd>
        </template>
        <dt class="text-gray-500 dark:text-gray-400">
          type
        </dt>
        <dd class="text-gray-700 dark:text-gray-300">
          <span v-if="byteDetail.isPadding" class="text-gray-400 italic dark:text-gray-500">padding byte</span>
          <span v-else>{{ formatType(byteDetail.leafType) }}</span>
        </dd>
        <dt class="text-gray-500 dark:text-gray-400">
          raw byte
        </dt>
        <dd>
          <span class="text-orange-600 font-semibold dark:text-orange-300">
            0x{{ byteDetail.byte.toString(16).padStart(2, '0') }}
          </span>
          <span class="ml-1 text-gray-400 dark:text-gray-500">({{ byteDetail.byte }})</span>
        </dd>
      </dl>
    </div>

    <div class="flex items-center gap-2">
      <span v-if="structName" class="text-accent-cyan font-bold">{{ structName }}</span>
      <span class="text-xs text-gray-500 font-mono">at {{ formatAddr(address) }}</span>
      <span
        class="rounded px-1.5 py-0.5 text-[10px]"
        :class="{
          'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300': region === 'heap',
          'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300': region === 'stack',
          'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300': region === 'global',
        }"
      >{{ region }}</span>
    </div>
    <!-- Array / general: recursive rendering -->
    <div v-if="isArray" class="rounded bg-gray-100 p-2 dark:bg-gray-800">
      <DSValue
        :address="address"
        :type="type"
        @navigate="emit('navigate', $event)"
      />
    </div>

    <!-- Struct fields -->
    <div v-else-if="fields.length" class="rounded bg-gray-100 dark:bg-gray-800">
      <template v-for="field in fields" :key="field.name">
        <!-- Complex value (struct/array): own row with value below -->
        <div
          v-if="typeof field.type === 'object' && (field.type.type === 'struct' || field.type.type === 'array')"
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
              :address="field.address"
              :type="field.type"
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
            <span v-else class="text-orange-600 font-bold dark:text-orange-300">{{ field.displayValue }}</span>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="rounded bg-gray-100 px-3 py-2 text-xs font-mono dark:bg-gray-800">
      <span class="text-[10px] text-gray-600">{{ formatType(type) }}</span>
      <span class="ml-2 text-orange-600 font-bold dark:text-orange-300">{{ decode(address, type) }}</span>
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
