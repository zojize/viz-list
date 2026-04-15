import type { AddressSpace } from '~/composables/interpreter/types'
import { readonly, shallowRef } from 'vue'

/**
 * Temporary stub for Task 13 — will be rewritten in Task 14 to diff
 * the byte buffer and allocation map across steps.
 *
 * For now returns an empty changedAddresses set so FieldTable highlights
 * nothing (rather than breaking at runtime).
 */
export function useMemoryDiff(_getMemory: () => AddressSpace) {
  const changedAddresses = shallowRef(new Set<number>())

  function snapshot() {
    // no-op until Task 14
  }

  function diff() {
    // no-op until Task 14
  }

  return { changedAddresses: readonly(changedAddresses), snapshot, diff }
}
