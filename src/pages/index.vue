<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener, useIntervalFn, useLocalStorage } from '@vueuse/core'
// @ts-expect-error: no types
import { constrainedEditor } from 'constrained-editor-plugin'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import * as monaco from 'monaco-editor'
import { Language, Parser } from 'web-tree-sitter'
import { useCppInterpreter } from '~/composables/useCppInterpreter'
import { useMemoryDiff } from '~/composables/useMemoryDiff'

useHead({
  title: 'Viz List',
  meta: [
    { name: 'description', content: 'Visualize linked list operations' },
  ],
})

const route = useRoute()
const router = useRouter()

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

const templateFileNameRe = /([^/]+)\.cpp$/
const templates = Object.fromEntries(Object.entries(
  import.meta.glob('~/templates/*.cpp', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
).map(([path, code]) => [path.match(templateFileNameRe)![1], code] as [string, string]))
const selectedTemplateName = useLocalStorage('selected-template', Object.keys(templates)[0])
const isDoubly = useLocalStorage('is-doubly', true)
if (route.query.doubly) {
  isDoubly.value = route.query.doubly === 'true'
}
const prefixCode = computed(() => isDoubly.value ? doublyCode : singlyCode)
const code = useLocalStorage('code', templates[selectedTemplateName.value])
if (route.query.code) {
  const queryCode = route.query.code as string
  let userCode = decompressFromEncodedURIComponent(queryCode)
  if (!userCode) {
    userCode = decompressFromEncodedURIComponent(decodeURIComponent(queryCode))
  }
  code.value = userCode
}
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor>()
const monacoContainer = useTemplateRef('monaco-container')
const completeCode = computed(() => prefixCode.value + code.value)
const decorations = shallowRef<monaco.editor.IEditorDecorationsCollection>()

onMounted(() => {
  const editorInstance = monaco.editor.create(monacoContainer.value!, {
    value: completeCode.value,
    automaticLayout: true,
    language: 'cpp',
    minimap: {
      enabled: false,
    },
  })
  editor.value = editorInstance
  decorations.value = editorInstance.createDecorationsCollection()

  const model = editorInstance.getModel()!
  const constrainedInstance = constrainedEditor(monaco)
  constrainedInstance.initializeIn(editorInstance)
  // console.log(restrictedCode.ranges)
  const prefixLines = prefixCode.value.split('\n')
  const codeLines = code.value.split('\n')
  const constrainedModel = constrainedInstance.addRestrictionsTo(model, [{
    range: [
      prefixLines.length,
      1,
      prefixLines.length + codeLines.length - 1,
      codeLines.at(-1)!.length + 1,
    ],
    allowMultiline: true,
    label: 'code',
  }])

  model.onDidChangeContent(() => {
    decorations.value?.clear()
    code.value = constrainedModel.getValueInEditableRanges().code
  })
})

watch(prefixCode, (prefixCode) => {
  if (!editor.value)
    return

  const prefixLines = prefixCode.split('\n')
  const codeLines = code.value.split('\n')
  const model = editor.value.getModel() as any
  model.updateRestrictions([])
  editor.value.setValue(completeCode.value)
  model.updateRestrictions([{
    range: [
      prefixLines.length,
      1,
      prefixLines.length + codeLines.length - 1,
      codeLines.at(-1)!.length + 1,
    ],
    allowMultiline: true,
    label: 'code',
  }])
  code.value = model.getValueInEditableRanges().code
})

onUnmounted(() => editor.value?.dispose())
useEventListener('resize', () => editor.value?.layout({} as any))

const parser = shallowRef<Parser>(undefined!)
const cpp = shallowRef<Language>()
Parser.init().then(() => {
  return Language.load('tree-sitter-cpp.wasm')
}).then((language) => {
  const parser_ = new Parser()
  parser_.setLanguage(language)
  cpp.value = language
  parser.value = parser_
})

const tree = computed(() => {
  if (!parser.value)
    return undefined
  // TODO: use tree.edit after first parse
  const result = parser.value.parse(completeCode.value)
  return result ? markRaw(result) : undefined
})

const { init, step, reset, context, isActive } = useCppInterpreter(tree)

const { changedAddresses, snapshot, diff } = useMemoryDiff(() => context.memory)
const selectedAddress = ref<number | null>(null)
const hoveredNodeAddress = shallowRef<number | null>(null)
const hoveredFieldAddress = shallowRef<number | null>(null)

watch(() => context.currentNode, (node) => {
  if (!node || !isActive.value)
    return

  decorations.value?.clear()

  const { startPosition, endPosition } = node
  const range = new monaco.Range(
    startPosition.row + 1,
    startPosition.column + 1,
    endPosition.row + 1,
    endPosition.column + 1,
  )

  decorations.value?.append([{
    range,
    options: {
      isWholeLine: false,
      className: 'bg-yellow-500 bg-op-20',
    },
  }])
})

// TODO: add slider for simulation speed
const { resume, pause, isActive: running } = useIntervalFn(handleStep, 200, { immediate: false, immediateCallback: true })
watch(running, running => editor.value?.updateOptions({ readOnly: running }))

watch(selectedTemplateName, (selectedTemplate) => {
  pause()
  if (!templates[selectedTemplate])
    return
  const model = editor.value?.getModel() as any
  if (model)
    model.updateValueInEditableRanges({ code: templates[selectedTemplate] })
})

const editedWhileActive = ref(false)
watch(code, () => editedWhileActive.value = isActive.value)

const playingShareAnimation = ref(false)
const clipboardIcon = '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1em\' height=\'1em\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'none\' stroke=\'currentColor\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\'%3E%3Cpath stroke-dasharray=\'72\' stroke-dashoffset=\'72\' d=\'M12 3h7v18h-14v-18h7Z\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' dur=\'0.6s\' values=\'72;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'12\' stroke-dashoffset=\'12\' stroke-width=\'1\' d=\'M14.5 3.5v3h-5v-3\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.7s\' dur=\'0.2s\' values=\'12;0\'/%3E%3C/path%3E%3Cpath stroke-dasharray=\'10\' stroke-dashoffset=\'10\' d=\'M9 13l2 2l4 -4\'%3E%3Canimate fill=\'freeze\' attributeName=\'stroke-dashoffset\' begin=\'0.9s\' dur=\'0.2s\' values=\'10;0\'/%3E%3C/path%3E%3C/g%3E%3C/svg%3E'
const clipBoardIconUrl = ref(`url("data:image/svg+xml,${clipboardIcon}")`)
function saveToUrl() {
  const savedCode = compressToEncodedURIComponent(code.value)
  const doubly = isDoubly.value ? 'true' : 'false'
  router.replace({
    query: {
      code: savedCode,
      doubly,
    },
  })

  navigator.clipboard.writeText(window.location.href)
  playingShareAnimation.value = true
  // this is so stupid...
  // https://stackoverflow.com/a/78483208/14835397
  clipBoardIconUrl.value = `url("data:image/svg+xml,%3C!-- ${Date.now()} --%3E${clipboardIcon}")`
  setTimeout(() => playingShareAnimation.value = false, 2000)
}

function handleReset() {
  decorations.value?.clear()
  pause()
  reset()
  selectedAddress.value = null
}

function handleRun() {
  editedWhileActive.value = false
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
    if (done) {
      pause()
    }
  }
  catch (e) {
    console.error(e, context.currentNode)
    if (context.currentNode) {
      const { startPosition, endPosition } = context.currentNode
      decorations.value?.clear()
      const range = new monaco.Range(
        startPosition.row + 1,
        startPosition.column + 1,
        endPosition.row + 1,
        endPosition.column + 1,
      )
      decorations.value?.append([{
        range,
        options: {
          className: 'bg-red-500 bg-op-20',
          isWholeLine: false,
          hoverMessage: {
            value: (e as Error).message || 'Error',
          },
        },
      }])
    }
    pause()
  }
}

