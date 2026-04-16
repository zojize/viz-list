import type { InjectionKey, Ref } from 'vue'
import { inject, provide, readonly, shallowRef } from 'vue'

export type HoverSource
  = | 'stack'
    | 'heap'
    | 'byte-stack'
    | 'byte-heap'
    | 'ds'
    | 'field-table'

export interface HoverHighlight {
  address: Readonly<Ref<number | null>>
  fieldAddress: Readonly<Ref<number | null>>
  source: Readonly<Ref<HoverSource | null>>
  setHover: (address: number | null, source: HoverSource | null) => void
  setField: (fieldAddress: number | null) => void
  clear: () => void
}

const KEY: InjectionKey<HoverHighlight> = Symbol('HoverHighlight')

export function provideHoverHighlight(): HoverHighlight {
  const address = shallowRef<number | null>(null)
  const fieldAddress = shallowRef<number | null>(null)
  const source = shallowRef<HoverSource | null>(null)

  const api: HoverHighlight = {
    address: readonly(address),
    fieldAddress: readonly(fieldAddress),
    source: readonly(source),
    setHover(a, s) {
      address.value = a
      source.value = a === null ? null : s
    },
    setField(a) {
      fieldAddress.value = a
    },
    clear() {
      address.value = null
      fieldAddress.value = null
      source.value = null
    },
  }
  provide(KEY, api)
  return api
}

export function useHoverHighlight(): HoverHighlight {
  const api = inject(KEY)
  if (!api)
    throw new Error('useHoverHighlight() requires provideHoverHighlight() in an ancestor')
  return api
}
