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

function formatType(t: import('~/composables/interpreter/types').CppType): string {
  if (typeof t === 'string')
    return t
  if (t.type === 'pointer')
    return `${formatType(t.to)}*`
  if (t.type === 'array')
    return `${formatType(t.of)}[${t.size}]`
  if (t.type === 'struct')
    return `struct ${t.name}`
  return JSON.stringify(t)
}
</script>

<template>
  <!-- Detail panel — sits below the two columns, full width -->
  <div
    class="mt-2 border border-gray-200 rounded-lg bg-gray-100 p-3 text-xs font-mono dark:border-gray-700 dark:bg-gray-800"
  >
    <!-- Empty state -->
    <p v-if="!info" class="text-gray-400 italic dark:text-gray-500">
      Hover a byte for details
    </p>

    <template v-else>
      <!-- Header row: address + region badge -->
      <div class="mb-2 flex items-center gap-2">
        <span class="text-gray-500 dark:text-gray-400">address</span>
        <span class="text-orange-600 font-semibold dark:text-orange-300">
          0x{{ info.address.toString(16).padStart(4, '0') }}
        </span>
        <span
          v-if="!info.free"
          class="rounded px-1.5 py-0.5 text-[10px]"
          :class="{
            'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300': info.allocation.region === 'stack',
            'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300': info.allocation.region === 'heap',
            'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300': info.allocation.region === 'global',
          }"
        >
          {{ info.allocation.region }}
        </span>
      </div>

      <!-- Free byte -->
      <p v-if="info.free" class="text-gray-400 italic dark:text-gray-500">
        free (unallocated)
      </p>

      <!-- Allocated byte details -->
      <dl
        v-else
        class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5"
      >
        <dt class="text-gray-500 dark:text-gray-400">
          alloc base
        </dt>
        <dd class="text-gray-700 dark:text-gray-300">
          0x{{ info.allocation.base.toString(16).padStart(4, '0') }}
          <span class="text-gray-400 dark:text-gray-500">(size {{ info.allocation.size }})</span>
        </dd>

        <template v-if="info.path.length">
          <dt class="text-gray-500 dark:text-gray-400">
            path
          </dt>
          <dd class="text-gray-700 dark:text-gray-300">
            {{ info.path.join('.') }}
          </dd>
        </template>

        <dt class="text-gray-500 dark:text-gray-400">
          type
        </dt>
        <dd class="text-gray-700 dark:text-gray-300">
          <span v-if="info.isPadding" class="text-gray-400 italic dark:text-gray-500">padding</span>
          <span v-else>{{ formatType(info.leafType) }}</span>
        </dd>

        <dt class="text-gray-500 dark:text-gray-400">
          raw byte
        </dt>
        <dd>
          <span class="text-orange-600 font-semibold dark:text-orange-300">
            0x{{ info.byte.toString(16).padStart(2, '0') }}
          </span>
          <span class="ml-1 text-gray-400 dark:text-gray-500">({{ info.byte }})</span>
        </dd>
      </dl>
    </template>
  </div>
</template>
