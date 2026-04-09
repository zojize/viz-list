import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { MemoryManager } from './memory'
import type { CppType, CppValue, InterpreterContext } from './types'
import { asserts, castIfNull, checksDefined, getGeneratorReturn } from './helpers'
import { NULL_ADDRESS } from './types'

// Circular dependency resolution: evaluate.ts calls processDeclaration,
// and initializeValue needs to call evaluate for initializer expressions.
// We break the cycle with a late-bound function reference.
let _evaluate: ((
  node: SyntaxNode,
  context: InterpreterContext,
  mem: MemoryManager,
) => Generator<void, CppValue | null | undefined>) | undefined

export function setEvaluate(fn: typeof _evaluate) {
  _evaluate = fn
}

export function* processDeclaration(
  type: SyntaxNode,
  declarator: SyntaxNode,
  context: InterpreterContext,
  mem: MemoryManager,
): Generator<void, {
  type: CppType
  name: string
  params?: { type: CppType, name: string }[]
  value?: CppValue
}> {
  asserts(['type_identifier', 'primitive_type'].includes(type.type))
  asserts([
    'identifier',
    'field_identifier',
    'pointer_declarator',
    'array_declarator',
    'function_declarator',
    'init_declarator',
  ].includes(declarator.type))

  const baseType: CppType = type.type === 'primitive_type'
    ? type.text as CppType
    : { type: 'struct', name: type.text }

  return yield* helper(baseType, declarator)

  function* helper(baseType: CppType, declarator: SyntaxNode): Generator<void, {
    type: CppType
    name: string
    params?: { type: CppType, name: string }[]
    value?: CppValue
  }> {
    switch (declarator.type) {
      case 'identifier':
      case 'field_identifier':
        return {
          type: baseType,
          name: declarator.text,
          value: (yield* initializeValue(baseType, context, mem))!,
        }
      case 'function_declarator':
        return {
          type: baseType,
          name: declarator.childForFieldName('declarator')!.text,
          params: declarator
            .childForFieldName('parameters')!
            .namedChildren
            .map((param: SyntaxNode) => getGeneratorReturn(processDeclaration(
              param.childForFieldName('type')!,
              param.childForFieldName('declarator')!,
              context,
              mem,
            ))),
        }
      case 'init_declarator': {
        const { type, ...rest } = yield* helper(baseType, declarator.childForFieldName('declarator')!)
        return {
          type,
          ...rest,
          value: castIfNull(type, yield* initializeValue(type, context, mem, declarator.childForFieldName('value')!)),
        }
      }
      case 'pointer_declarator':
        return yield* helper(
          { type: 'pointer', to: baseType },
          declarator.childForFieldName('declarator')!,
        )
      case 'array_declarator':
        return yield* helper(
          {
            type: 'array',
            of: baseType,
            size: Number(declarator.childForFieldName('size')!.text),
          },
          declarator.childForFieldName('declarator')!,
        )
      default:
        throw new Error(`Unsupported declarator type: ${declarator.type}`)
    }
  }
}

export function* initializeValue(
  type: CppType,
  context: InterpreterContext,
  mem: MemoryManager,
  initializer?: SyntaxNode,
): Generator<void, CppValue> {
  if (!initializer) {
    switch (type) {
      case 'int':
      case 'float':
      case 'double':
      case 'char':
        return 0
      case 'bool':
        return false
      case 'void':
        throw new Error('Cannot initialize void type')
      default:
        switch (type.type) {
          case 'pointer':
            return { type: 'pointer', address: NULL_ADDRESS }
          case 'array': {
            const base = mem.allocArray(type.of, type.size, 'stack')
            // For nested arrays/structs, allocate each element properly
            if (typeof type.of === 'object') {
              for (let i = 0; i < type.size; i++) {
                const elemAddr = base + 1 + i
                const elemValue = yield* initializeValue(type.of, context, mem)
                mem.write(elemAddr, elemValue)
              }
            }
            return { type: 'array', base, length: type.size }
          }
          case 'struct': {
            asserts(type.name in context.structs, `Struct ${type.name} not found`)
            const base = mem.allocStruct(type.name, context.structs[type.name], 'stack')
            return { type: 'struct', name: type.name, base }
          }
        }
    }
  }

  asserts(initializer.type !== 'initializer_list', 'Unsupported: initializer_list')
  asserts(_evaluate, 'evaluate function not registered — call setEvaluate() first')
  return castIfNull(type, checksDefined(yield* _evaluate(initializer, context, mem)))
}
