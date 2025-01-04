import type Parser from 'web-tree-sitter'

// eslint-disable-next-line unused-imports/no-unused-vars
const CppPrimitiveTypes = ['int', 'float', 'double', 'char', 'bool', 'void'] as const
export type CppType
  = (typeof CppPrimitiveTypes)[number]
  | { type: 'pointer', to: CppType }
  | { type: 'array', of: CppType, size: number }
  | { type: 'struct', name: string }

export type CppValue
  = number
  | boolean
  // pointer? reference!
  // TODO: actually implement C memory model
  | { type: 'pointer', ref: { value: CppValue, dead?: boolean } }
  | { type: 'array', items: { value: CppValue }[] }
  | { type: 'struct', name: string, fields: Record<string, { value: CppValue }> }

interface EnvEntry {
  type: CppType
  loc: number
}

interface InterpreterContext {
  structs: Record<string, Record<string, CppType>>
  functions: Record<string, {
    returnType: CppType
    params: { name: string, type: CppType }[]
    body: Parser.SyntaxNode
  }>
  globalEnv: Record<string, EnvEntry>
  envStack: Record<string, EnvEntry>[]
  callStack: { env: Record<string, EnvEntry>[] }[]
  store: {
    type: CppType
    value: CppValue
    dead: boolean
  }[]
  currentNode?: Parser.SyntaxNode
}

export interface UseCppInterpreterReturn {
  init: () => void
  step: () => boolean
  reset: () => void
  isActive: Readonly<Ref<boolean>>
  context: Readonly<InterpreterContext>
}

export const NULL = markRaw(Object.defineProperty({
  type: 'int',
  value: 0,
  dead: true,
} as const, 'value', {
  get() {
    throw new Error('Null pointer dereference')
  },
  enumerable: false,
}))

