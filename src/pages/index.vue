<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { Language, Parser } from 'web-tree-sitter'
import { useCppInterpreter } from '~/composables/useCppInterpreter'
import { useMemoryDiff } from '~/composables/useMemoryDiff'
import { useMonacoEditor } from '~/composables/useMonacoEditor'
import { useStatementAddresses } from '~/composables/useStatementAddresses'

useHead({
  title: 'Viz List',
  meta: [{ name: 'description', content: 'Visualize linked list operations' }],
})

const route = useRoute()
const router = useRouter()

// ---- Struct prefix code ----

const doublyCode = `struct Node {
  int data;
  Node *next;
  Node *prev;
};

struct LinkedList {
  Node *head;
  Node *tail;
};\n\n`

const singlyCode = `struct Node {
  int data;
  Node *next;
};

struct LinkedList {
  Node *head;
};\n\n`

// ---- Templates (singly/doubly variants) ----

const templateFileRe = /([^/]+)\.cpp$/

const singlyTemplates = Object.fromEntries(Object.entries(
  import.meta.glob('~/templates/singly/*.cpp', { eager: true, import: 'default', query: '?raw' }),
).map(([path, code]) => [path.match(templateFileRe)![1], code] as [string, string]))

const doublyTemplates = Object.fromEntries(Object.entries(
  import.meta.glob('~/templates/doubly/*.cpp', { eager: true, import: 'default', query: '?raw' }),
).map(([path, code]) => [path.match(templateFileRe)![1], code] as [string, string]))

const isDoubly = useLocalStorage('is-doubly', true)
if (route.query.doubly)
  isDoubly.value = route.query.doubly === 'true'

const templates = computed(() => isDoubly.value ? doublyTemplates : singlyTemplates)
const templateNames = computed(() => Object.keys(templates.value))
const selectedTemplateName = useLocalStorage('selected-template', 'insertBack')

const prefixCode = computed(() => isDoubly.value ? doublyCode : singlyCode)
const code = useLocalStorage('code', templates.value[selectedTemplateName.value] ?? '')
if (route.query.code) {
  const queryCode = route.query.code as string
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
  prefixCode,
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
const { changedAddresses, snapshot, diff } = useMemoryDiff(() => context.memory)
const { lhsAddresses, rhsAddresses } = useStatementAddresses(context, isActive)
const selectedAddress = shallowRef<number | null>(null)
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
  const tmpl = templates.value[name]
  if (tmpl)
    setTemplateCode(tmpl)
})

// When switching singly ↔ doubly, reload the current template
watch(isDoubly, () => {
  pause()
  const tmpl = templates.value[selectedTemplateName.value]
  if (tmpl)
    setTemplateCode(tmpl)
})

const editedWhileActive = shallowRef(false)
watch(code, () => editedWhileActive.value = isActive.value)

// ---- Template picker dropdown ----

const templatePickerOpen = shallowRef(false)

function selectTemplate(name: string) {
  selectedTemplateName.value = name
  templatePickerOpen.value = false
}

// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('[data-testid="template-picker"]'))
    templatePickerOpen.value = false
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))

// ---- Share ----

const playingShareAnimation = shallowRef(false)
const clipboardIcon = '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1em\' height=\'1em\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'none\' stroke=\'currentColor\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\'%3E%3Cpath stroke-dasharray=\'72\' stroke-dashoffset=\'72\' d=\'M12 3h7v18h-14v-18h7Z\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' dur=\'0.6s\' values=\'72;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'12\' stroke-dashoffset=\'12\' stroke-width=\'1\' d=\'M14.5 3.5v3h-5v-3\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.7s\' dur=\'0.2s\' values=\'12;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'10\' stroke-dashoffset=\'10\' d=\'M9 13l2 2l4 -4\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.9s\' dur=\'0.2s\' values=\'10;0\'/%3E%3C/path%3E%3C/g%3E%3C/svg%3E'
const clipBoardIconUrl = shallowRef(`url("data:image/svg+xml,${clipboardIcon}")`)

