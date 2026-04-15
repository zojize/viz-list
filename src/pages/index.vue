<script setup lang="ts">
import type { MemoryDiff, MemorySnapshot } from '~/composables/useMemoryDiff'
import { useHead } from '@unhead/vue'
import { onClickOutside, useClipboard, useIntervalFn, useLocalStorage, useMediaQuery, useTimeoutFn } from '@vueuse/core'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { Pane, Splitpanes } from 'splitpanes'
import { computed, markRaw, nextTick, onMounted, readonly, shallowRef, useTemplateRef, watch } from 'vue'
import { Language, Parser } from 'web-tree-sitter'
import DataStructureView from '~/components/DataStructureView.vue'
import FieldTable from '~/components/FieldTable.vue'
import MemoryMap from '~/components/MemoryMap.vue'
import { useCppInterpreter } from '~/composables/useCppInterpreter'
import { provideInterpreterContext } from '~/composables/useInterpreterContext'
import { snapshotSpace, useMemoryDiff } from '~/composables/useMemoryDiff'
import { useMonacoEditor } from '~/composables/useMonacoEditor'
import { useStatementAddresses } from '~/composables/useStatementAddresses'
import 'splitpanes/dist/splitpanes.css'

useHead({
  title: 'StructViz',
  meta: [{ name: 'description', content: 'Interactive C++ data structure visualizer' }],
})

const queryParams = new URLSearchParams(window.location.search)

// ---- Templates (all self-contained with their own struct definitions) ----

const templateFileRe = /([^/]+)\.cpp$/

const templates = Object.fromEntries(Object.entries(
  import.meta.glob('~/templates/general/*.cpp', { eager: true, import: 'default', query: '?raw' }),
).map(([path, code]) => [path.match(templateFileRe)![1], code] as [string, string]))

const templateNames = Object.keys(templates)
const selectedTemplateName = useLocalStorage('selected-template', 'singly-insertBack')

const code = useLocalStorage('code', templates[selectedTemplateName.value] ?? '')
if (queryParams.has('code')) {
  const queryCode = queryParams.get('code')!
  let userCode = decompressFromEncodedURIComponent(queryCode)
  if (!userCode)
    userCode = decompressFromEncodedURIComponent(decodeURIComponent(queryCode))
  code.value = userCode
}

// ---- Monaco editor (composable) ----

const monacoContainer = useTemplateRef('monaco-container')
const {
  completeCode,
  highlightCurrentNode,
  highlightError,
  clearHighlight,
  resetTracking,
  setReadOnly,
  setTemplateCode,
  highlightVariable,
} = useMonacoEditor({
  container: monacoContainer,
  code,
})

// ---- Tree-Sitter ----

const parser = shallowRef<Parser>(undefined!)
const cpp = shallowRef<Language>()
Parser.init().then(() => Language.load('tree-sitter-cpp.wasm')).then((language) => {
  const p = new Parser()
  p.setLanguage(language)
  cpp.value = language
  parser.value = p
})

const tree = computed(() => {
  if (!parser.value)
    return undefined
  const result = parser.value.parse(completeCode.value)
  return result ? markRaw(result) : undefined
})

// ---- Interpreter ----

const { init, step, reset, context, isActive } = useCppInterpreter(tree)
provideInterpreterContext(context)
const previousSnapshot = shallowRef<MemorySnapshot | null>(null)
const memoryDiff = useMemoryDiff(() => context.memory.space, previousSnapshot) satisfies { value: MemoryDiff }
const changedAddresses = computed<ReadonlySet<number>>(() => {
  const set = new Set<number>()
  for (const { start, end } of memoryDiff.value.changedRanges) {
    for (let i = start; i < end; i++)
      set.add(i)
  }
  return readonly(set)
})
const { lhsAddresses, rhsAddresses } = useStatementAddresses(context, isActive)
const selectedAddress = shallowRef<number | null>(null)
/** Resolved type for the selected address, derived from its allocation layout. */
const selectedAlloc = computed(() => {
  if (selectedAddress.value === null)
    return null
  // eslint-disable-next-line ts/no-unused-expressions
  context.memory.space.version // reactive dependency
  return context.memory.findAllocation(selectedAddress.value) ?? null
})
const selectedType = computed(() => {
  const a = selectedAlloc.value
  if (!a)
    return null
  const l = a.layout
  if (l.kind === 'scalar')
    return l.type
  if (l.kind === 'array')
    return { type: 'array' as const, of: fieldNodeToType(l.element), size: l.length }
  return { type: 'struct' as const, name: l.structName }
})