export function useCppInterpreter(tree: MaybeRefOrGetter<Parser.Tree | void>): UseCppInterpreterReturn {
  const context: InterpreterContext = reactive({
    structs: {},
    functions: {},
    globalEnv: {},
    envStack: [],
    callStack: [],
    store: [NULL],
  })

  let gen: Generator | undefined

  const isActive = ref(false)

  return {
    // @ts-expect-error: typescript being stupid
    context: readonly(context),
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
    context.store = [NULL]
    context.currentNode = undefined
    gen = undefined
    isActive.value = false
  }

  function init() {
    const t = toValue(tree)
    asserts(t)

    const { rootNode } = t
    asserts(rootNode)
    // TODO: check MISSING and ERROR

    reset()
    isActive.value = true

    for (const node of rootNode.namedChildren) {
      switch (node.type) {
        case 'struct_specifier': {
          const name = node.childForFieldName('name')!.text
          const fields: Record<string, CppType> = {}
          for (const field of node.childForFieldName('body')!.namedChildren) {
            const { type, name } = getGeneratorReturn(processDeclaration(
              field.childForFieldName('type')!,
              field.childForFieldName('declarator')!,
              context,
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
          ))
          context.globalEnv[name] = { type, loc: context.store.length }
          context.store.push({
            type,
            value: value!,
            dead: false,
          })
          break
        }
        case 'comment':
          break
        default:
          throw new Error(`Unsupported node type: ${node.type}`)
      }
    }

    asserts('main' in context.functions)
    gen = evaluate(context.functions.main.body, context)
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

function eq(a: CppValue | null, b: CppValue | null): boolean {
  if (a === b)
    return true
  a ??= { type: 'pointer', ref: NULL }
  b ??= { type: 'pointer', ref: NULL }
  if (typeof a === 'object' && a?.type === 'pointer' && typeof b === 'object' && b?.type === 'pointer')
    return a.ref === b.ref
  return false
}

const binaryOps: Record<
  string,
  (a: CppValue | null, b: CppValue | null) => CppValue
> = Object.fromEntries(([
  ['+', (a, b) => +a + +b],
  ['-', (a, b) => +a - +b],
  ['*', (a, b) => +a * +b],
  ['/', (a, b) => +a / +b],
  ['%', (a, b) => +a % +b],
  ['&', (a, b) => +a & +b],
  ['|', (a, b) => +a | +b],
  ['^', (a, b) => +a ^ +b],
  ['<<', (a, b) => +a << +b],
  ['>>', (a, b) => +a >> +b],
  ['<', (a, b) => a < b],
  ['>', (a, b) => a > b],
  ['<=', (a, b) => a <= b],
  ['>=', (a, b) => a >= b],
] satisfies [string, (a: CppValue, b: CppValue) => CppValue][])
  .map(([name, f]) =>
    [name, (a: CppValue | null, b: CppValue | null) => {
      a ??= 0
      b ??= 0
      return f(a, b)
    }])
  .toSpliced(0, 0, ['==', eq], ['!=', (a, b) => !eq(a, b)]),
)

const unaryOps: Record<string, (a: number | boolean) => number | boolean> = {
  '+': a => +a,
  '-': a => -a,
  '~': a => ~a,
  '!': a => !a,
}

function* evaluate(
  node: Parser.SyntaxNode,
  context: InterpreterContext,
): Generator<void, CppValue | null | undefined> {
  function setCurrentNode(node: Parser.SyntaxNode) {
    context.currentNode = markRaw(node)
  }
  setCurrentNode(node)

  switch (node.type) {
    case 'null':
      return null
    case 'true':
      return true
    case 'false':
      return false
    case 'number_literal': {
      const n = Number(node.text)
      asserts(!Number.isNaN(n))
      return n
    }
    case 'identifier':
      return lvalue(node, context)[1].value
    case 'compound_statement': {
      context.envStack.push({})
      let returnValue: CppValue | null = undefined!
      for (const child of node.namedChildren) {
        const ret = yield* evaluate(child, context)
        if (ret !== undefined) {
          returnValue = ret
          break
        }
      }

      for (const { loc } of Object.values(context.envStack.pop()!))
        context.store[loc].dead = true

      const isFunctionBody = node.parent!.type === 'function_definition'
      if (isFunctionBody) {
        context.envStack = context.callStack.pop()!.env
      }

      return returnValue
    }
    case 'return_statement': {
      const expr = node.firstNamedChild
      if (!expr)
        return null
      const returnValue = yield* evaluate(expr!, context)
      setCurrentNode(node)
      yield // pause execution
      return returnValue
    }
    case 'expression_statement': {
      const expr = node.firstNamedChild
      if (expr)
        yield* evaluate(expr, context)
      setCurrentNode(node)
      // console.log(JSON.stringify(context.store, null, 2))
      return yield // pause execution
    }
    case 'binary_expression': {
      const lhs = checksDefined(yield* evaluate(node.childForFieldName('left')!, context))
      const rhs = checksDefined(yield* evaluate(node.childForFieldName('right')!, context))
      const op = node.childForFieldName('operator')!.text
      asserts(op in binaryOps, `Unsupported binary operator: ${op}`)
      return binaryOps[op](lhs, rhs)
    }
    case 'unary_expression': {
      const operand = checksDefined(yield* evaluate(node.childForFieldName('argument')!, context))
      const op = node.childForFieldName('operator')!.text
      asserts(op in unaryOps, `Unsupported unary operator: ${op}`)
      asserts(typeof operand !== 'object')
      return unaryOps[op](operand)
    }
    case 'update_expression': {
      const [_, lval] = lvalue(node.childForFieldName('argument')!, context)
      const isPostfix = node.firstChild!.isNamed
      const op = node.childForFieldName('operator')!.text
      asserts(op === '++' || op === '--')
      asserts(typeof lval.value !== 'object')
      const old = lval.value
      lval.value = binaryOps[op[0]](old, 1)
      return isPostfix ? old : lval.value
    }
    case 'assignment_expression': {
      const op = node.childForFieldName('operator')!.text
      return yield* processAssignment(
        node.childForFieldName('left')!,
        checksDefined(yield* evaluate(node.childForFieldName('right')!, context)),
        op,
        context,
      )
    }
    case 'pointer_expression': {
      const argument = node.childForFieldName('argument')!
      const operator = node.childForFieldName('operator')!
      if (operator.text === '*') {
        const pointer = yield* evaluate(argument, context)
        asserts(typeof pointer === 'object' && pointer?.type === 'pointer')
        return pointer.ref.value
      }
      else if (operator.text === '&') {
        const [_, pointerValue] = lvalue(argument, context)
        return { type: 'pointer', ref: pointerValue }
      }
      throw new Error(`Unsupported: ${operator.text}`)
    }
    case 'declaration': {
      const { type, name, value } = yield* processDeclaration(
        node.childForFieldName('type')!,
        node.childForFieldName('declarator')!,
        context,
      )
      asserts(!(name in context.envStack[context.envStack.length - 1]), `Variable ${name} already declared`)
      context.envStack[context.envStack.length - 1][name] = { type, loc: context.store.length }
      context.store.push({ type, value: value!, dead: false })
      setCurrentNode(node)
      return yield // pause execution
    }
    case 'call_expression': {
      const func = node.childForFieldName('function')!
      asserts(func.type === 'identifier')
      asserts(func.text in context.functions)
      const { params, body } = context.functions[func.text]
      const argumentsNode = node.childForFieldName('arguments')!.namedChildren
      asserts(argumentsNode.length === params.length)
      const args: [string, { type: CppType, value: CppValue }][] = []

      for (let i = 0; i < params.length; i++) {
        const { name, type } = params[i]
        args.push([name, {
          type,
          value: castIfNull(type, checksDefined(yield* evaluate(argumentsNode[i], context))),
        }])
      }

      const newEnv: Record<string, EnvEntry> = {}
      for (const [name, arg] of args) {
        newEnv[name] = { type: arg.type, loc: context.store.length }
        context.store.push({ type: arg.type, value: arg.value, dead: false })
      }

      context.callStack.push({ env: context.envStack })
      context.envStack = [newEnv]

      // TODO: type checking
      return yield* evaluate(body, context)
    }
    case 'field_expression': {
      const argument = node.childForFieldName('argument')!
      const field = node.childForFieldName('field')!.text
      const operator = node.childForFieldName('operator')!
      const argumentValue = checksDefined(yield* evaluate(argument, context))
      asserts(typeof argumentValue === 'object')
      if (operator.text === '.') {
        asserts(typeof argumentValue === 'object' && argumentValue?.type === 'struct')
        const structDecl = context.structs[argumentValue.name]
        asserts(field in structDecl)
        return argumentValue.fields[field].value
      }
      else if (operator.text === '->') {
        asserts(typeof argumentValue === 'object' && argumentValue?.type === 'pointer')
        const struct = argumentValue.ref.value
        asserts(typeof struct === 'object' && struct.type === 'struct')
        asserts(field in context.structs[struct.name])
        return struct.fields[field].value
      }
      throw new Error(`Unsupported: ${node.text}`)
    }
    case 'new_expression': {
      asserts(
        !node.childForFieldName('arguments') && !node.childForFieldName('declarator'),
        'Unsupported: new expression with arguments or declarator',
      )
      const typeNode = node.childForFieldName('type')!
      const type: CppType = typeNode.type === 'primitive_type' ? typeNode.text as CppType : { type: 'struct', name: typeNode.text }
      const ref = {
        type,
        value: yield* initializeValue(type, context),
        dead: false,
      }
      context.store.push(ref)
      return {
        type: 'pointer',
        ref,
      }
    }
    case 'delete_expression': {
      asserts(node.childCount !== 4, 'Unsupported: delete expression with array')
      const pointer = lvalue(node.lastNamedChild!, context)[1]
      asserts(typeof pointer.value === 'object' && pointer.value?.type === 'pointer')
      asserts('dead' in pointer.value.ref, 'Invalid deletion to pointer')
      pointer.value.ref.dead = true
      return
    }
    case 'if_statement': {
      const condition = yield* evaluate(node.childForFieldName('condition')!, context)!
      const thenBlock = node.childForFieldName('consequence')!
      const elseBlock = node.childForFieldName('alternative')
      if (condition)
        return yield* evaluate(thenBlock, context)
      else if (elseBlock)
        return yield* evaluate(elseBlock, context)
      return
    }
    case 'condition_clause': {
      const result = checksDefined(yield* evaluate(node.childForFieldName('value')!, context))
      setCurrentNode(node)
      yield // pause execution
      return result
    }
    case 'conditional_expression': {
      const condition = checksDefined(yield* evaluate(node.childForFieldName('condition')!, context))
      setCurrentNode(node)
      yield // pause execution
      return yield* evaluate(
        condition ? node.childForFieldName('consequence')! : node.childForFieldName('alternative')!,
        context,
      )
    }
    case 'break_statement':
      throw new Break('Break')
    case 'continue_statement':
      throw new Continue('Continue')
    case 'while_statement': {
      const conditionNode = node.childForFieldName('condition')!
      let condition = isTruthy((yield* evaluate(conditionNode, context))!)
      const body = node.childForFieldName('body')!
      let returnValue: CppValue | null | undefined = undefined!
      while (condition) {
        try {
          returnValue = yield* evaluate(body, context)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue)
            continue
          throw e
        }
        if (returnValue !== undefined)
          return returnValue
        condition = isTruthy((yield* evaluate(conditionNode, context))!)
      }
      return
    }
    case 'do_statement': {
      const body = node.childForFieldName('body')!
      const conditionNode = node.childForFieldName('condition')!
      let returnValue: CppValue | null | undefined = undefined!
      let condition!: boolean
      do {
        try {
          returnValue = yield* evaluate(body, context)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue)
            continue
          throw e
        }
        if (returnValue !== undefined)
          return returnValue
        condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context)))
      } while (condition)
      return
    }
    case 'for_statement': {
      const init = node.childForFieldName('initializer')
      const conditionNode = node.childForFieldName('condition')
      const updateNode = node.childForFieldName('update')
      const body = node.childForFieldName('body')!
      if (init) {
        context.envStack.push({})
        yield* evaluate(init, context)
      }
      let condition = conditionNode ? isTruthy(checksDefined(yield* evaluate(conditionNode, context))) : true
      let returnValue: CppValue | null | undefined = undefined!
      while (condition) {
        try {
          returnValue = yield* evaluate(body, context)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue)
            continue
          throw e
        }
        if (returnValue !== undefined) {
          if (init)
            context.envStack.pop()
          return returnValue
        }
        if (updateNode) {
          yield* evaluate(updateNode, context)
          setCurrentNode(updateNode)
          yield // pause execution
        }
        if (conditionNode) {
          condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context)))
          setCurrentNode(conditionNode)
          yield // pause execution
        }
      }
      if (init)
        context.envStack.pop()
      return
    }
    case 'comment':
      return
    default:
      throw new Error(`Unsupported: ${node.type}`)
  }
}

