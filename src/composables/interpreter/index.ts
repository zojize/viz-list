import type { MaybeRefOrGetter } from 'vue'
import type { Tree } from 'web-tree-sitter'
import { markRaw, reactive, readonly, ref, toValue } from 'vue'
import { processDeclaration } from './declarations'
import { evaluate } from './evaluate'
import { asserts, getGeneratorReturn } from './helpers'
import { createAddressSpace } from './memory'

export type { MemoryManager } from './memory'
export { NULL_ADDRESS } from './types'
export type { AddressSpace, CppType, CppValue, InterpreterContext, MemoryCell, MemoryRegion } from './types'
export { InterpreterError, NullPointerError, UnsupportedError, UseAfterFreeError } from './types'

const positionRe = /@position\s+(right|left|dynamic)/
const colorRe = /@color\s+([^\s*]+)/
const styleRe = /@style\s+(bezier|straight|horizontal|orthogonal)/

/** Extract all `@tag value` pairs from a comment string */
function parseFieldAnnotations(comment: string): import('./types').FieldMeta | null {
  const meta: Partial<import('./types').FieldMeta> = {}
  let found = false

  const posMatch = comment.match(positionRe)
  if (posMatch) {
    meta.direction = posMatch[1] as import('./types').FieldDirection
    found = true
  }

  const colorMatch = comment.match(colorRe)
  if (colorMatch) {
    meta.color = colorMatch[1]
    found = true
  }

  const styleMatch = comment.match(styleRe)
  if (styleMatch) {
    meta.style = styleMatch[1] as import('./types').ArrowStyle
    found = true
  }

  if (!found)
    return null
  return { direction: meta.direction ?? 'right', ...meta.color && { color: meta.color }, ...meta.style && { style: meta.style } }
}

export function useCppInterpreter(tree: MaybeRefOrGetter<Tree | void>) {
  const mem = createAddressSpace()

  const context = reactive({
    structs: {} as Record<string, Record<string, import('./types').CppType>>,
    structFieldMeta: {} as Record<string, Record<string, import('./types').FieldMeta>>,
    functions: {} as Record<string, import('./types').FunctionDef>,
    globalEnv: {} as Record<string, import('./types').EnvEntry>,
    envStack: [] as Record<string, import('./types').EnvEntry>[],
    callStack: [] as { env: Record<string, import('./types').EnvEntry>[] }[],
    memory: mem.space,
    currentNode: undefined as import('web-tree-sitter').Node | undefined,
  })

  let gen: Generator | undefined

  const isActive = ref(false)

  return {
    context: readonly(context) as Readonly<typeof context>,
    init,
    step,
    reset,
    isActive: readonly(isActive),
  }

  function reset() {
    context.structs = {}
    context.structFieldMeta = {}
    context.functions = {}
    context.globalEnv = {}
    context.envStack = []
    context.callStack = []
    context.currentNode = undefined
    mem.reset()
    context.memory = { ...mem.space }
    gen = undefined
    isActive.value = false
  }

  function init() {
    const t = toValue(tree)
    asserts(t)

    const { rootNode } = t
    asserts(rootNode)

    reset()
    isActive.value = true

    for (const node of rootNode.namedChildren) {
      switch (node.type) {
        case 'struct_specifier': {
          const name = node.childForFieldName('name')!.text
          const fields: Record<string, import('./types').CppType> = {}
          const fieldMeta: Record<string, import('./types').FieldMeta> = {}

          for (const field of node.childForFieldName('body')!.namedChildren) {
            if (field.type !== 'field_declaration')
              continue
            const { type, name: fieldName } = getGeneratorReturn(processDeclaration(
              field.childForFieldName('type')!,
              field.childForFieldName('declarator')!,
              context,
              mem,
            ))
            fields[fieldName] = type

            // Walk backwards from this field to find a preceding comment with annotations
            let prev = field.previousSibling
            while (prev) {
              if (prev.type === 'comment') {
                const parsed = parseFieldAnnotations(prev.text)
                if (parsed)
                  fieldMeta[fieldName] = parsed
                break
              }
              if (prev.type === 'field_declaration')
                break
              prev = prev.previousSibling
            }
          }
          context.structs[name] = fields
          context.structFieldMeta[name] = fieldMeta
          break
        }
        case 'function_definition': {
          const { type: returnType, name, params } = getGeneratorReturn(processDeclaration(
            node.childForFieldName('type')!,
            node.childForFieldName('declarator')!,
            context,
            mem,
          ))
          const body = node.childForFieldName('body')!

          context.functions[name] = {
            returnType,
            params: params!,
            body: markRaw(body),
          }
          break
        }
        case 'declaration': {
          const typeNode = node.childForFieldName('type')!
          const declarators = node.namedChildren.filter(c => c.id !== typeNode.id)
          for (const declarator of declarators) {
            const { type, name, value } = getGeneratorReturn(processDeclaration(
              typeNode,
              declarator,
              context,
              mem,
            ))
            let address: number
            if (typeof value === 'object' && (value.type === 'struct' || value.type === 'array')) {
              address = value.base
            }
            else {
              address = mem.alloc(type, value!, 'global')
            }
            context.globalEnv[name] = { type, address }
          }
          break
        }
        case 'comment':
          break
        default:
          throw new Error(`Unsupported node type: ${node.type}`)
      }
    }

    asserts('main' in context.functions)
    gen = evaluate(context.functions.main.body, context, mem)
    context.callStack.push({ env: [] })
    // Trigger reactivity for memory allocated during init
    mem.space.version++
    context.memory = { ...mem.space }
  }

  function step() {
    asserts(gen)
    try {
      const done = !!gen.next().done
      // Trigger Vue reactivity for memory mutations (the raw Map was mutated
      // by the interpreter, bypassing Vue's reactive proxy)
      mem.space.version++
      context.memory = { ...mem.space }
      if (done)
        isActive.value = false
      return done
    }
    catch (e) {
      isActive.value = false
      throw e
    }
  }
}
