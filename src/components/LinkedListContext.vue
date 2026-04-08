<script setup lang="ts">
import type { CppValue, InterpreterContext } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  address: number
  context: Readonly<InterpreterContext>
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
}>()

function readField(base: number, fieldName: string): CppValue | undefined {
  const c = props.context.memory.cells.get(base)
  if (!c || typeof c.type !== 'object' || c.type.type !== 'struct')
    return undefined
  const def = props.context.structs[c.type.name]
  if (!def)
    return undefined
  const idx = Object.keys(def).indexOf(fieldName)
  if (idx === -1)
    return undefined
  return props.context.memory.cells.get(base + 1 + idx)?.value
}

function getFieldAddress(base: number, fieldName: string): number | undefined {
  const c = props.context.memory.cells.get(base)
  if (!c || typeof c.type !== 'object' || c.type.type !== 'struct')
    return undefined
  const def = props.context.structs[c.type.name]
  if (!def)
    return undefined
  const idx = Object.keys(def).indexOf(fieldName)
  if (idx === -1)
    return undefined
  return base + 1 + idx
}

function getData(base: number): string {
  const data = readField(base, 'data')
  return data !== undefined ? String(data) : '?'
}

function getPointerAddr(value: CppValue | undefined): number | null {
  if (!value || typeof value !== 'object' || value.type !== 'pointer')
    return null
  return value.address === NULL_ADDRESS ? null : value.address
}

function formatAddr(addr: number | null): string {
  if (addr === null)
    return 'NULL'
  return `0x${addr.toString(16).padStart(2, '0')}`
}

const hasPrev = computed(() => {
  const cell = props.context.memory.cells.get(props.address)
  if (!cell || typeof cell.type !== 'object' || cell.type.type !== 'struct')
    return false
  const structDef = props.context.structs[cell.type.name]
  return !!structDef && 'prev' in structDef
})

interface ChainNode {
  address: number | null
  label: string
  isCurrent: boolean
  prevAddr: number | null
  nextFieldAddress: number | undefined
  prevFieldAddress: number | undefined
}

const chain = computed((): ChainNode[] => {
  const cell = props.context.memory.cells.get(props.address)
  if (!cell || typeof cell.type !== 'object' || cell.type.type !== 'struct')
    return []

  const structDef = props.context.structs[cell.type.name]
  if (!structDef || !('next' in structDef))
    return []

  // Find head by walking backwards
  let headAddr: number | null = null

  if (hasPrev.value) {
    let cur: number | null = props.address
    const seen = new Set<number>()
    while (cur !== null) {
      if (seen.has(cur))
        break
      seen.add(cur)
      const prev = getPointerAddr(readField(cur, 'prev'))
      if (prev === null) {
        headAddr = cur
        break
      }
      cur = prev
    }
  }
  else {
    for (const [, c] of props.context.memory.cells) {
      if (c.dead || typeof c.type !== 'object' || c.type.type !== 'struct' || c.type.name !== 'LinkedList')
        continue
      const listVal = c.value
      if (typeof listVal !== 'object' || listVal.type !== 'struct')
        continue
      const listBase = listVal.base
      const listDef = props.context.structs.LinkedList
      if (!listDef)
        continue
      const headIdx = Object.keys(listDef).indexOf('head')
      if (headIdx === -1)
        continue
      const headCell = props.context.memory.cells.get(listBase + 1 + headIdx)
      if (!headCell || typeof headCell.value !== 'object' || headCell.value.type !== 'pointer')
        continue
      let cur = headCell.value.address === NULL_ADDRESS ? null : headCell.value.address
      const seen = new Set<number>()
      while (cur !== null) {
        if (seen.has(cur))
          break
        if (cur === props.address) {
          headAddr = headCell.value.address
          break
        }
        seen.add(cur)
        cur = getPointerAddr(readField(cur, 'next'))
      }
      if (headAddr !== null)
        break
    }
    if (headAddr === null)
      headAddr = props.address
  }

  // Build chain forward from head via next
  const nodes: ChainNode[] = []
  let cur: number | null = headAddr
  const seen = new Set<number>()

  while (cur !== null) {
    if (seen.has(cur))
      break
    seen.add(cur)
    const prevVal = hasPrev.value ? readField(cur, 'prev') : undefined
    nodes.push({
      address: cur,
      label: getData(cur),
      isCurrent: cur === props.address,
      prevAddr: hasPrev.value ? getPointerAddr(prevVal) : null,
      nextFieldAddress: getFieldAddress(cur, 'next'),
      prevFieldAddress: hasPrev.value ? getFieldAddress(cur, 'prev') : undefined,
    })
    cur = getPointerAddr(readField(cur, 'next'))
  }

  // If the selected node wasn't reached via next chain (e.g. mid-insertBack
  // where prev is set but next hasn't been linked yet), append it
  if (!seen.has(props.address)) {
    const prevVal = hasPrev.value ? readField(props.address, 'prev') : undefined
    nodes.push({
      address: props.address,
      label: getData(props.address),
      isCurrent: true,
      prevAddr: hasPrev.value ? getPointerAddr(prevVal) : null,
      nextFieldAddress: getFieldAddress(props.address, 'next'),
      prevFieldAddress: hasPrev.value ? getFieldAddress(props.address, 'prev') : undefined,
    })
  }

  nodes.push({ address: null, label: 'NULL', isCurrent: false, prevAddr: null, nextFieldAddress: undefined, prevFieldAddress: undefined })

  return nodes
})

