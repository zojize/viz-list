import type { MaybeRefOrGetter } from 'vue'
import type { AddressSpace } from '~/composables/interpreter/types'
import { computed, toValue } from 'vue'

export interface MemoryDiff {
  changedRanges: { start: number, end: number }[] // end exclusive (byte ranges)
  newlyAllocated: number[] // base addresses
  newlyFreed: number[] // base addresses
}

export interface MemorySnapshot {
  buffer: Uint8Array
  allocBases: Set<number>
  deadBases: Set<number>
}

export function snapshotSpace(space: AddressSpace): MemorySnapshot {
  const allocBases = new Set<number>()
  const deadBases = new Set<number>()
  for (const a of space.allocations.values()) {
    allocBases.add(a.base)
    if (a.dead)
      deadBases.add(a.base)
  }
  return { buffer: new Uint8Array(space.buffer), allocBases, deadBases }
}

export function useMemoryDiff(
  space: MaybeRefOrGetter<AddressSpace>,
  previous: MaybeRefOrGetter<MemorySnapshot | null>,
) {
  return computed<MemoryDiff>(() => {
    const s = toValue(space)
    const p = toValue(previous)
    if (!p)
      return { changedRanges: [], newlyAllocated: [], newlyFreed: [] }

    // Tracker for reactivity
    void s.version

    // Byte diff — coalesce adjacent differing bytes into ranges.
    const ranges: { start: number, end: number }[] = []
    let runStart = -1
    for (let i = 0; i < s.buffer.length; i++) {
      const differs = s.buffer[i] !== p.buffer[i]
      if (differs && runStart === -1)
        runStart = i
      if (!differs && runStart !== -1) {
        ranges.push({ start: runStart, end: i })
        runStart = -1
      }
    }
    if (runStart !== -1)
      ranges.push({ start: runStart, end: s.buffer.length })

    const currentBases = new Set<number>()
    const currentDead = new Set<number>()
    for (const a of s.allocations.values()) {
      currentBases.add(a.base)
      if (a.dead)
        currentDead.add(a.base)
    }
    const newlyAllocated: number[] = []
    const newlyFreed: number[] = []
    for (const b of currentBases) {
      if (!p.allocBases.has(b))
        newlyAllocated.push(b)
    }
    for (const b of currentDead) {
      if (!p.deadBases.has(b))
        newlyFreed.push(b)
    }

    return { changedRanges: ranges, newlyAllocated, newlyFreed }
  })
}
