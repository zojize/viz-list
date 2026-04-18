<script setup lang="ts">
import { computed, inject } from 'vue'
import { formatAddr } from '~/composables/interpreter/helpers'
import { NULL_ADDRESS } from '~/composables/interpreter/types'
import { HOVER_HIGHLIGHT_KEY } from '~/composables/useHoverHighlight'

const props = defineProps<{
  address: number
  /** Byte address of this link itself (its own location in memory). When
   *  provided, the link can act as the visible anchor for an arrow
   *  originating here — the ArrowOverlay looks up `[data-pointer-source]`
   *  so it can start a curve from the underline's center. Optional because
   *  AddressLink is also used in contexts where no arrow applies. */
  sourceAddress?: number
}>()

const emit = defineEmits<{
  navigate: [address: number]
  hover: [address: number | null]
}>()

const isNull = computed(() => props.address === NULL_ADDRESS)
const label = computed(() => isNull.value ? 'NULL' : formatAddr(props.address))

// Inject optionally — AddressLink is used outside MemoryMap too (Monaco side
// panels, etc.), where the hover store isn't provided.
const hover = inject(HOVER_HIGHLIGHT_KEY, null)
const isArrowSource = computed(() => {
  if (!hover || props.sourceAddress === undefined)
    return false
  return hover.activeArrowSources.value.has(props.sourceAddress)
})
</script>

<template>
  <span
    class="cursor-pointer font-mono hover:underline"
    :class="[
      isNull ? 'text-red-400' : 'text-green-400',
      isArrowSource ? 'underline decoration-current decoration-2 underline-offset-2' : '',
    ]"
    :data-pointer-source="sourceAddress"
    data-anchor-edge="bottom"
    @click.stop="!isNull && emit('navigate', address)"
    @pointerenter="!isNull && emit('hover', address)"
    @pointerleave="emit('hover', null)"
  >{{ label }}</span>
</template>