function handleArrowEnter(fieldAddress: number | undefined) {
  if (fieldAddress)
    emit('hoverField', fieldAddress)
}

function handleArrowLeave() {
  emit('hoverField', null)
}
</script>

<template>
  <div data-testid="linked-list-context" class="flex items-center gap-0 overflow-x-auto px-2 py-2">
    <!-- First node's prev pointer (show actual value) -->
    <template v-if="hasPrev && chain.length > 0 && chain[0].address !== null">
      <span
        class="shrink-0 cursor-pointer px-1 text-[10px] font-mono hover:underline"
        :class="chain[0].prevAddr === null ? 'text-red-400 opacity-60' : 'text-orange-400'"
        @pointerenter="handleArrowEnter(chain[0].prevFieldAddress)"
        @pointerleave="handleArrowLeave()"
        @click="chain[0].prevAddr && emit('navigate', chain[0].prevAddr)"
      >{{ formatAddr(chain[0].prevAddr) }}</span>
      <span
        class="shrink-0 cursor-pointer px-0.5 text-xs text-orange-400 hover:text-orange-300"
        @pointerenter="handleArrowEnter(chain[0].prevFieldAddress)"
        @pointerleave="handleArrowLeave()"
      >&#8592;</span>
    </template>

    <template v-for="(node, i) in chain" :key="node.address ?? `null-${i}`">
      <!-- Arrows between nodes -->
      <div v-if="i > 0 && node.address !== null" class="flex shrink-0 flex-col items-center">
        <span
          class="shrink-0 cursor-pointer px-1 py-0.5 text-xs text-green-400 hover:text-green-300"
          @pointerenter="handleArrowEnter(chain[i - 1].nextFieldAddress)"
          @pointerleave="handleArrowLeave()"
        >&#8594;</span>
        <span
          v-if="hasPrev"
          class="shrink-0 cursor-pointer px-1 py-0.5 text-xs text-orange-400 hover:text-orange-300"
          @pointerenter="handleArrowEnter(node.prevFieldAddress)"
          @pointerleave="handleArrowLeave()"
        >&#8592;</span>
      </div>
      <!-- Arrow to terminal NULL -->
      <span
        v-if="i > 0 && node.address === null"
        class="shrink-0 cursor-pointer px-1 text-xs text-green-400 hover:text-green-300"
        @pointerenter="handleArrowEnter(chain[i - 1].nextFieldAddress)"
        @pointerleave="handleArrowLeave()"
      >&#8594;</span>

      <!-- Node box -->
      <div
        class="shrink-0 cursor-pointer rounded px-2 py-1 text-center text-xs font-mono"
        :class="{
          'bg-blue-500/20 outline-2 outline-blue-400 outline': node.isCurrent,
          'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600': !node.isCurrent && node.address !== null,
          'text-red-400 opacity-50': node.address === null,
          'text-orange-600 dark:text-orange-300': node.address !== null,
        }"
        @click="node.address && emit('navigate', node.address)"
        @pointerenter="node.address && emit('hoverNode', node.address)"
        @pointerleave="emit('hoverNode', null)"
      >
        {{ node.label }}
        <div v-if="node.address" class="text-[8px] text-gray-500">
          0x{{ node.address.toString(16).padStart(2, '0') }}
        </div>
      </div>
    </template>
  </div>
</template>
