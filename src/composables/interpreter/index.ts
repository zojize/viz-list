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

export function useCppInterpreter(tree: MaybeRefOrGetter<Tree | void>) {
  const mem = createAddressSpace()

  const context = reactive({
    structs: {} as Record<string, Record<string, import('./types').CppType>>,
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
    context.functions = {}
    context.globalEnv = {}
    context.envStack = []
    context.callStack = []
    context.currentNode = undefined
    mem.reset()
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
          for (const field of node.childForFieldName('body')!.namedChildren) {
            const { type, name } = getGeneratorReturn(processDeclaration(
              field.childForFieldName('type')!,
              field.childForFieldName('declarator')!,
              context,
              mem,
            ))
            fields[name] = type
          }
          context.structs[name] = fields
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
          const { type, name, value } = getGeneratorReturn(processDeclaration(
            node.childForFieldName('type')!,
            node.childForFieldName('declarator')!,
            context,
            mem,
          ))
          const address = mem.alloc(type, value!, 'global')
          context.globalEnv[name] = { type, address }
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
  }

  function step() {
    asserts(gen)
    try {
      const done = !!gen.next().done
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
