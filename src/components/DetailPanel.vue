<script setup lang="ts">
import type { InterpreterContext } from '~/composables/interpreter/types'

const props = defineProps<{
  context: Readonly<InterpreterContext>
  selectedAddress: number | null
  changedAddresses: ReadonlySet<number>
  simulating?: boolean
}>()

const emit = defineEmits<{
  navigate: [address: number]
  clearSelection: []
}>()

const selectedCell = computed(() => {
  if (props.selectedAddress === null)
    return null
  return props.context.memory.cells.get(props.selectedAddress) ?? null
})

// Show detail only when user explicitly clicked (not during simulation)
const showDetail = computed(() => selectedCell.value !== null && !props.simulating)
</script>

<template>
  <div class="h-full overflow-auto p-2">
    <!-- Detail mode: FieldTable + linked list context -->
    <template v-if="showDetail && selectedCell">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[10px] text-gray-500 tracking-wide uppercase">Detail</span>
        <button
          class="i-mdi-close text-xs text-gray-500 hover:text-gray-300"
          title="Close"
          @click="emit('clearSelection')"
        />
      </div>
      <div class="flex gap-4">
        <div class="flex-1">
          <FieldTable
            :cell="selectedCell"
            :context="context"
            :changed-addresses="changedAddresses"
            @navigate="emit('navigate', $event)"
          />
        </div>
        <div class="flex-1">
          <div class="mb-1 text-[10px] text-gray-500 tracking-wide uppercase">
            Linked List
          </div>
          <NeighborhoodGraph
            :address="selectedCell.address"
            :context="context"
            @navigate="emit('navigate', $event)"
          />
        </div>
      </div>
    </template>

    <!-- Default mode: data structure overview -->
    <template v-else>
      <div class="mb-2 text-[10px] text-gray-500 tracking-wide uppercase">
        Data Structures
      </div>
      <LinkedListView
        :context="context"
        @select-node="emit('navigate', $event)"
      />
    </template>
  </div>
</template>
