import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { computed, inject, provide, readonly, shallowRef } from 'vue'

type HoverSource
  = | 'stack'
    | 'heap'
    | 'byte-stack'
    | 'byte-heap'
    | 'ds'
    | 'field-table'

/**
 * A pointer arrow to draw on the memory-map views.
 */
export interface PointerArrow {
  /** Start address of the pointer scalar itself (source of the arrow). */
  source: number
  /** Length in bytes of the pointer scalar (so the overlay can anchor mid-cell). */
  sourceSize: number
  /** Address the pointer points at. */
  target: number
}

interface HoverHighlight {
  address: Readonly<Ref<number | null>>
  fieldAddress: Readonly<Ref<number | null>>
  source: Readonly<Ref<HoverSource | null>>
  /**
   * When the user hovers over a pointer, this holds the source/target info
   * so the arrow overlay and highlight overlays can light up both ends.
   */
  pointerArrow: Readonly<Ref<PointerArrow | null>>
  /**
   * Non-hover arrows currently being rendered (pinned selection + show-all
   *  toggle). MemoryMap writes these; AddressLink / overlays read them to
   *  decide whether to underline a pointer source or boost its highlight.
   */
  pinnedArrows: Readonly<Ref<readonly PointerArrow[]>>
  ambientArrows: Readonly<Ref<readonly PointerArrow[]>>
  /**
   * Union of every address that is currently the tail (source) of an
   *  arrow being rendered. Consumed by AddressLink for its underline.
   */
  activeArrowSources: Readonly<ComputedRef<ReadonlySet<number>>>
  setHover: (address: number | null, source: HoverSource | null) => void
  setField: (fieldAddress: number | null) => void
  setPointerArrow: (arrow: PointerArrow | null) => void
  setPinnedArrows: (arrows: readonly PointerArrow[]) => void
  setAmbientArrows: (arrows: readonly PointerArrow[]) => void
  clear: () => void
}

export const HOVER_HIGHLIGHT_KEY: InjectionKey<HoverHighlight> = Symbol('HoverHighlight')

export function provideHoverHighlight(): HoverHighlight {
  const address = shallowRef<number | null>(null)
  const fieldAddress = shallowRef<number | null>(null)
  const source = shallowRef<HoverSource | null>(null)
  const pointerArrow = shallowRef<PointerArrow | null>(null)
  const pinnedArrows = shallowRef<readonly PointerArrow[]>([])
  const ambientArrows = shallowRef<readonly PointerArrow[]>([])

  const activeArrowSources = computed(() => {
    const s = new Set<number>()
    if (pointerArrow.value)
      s.add(pointerArrow.value.source)
    for (const a of pinnedArrows.value) s.add(a.source)
    for (const a of ambientArrows.value) s.add(a.source)
    return s as ReadonlySet<number>
  })

  const api: HoverHighlight = {
    address: readonly(address),
    fieldAddress: readonly(fieldAddress),
    source: readonly(source),
    pointerArrow: readonly(pointerArrow),
    pinnedArrows: readonly(pinnedArrows),
    ambientArrows: readonly(ambientArrows),
    activeArrowSources,
    setHover(a, s) {
      address.value = a
      source.value = a === null ? null : s
      if (a === null)
        pointerArrow.value = null
    },
    setField(a) {
      fieldAddress.value = a
    },
    setPointerArrow(arrow) {
      pointerArrow.value = arrow
    },
    setPinnedArrows(arrows) {
      pinnedArrows.value = arrows
    },
    setAmbientArrows(arrows) {
      ambientArrows.value = arrows
    },
    clear() {
      address.value = null
      fieldAddress.value = null
      source.value = null
      pointerArrow.value = null
    },
  }
  provide(HOVER_HIGHLIGHT_KEY, api)
  return api
}

export function useHoverHighlight(): HoverHighlight {
  const api = inject(HOVER_HIGHLIGHT_KEY)
  if (!api)
    throw new Error('useHoverHighlight() requires provideHoverHighlight() in an ancestor')
  return api
}