class Continue extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Continue'
  }
}

class Break extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Break'
  }
}

function processDeclaration(type: Parser.SyntaxNode, declarator: Parser.SyntaxNode, context: InterpreterContext) {
  asserts(['type_identifier', 'primitive_type'].includes(type.type))
  asserts([
    'identifier',
    'field_identifier',
    'pointer_declarator',
    'array_declarator',
    'function_declarator',
    'init_declarator',
  ].includes(declarator.type))

  const baseType: CppType = type.type === 'primitive_type' ? type.text as CppType : { type: 'struct', name: type.text }
  function *helper(baseType: CppType, declarator: Parser.SyntaxNode): Generator<void, {
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
          value: (yield* initializeValue(baseType, context))!,
        }
      case 'function_declarator':
        return {
          type: baseType,
          name: declarator.childForFieldName('declarator')!.text,
          params: declarator
            .childForFieldName('parameters')!
            .namedChildren
            .map(param => getGeneratorReturn(processDeclaration(
              param.childForFieldName('type')!,
              param.childForFieldName('declarator')!,
              context,
            ))),
        }
      case 'init_declarator':{
        // console.log(baseType, declarator.text)
        const { type, ...rest } = yield* helper(baseType, declarator.childForFieldName('declarator')!)
        return ({
          type,
          ...rest,
          value: castIfNull(type, yield* initializeValue(type, context, declarator.childForFieldName('value')!)),
        })
      }
      case 'pointer_declarator':
        return yield* helper({ type: 'pointer', to: baseType }, declarator.childForFieldName('declarator')!)
      case 'array_declarator':
        return yield* helper({
          type: 'array',
          of: baseType,
          size: Number(declarator.childForFieldName('size')!.text),
        }, declarator.childForFieldName('declarator')!)
      default:
        throw new Error(`Unsupported declarator type: ${declarator.type}`)
    }
  }

  return helper(baseType, declarator)
}

