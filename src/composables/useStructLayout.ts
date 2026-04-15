import type { MaybeRefOrGetter } from 'vue'
import type { LayoutField } from './interpreter/layout'
import type { InterpreterContext } from './interpreter/types'
import { computed, toValue } from 'vue'

export function useStructLayout(
  context: MaybeRefOrGetter<InterpreterContext>,
  structName: MaybeRefOrGetter<string>,
) {
  const fields = computed<LayoutField[]>(() => {
    const layout = toValue(context).structLayouts[toValue(structName)]
    if (!layout || layout.kind !== 'struct')
      return []
    return layout.fields
  })

  const size = computed<number>(() => {
    const layout = toValue(context).structLayouts[toValue(structName)]
    return layout?.size ?? 0
  })

  return { fields, size }
}
