<script setup lang="ts">
import type { CppValue } from '~/composables/useCppInterpreter'
import { useHead } from '@unhead/vue'
import { useEventListener, useIntervalFn, useLocalStorage } from '@vueuse/core'
// @ts-expect-error: no types
import { constrainedEditor } from 'constrained-editor-plugin'
import cytoscape from 'cytoscape'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import * as monaco from 'monaco-editor'
import Parser from 'web-tree-sitter'
import { getObjectId } from '~/composables/getObjectId'
import { NULL, useCppInterpreter } from '~/composables/useCppInterpreter'

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

const templates = Object.fromEntries(Object.entries(
  import.meta.glob('~/templates/*.cpp', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
).map(([path, code]) => [path.match(/([^/]+)\.cpp$/)![1], code] as [string, string]))
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
      codeLines[codeLines.length - 1].length + 1,
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
      codeLines[codeLines.length - 1].length + 1,
    ],
    allowMultiline: true,
    label: 'code',
  }])
  code.value = model.getValueInEditableRanges().code
})

onUnmounted(() => editor.value?.dispose())
useEventListener('resize', () => editor.value?.layout({} as any))

const parser = shallowRef<Parser>(undefined!)
const cpp = shallowRef<Parser.Language>()
Parser.init().then(() => {
  return Parser.Language.load('tree-sitter-cpp.wasm')
}).then((language) => {
  const parser_ = new Parser()
  parser_.setLanguage(language)
  cpp.value = language
  parser.value = parser_
})

const tree = computed(() => {
  // TODO: use tree.edit after first parse
  return markRaw(parser.value.parse(completeCode.value))
})

const { init, step, reset, context, isActive } = useCppInterpreter(tree)

interface ListNodeType {
  type: 'struct'
  name: 'Node'
  fields: {
    data: { value: number }
    next: { value: CppValue }
    prev?: { value: CppValue }
  }
}

interface ListNodePtrType {
  type: 'pointer'
  ref: {
    value: ListNodeType
    dead?: boolean
  }
}

function isListNode(node: CppValue | void): node is ListNodeType {
  return !!node && typeof node === 'object'
    && node.type === 'struct'
    && node.name === 'Node'
}

function isListNodePtr(node: CppValue | void): node is ListNodePtrType {
  return !!node && typeof node === 'object'
    && node.type === 'pointer'
    && node.ref !== NULL
    && typeof node.ref.value === 'object'
    && node.ref.value.type === 'struct'
    && node.ref.value.name === 'Node'
}

function isNullPtr(node: CppValue | void): node is {
  type: 'pointer'
  ref: typeof NULL
} {
  return !!node && typeof node === 'object'
    && node.type === 'pointer'
    && node.ref === NULL
}

const linkedLists = ref<{
  type: 'struct'
  name: 'LinkedList'
  fields: {
    head: { value: CppValue }
    tail?: { value: CppValue }
  }
}[]>([])

watch(
  () => context.store,
  () => linkedLists.value = context.store
    .filter(({ type }) => typeof type === 'object' && type.type === 'struct' && type.name === 'LinkedList')
    .map(({ value }) => toRaw(value) as typeof linkedLists.value[number]),
  // computed don't have deep watch...
  { deep: true },
)

const linkedListNodes = computed(() => {
  const dupes = new Set<string>()
  const lists = linkedLists.value
    .map(({ fields }) => fields)
    .map(({ head, tail }) => {
      const nodes: (ListNodePtrType | null)[] = []
      if (tail)
        nodes.push(null)

      let node = head.value
      // assume null if node is not a ListNode
      while (isListNodePtr(node)) {
        nodes.push(node)
        node = node.ref.value.fields.next.value
      }
      nodes.push(null)
      return nodes
    })
    .map((nodes, row) => nodes.flatMap((node, col) => {
      const id = node ? getObjectId(node.ref.value) : `null${row}-${col ? 'tail' : 'head'}`
      if (dupes.has(id))
        return []
      dupes.add(id)
      return [{
        data: {
          node: node?.ref.value,
          id,
          label: `${node?.ref.value.fields.data.value ?? 'NULL'}`,
          row,
          col,
        },
      }]
    }))

  // const free = []
  const free = context.store
    .filter(o => !o.dead && isListNode(o.value) && !dupes.has(getObjectId(o.value)))
    .map(({ value }, col) => ({
      data: {
        node: value as ListNodeType,
        id: getObjectId(value as ListNodeType),
        label: `${(value as ListNodeType).fields.data.value}`,
        row: lists.length,
        col: col + 1,
      },
    }))

  return {
    lists,
    free: free.length
      ? [{
          data: {
            node: undefined,
            id: `null${lists.length}-head`,
            label: 'NULL',
            row: lists.length,
            col: 0,
          },
        }, ...free, {
          data: {
            node: undefined,
            id: `null${lists.length}-tail`,
            label: 'NULL',
            row: lists.length,
            col: free.length + 1,
          },
        }]
      : [],
  }
})

