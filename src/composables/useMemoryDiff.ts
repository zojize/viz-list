import type { AddressSpace, CppValue } from '~/composables/interpreter/types'
import { readonly, shallowRef } from 'vue'

export function useMemoryDiff(getMemory: () => AddressSpace) {
  const changedAddresses = shallowRef(new Set<number>())
  let previousValues = new Map<number, CppValue>()

  function snapshot() {
    const memory = getMemory()
    previousValues = new Map()
    for (const [addr, cell] of memory.cells) {
      previousValues.set(addr, cell.value)
    }
  }

  function diff() {
    const memory = getMemory()
    const changed = new Set<number>()
    for (const [addr, cell] of memory.cells) {
      const prev = previousValues.get(addr)
      if (prev === undefined || !valueEquals(prev, cell.value)) {
        changed.add(addr)
      }
    }
    changedAddresses.value = changed
  }

  return { changedAddresses: readonly(changedAddresses), snapshot, diff }
}

function valueEquals(a: CppValue, b: CppValue): boolean {
  if (a === b)
    return true
  if (typeof a !== typeof b)
    return false
  if (typeof a === 'object' && typeof b === 'object') {
    if (a.type !== b.type)
      return false
    if (a.type === 'pointer' && b.type === 'pointer')
      return a.address === b.address
    if (a.type === 'struct' && b.type === 'struct')
      return a.base === b.base && a.name === b.name
    if (a.type === 'array' && b.type === 'array')
      return a.base === b.base && a.length === b.length
  }
  return false
}