function handleStep() {
  if (!isActive.value || editedWhileActive.value) {
    editedWhileActive.value = false
    init()
    runStep()
  }
  else {
    runStep()
  }
}
</script>

<template>
  <div class="h-full w-full flex flex-row gap-2">
    <!-- Left: Editor -->
    <div class="flex flex-1 flex-col">
      <div class="mb-2 ml-4 flex justify-between">
        <div class="flex flex-row items-center gap-2">
          <label class="flex select-none items-center gap-1">
            <input
              v-model="isDoubly"
              type="checkbox"
              class="h-3 w-3 appearance-none border rounded-full bg-gray-200 transition duration-150 ease-in-out checked:bg-green-600 dark:bg-gray-700 focus:outline-none dark:checked:bg-green-400"
            >
            <span class="text-sm text-gray-700 dark:text-gray-300">doubly</span>
          </label>
          <select
            v-model="selectedTemplateName"
            class="border border-gray-300 rounded-md bg-white p-1 text-gray-700 transition duration-150 ease-in-out dark:border-gray-600 dark:bg-hex-121212 dark:text-gray-300 focus:outline-none"
          >
            <option v-for="(_, name) in templates" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
          <div class="relative">
            <div class="peer i-mdi-help-circle-outline op-75 hover:cursor-help" />
            <p class="absolute z-10 ml-5 mt-[-150%] block w-50 select-none rounded bg-white p-2 text-sm op-0 shadow-lg transition-duration-150 transition-ease-in-out dark:bg-gray-800 peer-hover:op-100">
              The C++ interpreter does not accurately implement the semantics of the C++ language, and its memory model is vastly different from C++ for the sake of simplicity. It supports a subset of the C++ language sufficient for visualizing linked list operations.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button class="i-mdi-share icon-btn" :style="playingShareAnimation && { '--un-icon': clipBoardIconUrl }" title="share" @click="playingShareAnimation || saveToUrl()" />
          <button class="i-mdi-refresh icon-btn" title="reset" @click="handleReset()" />
          <button v-if="running" class="i-mdi-pause icon-btn" title="pause" @click="handlePause()" />
          <button v-else class="i-mdi-play icon-btn" title="run" @click="handleRun()" />
          <button class="i-mdi-step-forward icon-btn" title="step" @click="handleStep()" />
        </div>
      </div>
      <div ref="monaco-container" class="h-full w-full" />
    </div>

    <!-- Right: Visualization -->
    <div class="min-h-0 flex flex-1 flex-col gap-1">
      <!-- Top: Memory Map (60%) -->
      <div class="min-h-0 flex-[3] overflow-hidden border border-gray-200 rounded dark:border-gray-700">
        <MemoryMap
          :context="context"
          :changed-addresses="changedAddresses"
          :highlighted-address="hoveredNodeAddress"
          :highlighted-field-address="hoveredFieldAddress"
          @select-cell="selectedAddress = $event"
        />
      </div>
      <!-- Bottom: Detail Panel (40%) -->
      <div class="min-h-0 flex-[2] overflow-hidden border border-gray-200 rounded dark:border-gray-700">
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
