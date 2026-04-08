<script setup lang="ts">
import type { CppValue, InterpreterContext } from '~/composables/interpreter/types'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

const props = defineProps<{
  address: number
  context: Readonly<InterpreterContext>
}>()

const emit = defineEmits<{
  navigate: [address: number]
}>()

interface ChainNode {
  address: number | null
  label: string
  isCurrent: boolean
}

const chain = computed((): ChainNode[] => {
  const cell = props.context.memory.cells.get(props.address)
  if (!cell || typeof cell.type !== 'object' || cell.type.type !== 'struct')
    return []

  const structDef = props.context.structs[cell.type.name]
  if (!structDef || !('next' in structDef))
    return []

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

  function getData(base: number): string {
    const data = readField(base, 'data')
    return data !== undefined ? String(data) : '?'
  }

  function getPointerAddr(value: CppValue | undefined): number | null {
    if (!value || typeof value !== 'object' || value.type !== 'pointer')
      return null
    return value.address === NULL_ADDRESS ? null : value.address
  }

  // Find the head of the list by walking backwards through prev, or scanning LinkedList structs
  let headAddr: number | null = null

  const hasPrev = 'prev' in structDef

  if (hasPrev) {
    // Walk backwards from current node to find the head
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
    // Singly linked: scan for a LinkedList whose head reaches this node
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
      // Walk from this head to see if we reach our node
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
      headAddr = props.address // fallback: start from current
  }

  // Build full chain from head
  const nodes: ChainNode[] = []
  let cur: number | null = headAddr
  const seen = new Set<number>()

  while (cur !== null) {
    if (seen.has(cur))
      break
    seen.add(cur)
    nodes.push({
      address: cur,
      label: getData(cur),
      isCurrent: cur === props.address,
    })
    cur = getPointerAddr(readField(cur, 'next'))
  }
  nodes.push({ address: null, label: 'NULL', isCurrent: false })

  return nodes
})
</script>

<template>
  <div class="flex items-center gap-1 overflow-x-auto py-2">
    <template v-for="(node, i) in chain" :key="node.address ?? `null-${i}`">
      <span v-if="i > 0" class="text-xs text-green-400">&#8594;</span>
      <div
        class="shrink-0 rounded px-2 py-1 text-center text-xs font-mono"
        :class="{
          'bg-blue-500/20 outline-2 outline-blue-400 outline': node.isCurrent,
          'bg-gray-700 cursor-pointer hover:bg-gray-600': !node.isCurrent && node.address !== null,
          'text-red-400 opacity-50': node.address === null,
          'text-orange-300': node.address !== null,
        }"
        @click="node.address && emit('navigate', node.address)"
      >
        {{ node.label }}
        <div v-if="node.address" class="text-[8px] text-gray-500">
          0x{{ node.address.toString(16).padStart(2, '0') }}
        </div>
      </div>
    </template>
  </div>
</template>