function fieldNodeToType(node: import('~/composables/interpreter/layout').LayoutNode): import('~/composables/interpreter/types').CppType {
  if (node.kind === 'scalar')
    return node.type
  if (node.kind === 'array')
    return { type: 'array' as const, of: fieldNodeToType(node.element), size: node.length }
  return { type: 'struct' as const, name: node.structName }
}
const hoveredNodeAddress = shallowRef<number | null>(null)
const hoveredFieldAddress = shallowRef<number | null>(null)

const executionError = shallowRef<{ message: string, line?: number } | null>(null)

// ---- Current line highlighting ----

watch(() => context.currentNode, (node) => {
  if (!node || !isActive.value)
    return
  highlightCurrentNode(node)
})

// ---- Speed control ----

const speedMs = useLocalStorage('sim-speed', 200)
const { resume, pause, isActive: running } = useIntervalFn(handleStep, speedMs, { immediate: false, immediateCallback: true })
watch(running, r => setReadOnly(r))

// ---- Template switching ----

watch(selectedTemplateName, (name) => {
  pause()
  const tmpl = templates[name]
  if (tmpl)
    setTemplateCode(tmpl)
})

const editedWhileActive = shallowRef(false)
watch(code, () => editedWhileActive.value = isActive.value)

// ---- Template picker dropdown ----

const templatePickerOpen = shallowRef(false)
const templatePickerRef = useTemplateRef<HTMLElement>('template-picker')
onClickOutside(templatePickerRef, () => templatePickerOpen.value = false)

function selectTemplate(name: string) {
  selectedTemplateName.value = name
  templatePickerOpen.value = false
}

// ---- Info modal ----

const infoOpen = shallowRef(false)

// ---- Share ----

const playingShareAnimation = shallowRef(false)
const clipboardIcon = '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1em\' height=\'1em\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'none\' stroke=\'currentColor\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\'%3E%3Cpath stroke-dasharray=\'72\' stroke-dashoffset=\'72\' d=\'M12 3h7v18h-14v-18h7Z\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' dur=\'0.6s\' values=\'72;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'12\' stroke-dashoffset=\'12\' stroke-width=\'1\' d=\'M14.5 3.5v3h-5v-3\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.7s\' dur=\'0.2s\' values=\'12;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'10\' stroke-dashoffset=\'10\' d=\'M9 13l2 2l4 -4\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.9s\' dur=\'0.2s\' values=\'10;0\'/%3E%3C/path%3E%3C/g%3E%3C/svg%3E'
const clipBoardIconUrl = shallowRef(`url("data:image/svg+xml,${clipboardIcon}")`)
const { copy } = useClipboard()
const { start: startShareAnimationTimeout } = useTimeoutFn(
  () => playingShareAnimation.value = false,
  2000,
  { immediate: false },
)

function saveToUrl() {
  const savedCode = compressToEncodedURIComponent(code.value)
  const url = new URL(window.location.href)
  url.searchParams.set('code', savedCode)
  window.history.replaceState(null, '', url)
  copy(window.location.href)
  playingShareAnimation.value = true
  clipBoardIconUrl.value = `url("data:image/svg+xml,%3C!-- ${Date.now()} --%3E${clipboardIcon}")`
  startShareAnimationTimeout()
}

// ---- Actions ----

function handleReset() {
  clearHighlight()
  pause()
  reset()
  resetTracking()
  selectedAddress.value = null
  executionError.value = null
  previousSnapshot.value = null
}

function handleRun() {
  if (!isActive.value || editedWhileActive.value) {
    editedWhileActive.value = false
    init()
  }
  executionError.value = null
  selectedAddress.value = null
  resume()
}

function handlePause() {
  pause()
}

function runStep() {
  try {
    previousSnapshot.value = snapshotSpace(context.memory.space)
    const { done, breakpoint } = step()
    if (done || breakpoint)
      pause()
  }
  catch (e) {
    const err = e as Error
    console.error(err, context.currentNode)
    executionError.value = {
      message: err.message || 'Runtime error',
      line: context.currentNode ? context.currentNode.startPosition.row + 1 : undefined,
    }
    if (context.currentNode)
      highlightError(context.currentNode, err.message || 'Error')
    pause()
  }
}

function handleStep() {
  executionError.value = null
  selectedAddress.value = null
  if (!isActive.value || editedWhileActive.value) {
    editedWhileActive.value = false
    init()
  }
  runStep()
}