function lvalue(
  node: Parser.SyntaxNode,
  context: InterpreterContext,
): [type: CppType, lvalue: { value: CppValue }] {
  switch (node.type) {
    case 'identifier': {
      context.currentNode = markRaw(node)
      for (let i = context.envStack.length - 1; i >= 0; i--) {
        const env = context.envStack[i]
        if (node.text in env) {
          const { loc, type } = env[node.text]
          const variable = context.store[loc]
          asserts(variable.dead === false, `Variable ${node.text} is dead`)
          return [type, variable]
        }
      }
      asserts(node.text in context.globalEnv, `Variable ${node.text} not found`)
      const { loc, type } = context.globalEnv[node.text]
      return [type, context.store[loc]]
    }
    case 'field_expression': {
      const argument = node.childForFieldName('argument')!
      const field = node.childForFieldName('field')!.text
      const operator = node.childForFieldName('operator')!
      const [type, argumentValue] = lvalue(argument, context)
      if (operator.text === '.') {
        asserts(typeof argumentValue.value === 'object' && argumentValue.value?.type === 'struct')
        asserts(typeof type === 'object' && type.type === 'struct')
        const structDecl = context.structs[type.name]
        asserts(field in structDecl)
        return [structDecl[field], argumentValue.value.fields[field]]
      }
      else if (operator.text === '->') {
        asserts(typeof argumentValue.value === 'object' && argumentValue.value?.type === 'pointer')
        asserts(typeof type === 'object' && type.type === 'pointer')
        const ptrT = type.to
        asserts(typeof ptrT === 'object' && ptrT.type === 'struct')
        const structDecl = context.structs[ptrT.name]
        asserts(field in structDecl)
        const struct = argumentValue.value.ref.value
        asserts(typeof struct === 'object' && struct.type === 'struct')
        return [structDecl[field], struct.fields[field]]
      }
      throw new Error(`Unsupported: ${node.text}`)
    }
    case 'subscript_expression': {
      const array = node.childForFieldName('argument')!
      const index = node.childForFieldName('indices')!
      asserts(index.namedChildCount === 1, 'Unsupported: multiple indices')
      const [type, arrayValue] = lvalue(array, context)
      asserts(typeof type === 'object' && type.type === 'array')
      asserts(typeof arrayValue.value === 'object' && arrayValue.value?.type === 'array')
      const indexValue = evaluate(index, context)
      asserts(typeof indexValue === 'number')
      return [type.of, arrayValue.value.items[indexValue]]
    }
    case 'pointer_expression': {
      const pointer = node.childForFieldName('argument')!
      const [type, pointerValue] = lvalue(pointer, context)
      const operator = node.childForFieldName('operator')!
      asserts(operator.text === '*')
      asserts(typeof type === 'object' && type.type === 'pointer')
      asserts(typeof pointerValue.value === 'object' && pointerValue.value?.type === 'pointer')
      return [type.to, pointerValue.value.ref]
    }
    default:
      throw new Error(`Unsupported or not invalid lvalue: ${node.text}`)
  }
}