function saveToUrl() {
  const savedCode = compressToEncodedURIComponent(code.value)
  router.replace({ query: { code: savedCode, doubly: isDoubly.value ? 'true' : 'false' } })
  navigator.clipboard.writeText(window.location.href)
  playingShareAnimation.value = true
  clipBoardIconUrl.value = `url("data:image/svg+xml,%3C!-- ${Date.now()} --%3E${clipboardIcon}")`
  setTimeout(() => playingShareAnimation.value = false, 2000)
}

// ---- Actions ----

function handleReset() {
  clearHighlight()
  pause()
  reset()
  resetTracking()
  selectedAddress.value = null
  executionError.value = null
}

function handleRun() {
  editedWhileActive.value = false
  executionError.value = null
  selectedAddress.value = null
  resume()
}

function handlePause() {
  pause()
}

function runStep() {
  try {
    snapshot()
    const done = step()
    diff()
    if (done)
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
  if (!isActive.value || editedWhileActive.value) {
    editedWhileActive.value = false
    init()
    runStep()
  }
  else {
    runStep()
  }
}

const speedLabel = computed(() => {
  const ms = speedMs.value
  if (ms <= 50)
    return 'fast'
  if (ms <= 150)
    return 'med'
  if (ms <= 300)
    return 'slow'
  return 'slower'
})
</script>

<template>
  <div class="h-full w-full flex flex-col gap-0 lg:flex-row lg:gap-1 lg:p-1">
    <!-- Left: Editor + controls -->
    <div class="min-h-0 flex flex-1 flex-col">
      <!-- Controls toolbar -->
      <div class="flex items-center justify-between gap-2 px-2 py-1.5">
        <!-- Left: template picker + doubly toggle -->
        <div class="flex items-center gap-2">
          <!-- Template dropdown -->
          <div data-testid="template-picker" class="relative">
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
                class="absolute left-0 top-full z-20 mt-1 min-w-40 border border-gray-200 rounded-lg bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
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

          <!-- Doubly toggle -->
          <label data-testid="checkbox-doubly" class="flex cursor-pointer select-none items-center gap-1.5">
            <div
              class="h-4 w-7 rounded-full p-0.5 transition-colors duration-150"
              :class="isDoubly ? 'bg-vitesse' : 'bg-gray-300 dark:bg-gray-600'"
              @click="isDoubly = !isDoubly"
            >
              <div
                class="h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150"
                :class="isDoubly ? 'translate-x-3' : 'translate-x-0'"
              />
            </div>
            <span class="text-xs text-gray-500">doubly</span>
          </label>
        </div>

        <!-- Right: playback controls -->
        <div class="flex items-center gap-2">
          <!-- Speed slider -->
          <div class="flex items-center gap-1.5">
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
            <button data-testid="btn-step" class="icon-btn" title="Step" @click="handleStep()">
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

      <!-- Editor -->
      <div ref="monaco-container" class="min-h-0 flex-1" />

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

    <!-- Right: Visualization -->
    <div data-testid="viz-panel" class="min-h-0 flex flex-1 flex-col gap-1">
      <div class="min-h-0 flex-[3] overflow-hidden panel-border">
        <MemoryMap
          :context="context"
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
      <div class="min-h-0 flex-[2] overflow-hidden panel-border">
        <DetailPanel
          :context="context"
          :selected-address="selectedAddress"
          :changed-addresses="changedAddresses"
          :simulating="running"
          :highlighted-address="hoveredNodeAddress"
          @navigate="selectedAddress = $event"
          @clear-selection="selectedAddress = null"
          @hover-node="hoveredNodeAddress = $event"
          @hover-field="hoveredFieldAddress = $event"
        />
      </div>
    </div>
  </div>
</template>
