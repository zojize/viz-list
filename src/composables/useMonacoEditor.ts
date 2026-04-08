import type { Ref } from 'vue'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { useEventListener } from '@vueuse/core'
// @ts-expect-error: no types
import { constrainedEditor } from 'constrained-editor-plugin'
import * as monaco from 'monaco-editor'
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'

export interface UseMonacoEditorOptions {
  container: Ref<HTMLElement | null>
  prefixCode: Ref<string>
  code: Ref<string>
}

export function useMonacoEditor(options: UseMonacoEditorOptions) {
  const { container, prefixCode, code } = options

  const editor = shallowRef<monaco.editor.IStandaloneCodeEditor>()
  const decorations = shallowRef<monaco.editor.IEditorDecorationsCollection>()
  const completeCode = computed(() => prefixCode.value + code.value)

  // ---- Setup ----

  onMounted(() => {
    const editorInstance = monaco.editor.create(container.value!, {
      value: completeCode.value,
      automaticLayout: true,
      language: 'cpp',
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      padding: { top: 8 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'gutter',
    })
    editor.value = editorInstance
    decorations.value = editorInstance.createDecorationsCollection()

    const model = editorInstance.getModel()!
    const constrained = constrainedEditor(monaco)
    constrained.initializeIn(editorInstance)
    const prefixLines = prefixCode.value.split('\n')
    const codeLines = code.value.split('\n')
    const constrainedModel = constrained.addRestrictionsTo(model, [{
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

  // Update constrained ranges when prefix changes (singly ↔ doubly)
  watch(prefixCode, (pfx) => {
    if (!editor.value)
      return
    const prefixLines = pfx.split('\n')
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

  // ---- Highlighting ----

  function highlightRange(startRow: number, startCol: number, endRow: number, endCol: number, className: string, hoverMessage?: string) {
    decorations.value?.clear()
    decorations.value?.append([{
      range: new monaco.Range(startRow, startCol, endRow, endCol),
      options: {
        isWholeLine: false,
        className,
        ...(hoverMessage ? { hoverMessage: { value: hoverMessage } } : {}),
      },
    }])
  }

  function clearHighlight() {
    decorations.value?.clear()
  }

  // ---- Auto-scroll to function when entering a new scope ----

  let lastFunctionLine: number | undefined

  function highlightCurrentNode(node: SyntaxNode | undefined) {
    if (!node || !editor.value)
      return

    const { startPosition, endPosition } = node
    highlightRange(
      startPosition.row + 1,
      startPosition.column + 1,
      endPosition.row + 1,
      endPosition.column + 1,
      'bg-yellow-500 bg-op-20',
    )

    // Find the enclosing function definition
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const funcLine = parent.startPosition.row + 1
        if (lastFunctionLine !== undefined && funcLine !== lastFunctionLine) {
          // Entered a different function — scroll to it
          editor.value.revealLineInCenter(funcLine)
        }
        lastFunctionLine = funcLine
        break
      }
      parent = parent.parent
    }
  }

  function highlightError(node: SyntaxNode, message: string) {
    const { startPosition, endPosition } = node
    highlightRange(
      startPosition.row + 1,
      startPosition.column + 1,
      endPosition.row + 1,
      endPosition.column + 1,
      'bg-red-500 bg-op-20',
      message,
    )
  }

  function resetTracking() {
    lastFunctionLine = undefined
  }

  function setReadOnly(readOnly: boolean) {
    editor.value?.updateOptions({ readOnly })
  }

  function setTemplateCode(templateCode: string) {
    const model = editor.value?.getModel() as any
    if (model)
      model.updateValueInEditableRanges({ code: templateCode })
  }

  return {
    editor: editor as Readonly<typeof editor>,
    completeCode,
    highlightCurrentNode,
    highlightError,
    clearHighlight,
    resetTracking,
    setReadOnly,
    setTemplateCode,
  }
}