function *processAssignment(lhs: Parser.SyntaxNode, value: CppValue | null, op: string, context: InterpreterContext): Generator<void, CppValue> {
  const [type, lval] = lvalue(lhs, context)
  if (op !== '=') {
    op = op.slice(0, -1)
    asserts(op in binaryOps, `Unsupported assignment operator: ${op}`)
    asserts(typeof lval.value !== 'object' && typeof value !== 'object')
    value = binaryOps[op](lval.value, castIfNull(type, value) as number | boolean)
  }
  return lval.value = castIfNull(type, value)
}

function castIfNull(type: CppType, value: CppValue | null): CppValue {
  if (value != null)
    // TODO: type checking & casting
    return value

  switch (type) {
    case 'int':
    case 'float':
    case 'double':
    case 'char':
      return 0
    case 'bool':
      return false
    case 'void':
      throw new Error('Cannot assign null to void type')
    default: switch (type.type) {
      case 'pointer':
        return {
          type: 'pointer',
          ref: NULL,
        }
      default:
        throw asserts(false, `Cannot assign null to non-primitive type: ${JSON.stringify(type)}`)
    }
  }
}

function *initializeValue(
  type: CppType,
  context: InterpreterContext,
  initializer?: Parser.SyntaxNode,
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
      default: switch (type.type) {
        case 'pointer':
          return {
            type: 'pointer',
            ref: NULL,
          }
        case 'array':
          return {
            type: 'array',
            items: Array.from(
              { length: type.size },
              () => ({ value: getGeneratorReturn(initializeValue(type.of, context)) }),
            ),
          }
        case 'struct':
          asserts(type.name in context.structs, `Struct ${type.name} not found`)
          return {
            type: 'struct',
            name: type.name,
            fields: Object.fromEntries(
              Object.entries(context.structs[type.name])
                .map(([name, type]) => [name, { value: getGeneratorReturn(initializeValue(type, context)) }]),
            ),
          }
      }
    }
  }
  asserts(initializer.type !== 'initializer_list', 'Unsupported: initializer_list')
  return castIfNull(type, checksDefined(yield* evaluate(initializer, context)))
}

function isTruthy(value: CppValue | null): boolean {
  switch (typeof value) {
    case 'number':
      return value !== 0
    case 'boolean':
      return value
    case 'object':
      if (!value)
        return false
      switch (value.type) {
        case 'pointer':
          return value.ref !== NULL
        case 'array':
          return !!value.items
        case 'struct':
          return true
      }
  }
}

function getGeneratorReturn<T>(gen: Generator<any, T>): T {
  let ret = gen.next()
  while (!ret.done)
    ret = gen.next()
  return ret.value
}

// function isPrimitiveType(type: string): type is (typeof CppPrimitiveTypes)[number] {
//   return CppPrimitiveTypes.includes(type as any)
// }

function asserts(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}

function checksDefined<T>(value: T | undefined): T {
  asserts(value !== undefined)
  return value
}
