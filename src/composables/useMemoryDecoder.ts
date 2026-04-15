import type { MaybeRefOrGetter } from 'vue'
import type { MemoryManager } from './interpreter/memory'
import type { CppType } from './interpreter/types'
import { computed, toValue } from 'vue'

export function useMemoryDecoder(mem: MaybeRefOrGetter<MemoryManager>) {
  const m = computed(() => toValue(mem))

  function decode(address: number, type: CppType): string {
    // Depend on version for reactivity.
    const _v = m.value.space.version
    if (typeof type === 'string') {
      const v = m.value.readScalar(address, type)
      return formatPrimitive(v, type)
    }
    if (type.type === 'pointer') {
      const p = m.value.readScalar(address, type) as number
      return p === 0 ? 'NULL' : `0x${p.toString(16)}`
    }
    return '(aggregate)'
  }

  function hex(address: number, size: number): string {
    // Depend on version for reactivity.
    const _v = m.value.space.version
    const bytes: string[] = []
    for (let i = 0; i < size; i++)
      bytes.push(m.value.space.buffer[address + i].toString(16).padStart(2, '0'))
    return bytes.join(' ')
  }

  return { decode, hex }
}

function formatPrimitive(v: number | boolean, t: 'int' | 'float' | 'double' | 'char' | 'bool' | 'void'): string {
  if (t === 'bool')
    return v ? 'true' : 'false'
  if (t === 'char')
    return `'${String.fromCharCode(v as number)}' (${v})`
  if (t === 'float' || t === 'double')
    return (v as number).toFixed(4)
  return String(v)
}