const linkedListEdges = computed(() =>
  linkedListNodes.value
    .lists
    .concat([linkedListNodes.value.free])
    .map((nodes, row) => nodes
      .flatMap((node) => {
        const next = node.data.node?.fields.next.value
        const prev = node.data.node?.fields.prev?.value
        return [
          ...(isListNodePtr(next) || isNullPtr(next))
            ? [{
                data: {
                  source: node.data.id,
                  target: isNullPtr(next)
                    ? `null${row}-tail`
                    : getObjectId(next.ref.value),
                  type: 'next',
                },
              }]
            : [],
          ...(isListNodePtr(prev) || isNullPtr(prev))
            ? [{
                data: {
                  source: node.data.id,
                  target: isNullPtr(prev)
                    ? `null${row}-head`
                    : getObjectId(prev.ref.value),
                  type: 'prev',
                },
              }]
            : [],
        ]
      }))
    .flat(),
)

const cyContainer = useTemplateRef('cy-container')
const cy = shallowRef<cytoscape.Core>()
const style = {
  light: [
    {
      selector: 'node',
      style: {
        'background-opacity': 0,
        'border-color': '#666',
        'border-width': 2,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'color': '#000',
        'font-size': '12px',
        'shape': 'round-rectangle',
      },
    },
    {
      selector: 'node[id^="null"]',
      style: {
        'border-width': 0,
        'color': '#ff0000',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 3,
        'line-color': '#ccc',
        'target-arrow-color': '#ccc',
        'target-arrow-shape': 'triangle',
        'curve-style': 'unbundled-bezier',
      },
    },
    {
      selector: 'edge[type="next"]',
      style: {
        'line-color': '#4caf50',
        'target-arrow-color': '#4caf50',
      },
    },
    {
      selector: 'edge[type="prev"]',
      style: {
        'line-color': '#ff9800',
        'target-arrow-color': '#ff9800',
      },
    },
  ],
  dark: [
    {
      selector: 'node',
      style: {
        'background-opacity': 0,
        'border-color': '#888',
        'border-width': 2,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'color': '#fff',
        'font-size': '12px',
        'shape': 'round-rectangle',
      },
    },
    {
      selector: 'node[id^="null"]',
      style: {
        'border-width': 0,
        'color': '#ff0000',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 3,
        'line-color': '#888',
        'target-arrow-color': '#888',
        'target-arrow-shape': 'triangle',
        'curve-style': 'unbundled-bezier',
      },
    },
    {
      selector: 'edge[type="next"]',
      style: {
        'line-color': '#4caf50',
        'target-arrow-color': '#4caf50',
      },
    },
    {
      selector: 'edge[type="prev"]',
      style: {
        'line-color': '#ff9800',
        'target-arrow-color': '#ff9800',
      },
    },
  ],
} satisfies Record<string, cytoscape.Stylesheet[]>

onMounted(() => {
  cy.value = cytoscape({
    container: cyContainer.value!,
    maxZoom: 2,
    minZoom: 0.5,
    autoungrabify: true,
    // TODO: highlight variable on select
    autounselectify: true,
  })
})

watchEffect(() => {
  if (!cy.value)
    return
  cy.value.style(style[dark.value ? 'dark' : 'light'])
})

watchEffect(() => {
  if (!cy.value)
    return
  cy.value.elements().remove()
  const elems = ([
    ...Array.from(linkedListNodes.value.lists.flat()),
    ...Array.from(linkedListNodes.value.free),
    ...Array.from(linkedListEdges.value),
  ])
  // console.log(elems, linkedListNodes.value)
  cy.value.add(elems)
  cy.value.layout({
    name: 'grid',
    fit: true,
    padding: 30,
    nodeDimensionsIncludeLabels: true,
    position(node) {
      return {
        row: node.data('row'),
        col: node.data('col'),
      }
    },
    avoidOverlap: true,
    avoidOverlapPadding: 15,
    spacingFactor: 0.5,
  }).run()
})

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
  clipBoardIconUrl.value = `url("data:image/svg+xml,%3C!-- ${+new Date()} --%3E${clipboardIcon}")`
  setTimeout(() => playingShareAnimation.value = false, 2000)
}

function handleReset() {
  decorations.value?.clear()
  pause()
  reset()
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
    const done = step()
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
    <div class="relative flex-1">
      <h2 class="absolute left-2 top-2 text-lg font-bold">
        Linked Lists
      </h2>
      <h2 class="absolute right-2 top-2 text-lg font-bold">
        <pre class="text-[#4caf50]">->next</pre>
        <pre class="text-[#ff9800]">->prev</pre>
      </h2>
      <div v-if="linkedListNodes.lists.length === 0" class="absolute inset-0 flex items-center justify-center">
        Nothing to see here yet...
      </div>
      <div ref="cy-container" class="h-full w-full" />
    </div>
  </div>
</template>
