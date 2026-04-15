<script setup lang="ts">
import type { MemoryManager } from '~/composables/interpreter/memory'
import { computed, ref } from 'vue'
import MemoryMapRow from './MemoryMapRow.vue'
import MemoryMapTooltip from './MemoryMapTooltip.vue'

const props = defineProps<{
  mem: MemoryManager
  bytesPerRow?: number
  changedBytes?: Set<number>
}>()

const BPR = computed(() => props.bytesPerRow ?? 16)
const hoverAddr = ref<number | null>(null)
const pinnedAddr = ref<number | null>(null)

const rows = computed<{ start: number, isGap?: boolean, gapSize?: number }[]>(() => {
  void props.mem.space.version
  const s = props.mem.space
  const bpr = BPR.value
  const stackEnd = Math.min(s.buffer.length, Math.ceil((s.stackTop + bpr * 2) / bpr) * bpr)
  const heapStart = Math.max(0, Math.floor((s.heapBottom - bpr) / bpr) * bpr)
  const result: { start: number, isGap?: boolean, gapSize?: number }[] = []
  for (let r = 0; r < stackEnd; r += bpr) result.push({ start: r })
  if (heapStart > stackEnd)
    result.push({ start: stackEnd, isGap: true, gapSize: heapStart - stackEnd })
  for (let r = heapStart; r < s.buffer.length; r += bpr) result.push({ start: r })
  return result
})

function onHover(addr: number) {
  hoverAddr.value = addr
}
function onClick(addr: number) {
  pinnedAddr.value = pinnedAddr.value === addr ? null : addr
}

const shownAddr = computed(() => pinnedAddr.value ?? hoverAddr.value)
const changed = computed(() => props.changedBytes ?? new Set<number>())
</script>

<template>
  <div class="mm-grid">
    <template v-for="row in rows" :key="row.start">
      <div v-if="row.isGap" class="mm-gap">
        … {{ row.gapSize }} free bytes …
      </div>
      <MemoryMapRow
        v-else
        :space="mem.space"
        :row-start="row.start"
        :bytes-per-row="BPR"
        :find-allocation="addr => mem.findAllocation(addr)"
        :describe-byte="addr => mem.describeByte(addr)"
        :changed-bytes="changed"
        @hover="onHover"
        @click="onClick"
      />
    </template>
    <MemoryMapTooltip :mem="mem" :address="shownAddr" />
  </div>
</template>

<style scoped>
.mm-grid {
  font-family: monospace;
}
.mm-gap {
  text-align: center;
  color: #888;
  font-style: italic;
  padding: 0.5em 0;
}
</style>