const speedLabel = computed(() => {
  const ms = speedMs.value
  if (ms <= 150)
    return 'fast'
  if (ms <= 300)
    return 'med'
  if (ms <= 500)
    return 'slow'
  return 'slower'
})

// ---- Mobile layout ----

const isMobile = useMediaQuery('(max-width: 767px)')
const mobileTab = shallowRef<'code' | 'viz'>('code')

// Move Monaco between desktop and mobile editor slots
function reparentMonaco() {
  const el = monacoContainer.value
  if (!el)
    return
  const mobileSlot = document.getElementById('mobile-editor-slot')
  const desktopSlot = document.getElementById('desktop-editor-slot')
  const mobileCodeTab = document.getElementById('mobile-code-tab')
  if (isMobile.value && mobileSlot && mobileCodeTab) {
    // Move slot into code tab and show it, then move Monaco into it
    mobileCodeTab.insertBefore(mobileSlot, mobileCodeTab.firstChild)
    mobileSlot.className = 'min-h-0 flex flex-1 flex-col'
    if (el.parentElement !== mobileSlot)
      mobileSlot.appendChild(el)
  }
  else if (desktopSlot) {
    // Hide mobile slot, move Monaco back to desktop
    if (mobileSlot)
      mobileSlot.className = 'hidden'
    if (el.parentElement !== desktopSlot)
      desktopSlot.appendChild(el)
  }
}
watch(isMobile, reparentMonaco, { flush: 'post' })
onMounted(() => nextTick(reparentMonaco))
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Controls toolbar (always visible) -->
    <div class="flex items-center justify-between gap-2 px-2 py-1.5">
      <!-- Left: template picker + info -->
      <div class="flex items-center gap-2">
        <!-- Template dropdown -->
        <div ref="template-picker" data-testid="template-picker" class="relative">
          <button
            class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium transition-all dark:bg-white/5"
            :class="templatePickerOpen ? 'text-vitesse' : 'text-gray-600 dark:text-gray-400'"
            @click.stop="templatePickerOpen = !templatePickerOpen"
          >
            <div class="i-carbon-code text-[0.85em]" />
            {{ selectedTemplateName }}
            <div class="i-carbon-chevron-down text-[0.7em] transition-transform" :class="templatePickerOpen && 'rotate-180'" />
          </button>
          <Transition
            enter-active-class="transition-all duration-150 ease-out"
            enter-from-class="opacity-0 -translate-y-1 scale-95"
            leave-active-class="transition-all duration-100 ease-in"
            leave-to-class="opacity-0 -translate-y-1 scale-95"
          >
            <div
              v-if="templatePickerOpen"
              class="absolute left-0 top-full z-20 mt-1 max-h-80 min-w-40 overflow-y-auto border border-gray-200 rounded-lg bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                v-for="name in templateNames"
                :key="name"
                :data-testid="`template-${name}`"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
                :class="selectedTemplateName === name
                  ? 'text-vitesse bg-vitesse/5'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'"
                @click="selectTemplate(name)"
              >
                <div
                  class="h-1.5 w-1.5 rounded-full"
                  :class="selectedTemplateName === name ? 'bg-vitesse' : 'bg-transparent'"
                />
                {{ name }}
              </button>
            </div>
          </Transition>
        </div>
        <button
          class="flex items-center justify-center rounded-lg bg-gray-100 p-1 text-gray-500 transition-colors dark:bg-white/5 hover:text-vitesse"
          title="How to use"
          @click="infoOpen = true"
        >
          <div class="i-carbon-information h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Right: playback controls -->
      <div class="flex items-center gap-2">
        <!-- Speed slider (hidden on mobile to save space) -->
        <div class="hidden items-center gap-1.5 sm:flex">
          <span class="text-[10px] text-gray-500 font-mono uppercase">{{ speedLabel }}</span>
          <input
            :value="520 - speedMs"
            type="range"
            min="20"
            max="500"
            step="10"
            class="w-16"
            title="Simulation speed"
            @input="speedMs = 520 - Number(($event.target as HTMLInputElement).value)"
          >
        </div>

        <!-- Playback buttons -->
        <div class="toolbar-group">
          <button data-testid="btn-reset" class="icon-btn" title="Reset" @click="handleReset()">
            <div class="i-carbon-reset" />
          </button>
          <button v-if="running" data-testid="btn-pause" class="icon-btn" title="Pause" @click="handlePause()">
            <div class="i-carbon-pause-filled text-vitesse" />
          </button>
          <button v-else data-testid="btn-run" class="icon-btn" title="Run" @click="handleRun()">
            <div class="i-carbon-play-filled" />
          </button>
          <button data-testid="btn-step" :data-step="context.memory.space.version" class="icon-btn" title="Step" @click="handleStep()">
            <div class="i-carbon-skip-forward-filled" />
          </button>
        </div>

        <button
          class="icon-btn"
          :style="playingShareAnimation && { '--un-icon': clipBoardIconUrl }"
          title="Copy share link"
          @click="playingShareAnimation || saveToUrl()"
        >
          <div class="i-carbon-share" />
        </button>
      </div>
    </div>

    <!-- Mobile tab toggle -->
    <div v-if="isMobile" class="flex border-b border-gray-200 dark:border-gray-800">
      <button
        class="flex-1 py-1.5 text-center text-xs font-medium transition-colors"
        :class="mobileTab === 'code'
          ? 'text-vitesse border-b-2 border-vitesse'
          : 'text-gray-500 dark:text-gray-400'"
        @click="mobileTab = 'code'"
      >
        <div class="i-carbon-code mr-1 inline-block align-middle text-[0.85em]" />
        Code
      </button>
      <button
        class="flex-1 py-1.5 text-center text-xs font-medium transition-colors"
        :class="mobileTab === 'viz'
          ? 'text-vitesse border-b-2 border-vitesse'
          : 'text-gray-500 dark:text-gray-400'"
        @click="mobileTab = 'viz'"
      >
        <div class="i-carbon-data-vis-1 mr-1 inline-block align-middle text-[0.85em]" />
        Visualize
      </button>
    </div>

    <!-- Desktop: Splitpanes layout (hidden on mobile via CSS) -->
    <Splitpanes class="min-h-0 flex-1" :class="isMobile && 'hidden!'">
      <!-- Left: Editor -->
      <Pane :size="50" :min-size="20" class="flex flex-col">
        <div id="desktop-editor-slot" class="min-h-0 flex flex-1 flex-col">
          <div ref="monaco-container" class="min-h-0 flex-1" />
        </div>

        <!-- Error toast -->
        <Transition
          enter-active-class="transition-all duration-250 ease-out"
          enter-from-class="translate-y-full opacity-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-to-class="translate-y-full opacity-0"
        >
          <div
            v-if="executionError"
            class="mx-2 mb-2 flex items-start gap-2 border border-accent-rose/20 rounded-lg bg-accent-rose/10 px-3 py-2"
          >
            <div class="i-carbon-warning-alt mt-0.5 shrink-0 text-accent-rose" />
            <div class="min-w-0 flex-1">
              <p class="text-xs text-accent-rose font-medium">
                {{ executionError.message }}
              </p>
              <p v-if="executionError.line" class="mt-0.5 text-[10px] text-accent-rose/60 font-mono">
                line {{ executionError.line }}
              </p>
            </div>
            <button class="shrink-0 text-accent-rose/60 hover:text-accent-rose" @click="executionError = null">
              <div class="i-carbon-close text-xs" />
            </button>
          </div>
        </Transition>
      </Pane>

      <!-- Right: Visualization -->
      <Pane :size="50" :min-size="20" class="h-full" data-testid="viz-panel">
        <Splitpanes horizontal class="h-full">
          <!-- Memory map -->
          <Pane :size="50" :min-size="15">
            <div class="h-full overflow-hidden panel-border">
              <MemoryMap
                :changed-addresses="changedAddresses"
                :highlighted-address="hoveredNodeAddress"
                :highlighted-field-address="hoveredFieldAddress"
                :statement-lhs-addresses="lhsAddresses"
                :statement-rhs-addresses="rhsAddresses"
                :selected-address="selectedAddress"
                @select-cell="selectedAddress = selectedAddress === $event ? null : $event"
                @hover-pointer="hoveredNodeAddress = $event"
                @hover-variable="highlightVariable($event, context.currentNode)"
              />
            </div>
          </Pane>
          <!-- Data structure + detail -->
          <Pane :size="50" :min-size="15">
            <Splitpanes class="h-full">
              <Pane :min-size="30">
                <div class="h-full overflow-hidden panel-border">
                  <DataStructureView
                    :highlighted-address="hoveredNodeAddress"
                    :highlighted-field-address="hoveredFieldAddress"
                    :selected-address="selectedAddress"
                    :statement-lhs-addresses="lhsAddresses"
                    :statement-rhs-addresses="rhsAddresses"
                    @select-node="selectedAddress = $event"
                    @hover-node="hoveredNodeAddress = $event"
                    @hover-field="hoveredFieldAddress = $event"
                    @hover-variable="highlightVariable($event, context.currentNode)"
                  />
                </div>
              </Pane>
              <Pane v-if="selectedAlloc && selectedType && !running" :size="35" :min-size="15" class="overflow-auto p-2">
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="text-[10px] text-gray-500 tracking-wide uppercase">Detail</span>
                  <button
                    data-testid="detail-close"
                    class="i-mdi-close h-4 w-4 cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Close"
                    @click="selectedAddress = null"
                  />
                </div>
                <FieldTable
                  :address="selectedAddress!"
                  :type="selectedType!"
                  :changed-addresses="changedAddresses"
                  @navigate="selectedAddress = $event"
                  @hover-field="hoveredFieldAddress = $event"
                  @hover-pointer="hoveredNodeAddress = $event"
                />
              </Pane>
            </Splitpanes>
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>

    <!-- Mobile editor slot (always in DOM for reparenting) -->
    <div id="mobile-editor-slot" class="hidden" />

    <!-- Mobile: tabbed layout -->
    <div v-if="isMobile" class="min-h-0 flex flex-1 flex-col overflow-hidden">
      <!-- Code tab -->
      <div v-show="mobileTab === 'code'" id="mobile-code-tab" class="min-h-0 flex flex-1 flex-col">
        <!-- Error toast -->
        <Transition
          enter-active-class="transition-all duration-250 ease-out"
          enter-from-class="translate-y-full opacity-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-to-class="translate-y-full opacity-0"
        >
          <div
            v-if="executionError"
            class="mx-2 mb-2 flex items-start gap-2 border border-accent-rose/20 rounded-lg bg-accent-rose/10 px-3 py-2"
          >
            <div class="i-carbon-warning-alt mt-0.5 shrink-0 text-accent-rose" />
            <div class="min-w-0 flex-1">
              <p class="text-xs text-accent-rose font-medium">
                {{ executionError.message }}
              </p>
              <p v-if="executionError.line" class="mt-0.5 text-[10px] text-accent-rose/60 font-mono">
                line {{ executionError.line }}
              </p>
            </div>
            <button class="shrink-0 text-accent-rose/60 hover:text-accent-rose" @click="executionError = null">
              <div class="i-carbon-close text-xs" />
            </button>
          </div>
        </Transition>
      </div>

      <!-- Viz tab -->
      <div v-show="mobileTab === 'viz'" class="min-h-0 flex flex-1 flex-col overflow-hidden" data-testid="mobile-viz-panel">
        <!-- Memory map -->
        <div class="h-1/2 overflow-hidden panel-border">
          <MemoryMap
            :changed-addresses="changedAddresses"
            :highlighted-address="hoveredNodeAddress"
            :highlighted-field-address="hoveredFieldAddress"
            :statement-lhs-addresses="lhsAddresses"
            :statement-rhs-addresses="rhsAddresses"
            :selected-address="selectedAddress"
            @select-cell="selectedAddress = selectedAddress === $event ? null : $event"
            @hover-pointer="hoveredNodeAddress = $event"
            @hover-variable="highlightVariable($event, context.currentNode)"
          />
        </div>
        <!-- Data structure view -->
        <div class="min-h-0 flex-1 overflow-hidden panel-border">
          <DataStructureView
            :highlighted-address="hoveredNodeAddress"
            :highlighted-field-address="hoveredFieldAddress"
            :selected-address="selectedAddress"
            :statement-lhs-addresses="lhsAddresses"
            :statement-rhs-addresses="rhsAddresses"
            @select-node="selectedAddress = $event"
            @hover-node="hoveredNodeAddress = $event"
            @hover-field="hoveredFieldAddress = $event"
            @hover-variable="highlightVariable($event, context.currentNode)"
          />
        </div>
        <!-- Detail panel (bottom sheet on mobile) -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="translate-y-full"
          leave-active-class="transition-all duration-150 ease-in"
          leave-to-class="translate-y-full"
        >
          <div v-if="selectedAlloc && selectedType && !running" class="max-h-1/3 overflow-auto border-t border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[10px] text-gray-500 tracking-wide uppercase">Detail</span>
              <button
                data-testid="detail-close"
                class="i-mdi-close h-4 w-4 cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="Close"
                @click="selectedAddress = null"
              />
            </div>
            <FieldTable
              :address="selectedAddress!"
              :type="selectedType!"
              :changed-addresses="changedAddresses"
              @navigate="selectedAddress = $event"
              @hover-field="hoveredFieldAddress = $event"
              @hover-pointer="hoveredNodeAddress = $event"
            />
          </div>
        </Transition>
      </div>
    </div>
  </div>

  <!-- Info modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="infoOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="infoOpen = false">
        <div class="relative mx-4 max-h-[80vh] max-w-lg w-full overflow-y-auto border border-gray-200 rounded-xl bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <button
            class="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="infoOpen = false"
          >
            <div class="i-carbon-close h-4 w-4" />
          </button>

          <h2 class="mb-4 text-base text-gray-800 font-semibold dark:text-gray-200">
            How to use
          </h2>

          <p class="mb-3 text-xs text-gray-500 dark:text-gray-500">
            This tool interprets a subset of C++ — not the full language, but enough to
            visualize common data structures and algorithms (structs, pointers, arrays,
            new/delete, functions, loops, conditionals).
          </p>

          <div class="text-xs text-gray-600 leading-relaxed space-y-4 dark:text-gray-400">
            <section>
              <h3 class="mb-1 text-sm text-gray-700 font-medium dark:text-gray-300">
                Editor
              </h3>
              <ul class="list-disc pl-4 space-y-0.5">
                <li>Write or edit C++ code in the left panel</li>
                <li>Choose a template from the dropdown to load example code</li>
                <li>Share your code via the share button (copies a URL to clipboard)</li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1 text-sm text-gray-700 font-medium dark:text-gray-300">
                Playback
              </h3>
              <ul class="list-disc pl-4 space-y-0.5">
                <li><b>Step</b> executes one statement at a time</li>
                <li><b>Run</b> plays through continuously at the selected speed</li>
                <li><b>Pause</b> stops continuous playback</li>
                <li><b>Reset</b> clears execution state and returns to editing</li>
                <li>Adjust the speed slider to control playback pace</li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1 text-sm text-gray-700 font-medium dark:text-gray-300">
                Memory Map
              </h3>
              <ul class="list-disc pl-4 space-y-0.5">
                <li>Stack and heap are shown side by side</li>
                <li>
                  Left border color indicates current statement involvement:
                  <b class="text-blue-500">blue</b> = write target,
                  <b class="text-green-500">green</b> = read source
                </li>
                <li>Click any cell to open its detail panel</li>
                <li>Hover a cell to cross-highlight in the DS view</li>
                <li>Hover a variable name to highlight its declaration in the editor</li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1 text-sm text-gray-700 font-medium dark:text-gray-300">
                Data Structure View
              </h3>
              <ul class="list-disc pl-4 space-y-0.5">
                <li>Structs and variables are visualized as draggable cards</li>
                <li>Arrows show pointer connections between structs</li>
                <li><b>Drag</b> any item to rearrange the layout</li>
                <li><b>Scroll</b> (wheel) to pan the canvas</li>
                <li><b>Auto-layout</b> button resets all positions</li>
                <li>Click an item to open its detail panel</li>
                <li>
                  Background tint shows current-statement involvement
                  (<span class="text-blue-500">blue</span> = LHS,
                  <span class="text-green-500">green</span> = RHS)
                </li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1 text-sm text-gray-700 font-medium dark:text-gray-300">
                Annotations
              </h3>
              <p>Add JSDoc comments before struct fields or struct definitions to customize arrow rendering:</p>
              <pre class="mt-1 rounded bg-gray-100 p-2 text-[10px] font-mono dark:bg-gray-800"><code>/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /** @arrow-position right
    * @arrow-color #4ade80
    * @arrow-style horizontal
    * @arrow-fallback-style orthogonal */
  ListNode *next;
};</code></pre>
              <ul class="mt-1.5 list-disc pl-4 space-y-0.5">
                <li><b>@arrow-position</b> right | left | dynamic</li>
                <li><b>@arrow-style</b> bezier | straight | horizontal | orthogonal</li>
                <li><b>@arrow-fallback-style</b> style to use when primary can't connect</li>
                <li><b>@arrow-color</b> any CSS color</li>
                <li><b>@arrow-anchor</b> center | closest (on struct)</li>
                <li><b>@arrow-size</b> gap in px between connected items (on struct)</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
