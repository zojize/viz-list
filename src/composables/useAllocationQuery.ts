import type { MaybeRefOrGetter } from 'vue'
import type { MemoryManager } from './interpreter/memory'
import type { Allocation } from './interpreter/types'
import { computed, toValue } from 'vue'

export function useAllocationQuery(mem: MaybeRefOrGetter<MemoryManager>) {
  const m = computed(() => toValue(mem))

  const allAllocations = computed(() => {
    void m.value.space.version
    return Array.from(m.value.space.allocations.values())
  })

  const byRegion = computed(() => {
    void m.value.space.version
    const out: Record<'global' | 'stack' | 'heap', Allocation[]> = { global: [], stack: [], heap: [] }
    for (const a of m.value.space.allocations.values())
      out[a.region].push(a)
    return out
  })

  function describeAt(address: number) {
    void m.value.space.version
    return m.value.describeByte(address)
  }

  return { allAllocations, byRegion, describeAt }
}
