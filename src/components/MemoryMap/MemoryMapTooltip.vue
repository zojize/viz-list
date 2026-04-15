<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed } from 'vue'

const props = defineProps<{
  mem: MemoryManager
  address: number | null
}>()

const info = computed(() => {
  if (props.address == null)
    return null
  void props.mem.space.version
  const d = props.mem.describeByte(props.address)
  if (!d)
    return { address: props.address, free: true as const }
  return {
    address: props.address,
    allocation: d.allocation,
    path: d.path,
    leafType: d.leafType,
    isPadding: d.isPadding,
    byte: props.mem.space.buffer[props.address],
    free: false as const,
  }
})
</script>

<template>
  <div v-if="info" class="mm-tooltip">
    <div><b>address</b> 0x{{ info.address.toString(16) }}</div>
    <template v-if="info.free">
      <div>free</div>
    </template>
    <template v-else>
      <div><b>allocation</b> base=0x{{ info.allocation.base.toString(16) }} size={{ info.allocation.size }} region={{ info.allocation.region }}</div>
      <div v-if="info.path.length">
        <b>path</b> {{ info.path.join('.') }}
      </div>
      <div v-if="info.isPadding">
        <i>padding byte</i>
      </div>
      <div v-else>
        <b>type</b> {{ typeof info.leafType === 'string' ? info.leafType : JSON.stringify(info.leafType) }}
      </div>
      <div><b>byte</b> 0x{{ info.byte.toString(16).padStart(2, '0') }}</div>
    </template>
  </div>
</template>

<style scoped>
.mm-tooltip {
  font-family: monospace;
  font-size: 0.85em;
  border: 1px solid #ccc;
  padding: 0.5em;
  background: #fff;
}
</style>
