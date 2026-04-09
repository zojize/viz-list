<script setup lang="ts">
import type { InterpreterContext } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  selectedAddress: number | null
  changedAddresses: ReadonlySet<number>
  simulating?: boolean
  highlightedAddress?: number | null
}>()

const emit = defineEmits<{
  navigate: [address: number]
  clearSelection: []
  hoverNode: [address: number | null]
  hoverField: [address: number | null]
}>()

const selectedCell = computed(() => {
  if (props.selectedAddress === null)
    return null
  return props.context.memory.cells.get(props.selectedAddress) ?? null
})

const showDetail = computed(() => selectedCell.value !== null && !props.simulating)
</script>

<template>
  <div data-testid="detail-panel" class="h-full flex overflow-hidden">
    <!-- Left: Data structures (always visible) -->
    <div class="min-w-0 flex-1 overflow-hidden">
      <LinkedListView
        :context="context"
        :highlighted-address="highlightedAddress"
        :selected-address="selectedAddress"
        @select-node="emit('navigate', $event)"
        @hover-node="emit('hoverNode', $event)"
        @hover-field="emit('hoverField', $event)"
      />
    </div>

    <!-- Right: Field table (slides in when selected) -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-x-3 opacity-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="translate-x-3 opacity-0"
    >
      <div v-if="showDetail && selectedCell" class="w-64 shrink-0 border-l border-gray-200 p-2 dark:border-gray-700">
        <div class="mb-1.5 flex items-center justify-between">
          <span class="text-[10px] text-gray-500 tracking-wide uppercase">Detail</span>
          <button
            data-testid="detail-close"
            class="i-mdi-close h-4 w-4 cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Close"
            @click="emit('clearSelection')"
          />
        </div>
        <FieldTable
          :cell="selectedCell"
          :context="context"
          :changed-addresses="changedAddresses"
          @navigate="emit('navigate', $event)"
        />
      </div>
    </Transition>
  </div>
</template>
