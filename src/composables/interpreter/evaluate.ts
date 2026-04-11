import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { MemoryManager } from './memory'
import type { CppType, CppValue, InterpreterContext } from './types'
import { markRaw } from 'vue'
import { processDeclaration, setEvaluate } from './declarations'
import { asserts, castIfNull, checksDefined, getGeneratorReturn, isTruthy } from './helpers'
import { NULL_ADDRESS, NullPointerError, StackOverflowError, UnsupportedError, UseAfterFreeError } from './types'

const MAX_CALL_DEPTH = 128

// ── Pointer equality ──────────────────────────────────────────────

function eq(a: CppValue | null, b: CppValue | null): boolean {
  if (a === b)
    return true
  // Treat null as a null pointer
  const pa = a === null ? NULL_ADDRESS : (typeof a === 'object' && a.type === 'pointer' ? a.address : undefined)
  const pb = b === null ? NULL_ADDRESS : (typeof b === 'object' && b.type === 'pointer' ? b.address : undefined)
  if (pa !== undefined && pb !== undefined)
    return pa === pb
  return false
}

// ── Operator tables ───────────────────────────────────────────────

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

// ── Loop control flow ─────────────────────────────────────────────

class Break extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Break'
  }
}

class Continue extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Continue'
  }
}

// ── lvalue ────────────────────────────────────────────────────────

function lvalue(
  node: SyntaxNode,
  context: InterpreterContext,
  mem: MemoryManager,
): [type: CppType, address: number] {
  switch (node.type) {
    case 'identifier': {
      context.currentNode = markRaw(node)
      for (let i = context.envStack.length - 1; i >= 0; i--) {
        const env = context.envStack[i]
        if (node.text in env) {
          const { address, type } = env[node.text]
          const cell = mem.read(address)
          if (cell.dead)
            throw new UseAfterFreeError(address, node)
          return [type, address]
        }
      }
      asserts(node.text in context.globalEnv, `Variable ${node.text} not found`)
      const { address, type } = context.globalEnv[node.text]
      return [type, address]
    }
    case 'field_expression': {
      const argument = node.childForFieldName('argument')!
      const field = node.childForFieldName('field')!.text
      const operator = node.childForFieldName('operator')!
      if (operator.text === '.') {
        const [type, addr] = lvalue(argument, context, mem)
        const cellValue = mem.read(addr).value
        asserts(typeof cellValue === 'object' && cellValue.type === 'struct')
        asserts(typeof type === 'object' && type.type === 'struct')
        const structDecl = context.structs[type.name]
        asserts(field in structDecl)
        return mem.readField(cellValue.base, field, structDecl)
      }
      else if (operator.text === '->') {
        const [type, addr] = lvalue(argument, context, mem)
        const ptrValue = mem.read(addr).value
        asserts(typeof ptrValue === 'object' && ptrValue.type === 'pointer')
        asserts(typeof type === 'object' && type.type === 'pointer')
        if (ptrValue.address === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetCell = mem.read(ptrValue.address)
        if (targetCell.dead)
          throw new UseAfterFreeError(ptrValue.address, node)
        const structValue = targetCell.value
        asserts(typeof structValue === 'object' && structValue.type === 'struct')
        const ptrT = type.to
        asserts(typeof ptrT === 'object' && ptrT.type === 'struct')
        const structDecl = context.structs[ptrT.name]
        asserts(field in structDecl)
        return mem.readField(structValue.base, field, structDecl)
      }
      throw new UnsupportedError(node.text, node)
    }
    case 'subscript_expression': {
      const array = node.childForFieldName('argument')!
      const index = node.childForFieldName('indices')!
      asserts(index.namedChildCount === 1, 'Unsupported: multiple indices')
      const [type, addr] = lvalue(array, context, mem)
      asserts(typeof type === 'object' && type.type === 'array')
      const arrayValue = mem.read(addr).value
      asserts(typeof arrayValue === 'object' && arrayValue.type === 'array')
      // BUG FIX: use getGeneratorReturn to properly exhaust the generator
      const indexValue = getGeneratorReturn(evaluate(index.namedChildren[0], context, mem))
      asserts(typeof indexValue === 'number')
      return [type.of, arrayValue.base + 1 + indexValue]
    }
    case 'pointer_expression': {
      const pointer = node.childForFieldName('argument')!
      const [type, addr] = lvalue(pointer, context, mem)
      const operator = node.childForFieldName('operator')!
      asserts(operator.text === '*')
      asserts(typeof type === 'object' && type.type === 'pointer')
      const ptrValue = mem.read(addr).value
      asserts(typeof ptrValue === 'object' && ptrValue.type === 'pointer')
      if (ptrValue.address === NULL_ADDRESS)
        throw new NullPointerError(node)
      return [type.to, ptrValue.address]
    }
    default:
      throw new UnsupportedError(`not a valid lvalue: ${node.text}`, node)
  }
}

// ── processAssignment ─────────────────────────────────────────────

function* processAssignment(
  lhs: SyntaxNode,
  value: CppValue | null,
  op: string,
  context: InterpreterContext,
  mem: MemoryManager,
): Generator<void, CppValue> {
  const [type, addr] = lvalue(lhs, context, mem)
  const currentValue = mem.read(addr).value
  if (op !== '=') {
    op = op.slice(0, -1)
    asserts(op in binaryOps, `Unsupported assignment operator: ${op}`)
    asserts(typeof currentValue !== 'object' && typeof value !== 'object')
    value = binaryOps[op](currentValue, castIfNull(type, value) as number | boolean)
  }
  const newValue = castIfNull(type, value)
  mem.write(addr, newValue)
  return newValue
}

// ── evaluate ──────────────────────────────────────────────────────

export function* evaluate(
  node: SyntaxNode,
  context: InterpreterContext,
  mem: MemoryManager,
): Generator<void, CppValue | null | undefined> {
  function setCurrentNode(n: SyntaxNode) {
    context.currentNode = markRaw(n)
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
    case 'identifier': {
      const [, addr] = lvalue(node, context, mem)
      return mem.read(addr).value
    }
    case 'parenthesized_expression': {
      return yield* evaluate(node.namedChildren[0], context, mem)
    }
    case 'compound_statement': {
      context.envStack.push({})
      let returnValue: CppValue | null = undefined!
      for (const child of node.namedChildren) {
        const ret = yield* evaluate(child, context, mem)
        if (ret !== undefined) {
          returnValue = ret
          break
        }
      }

      const poppedEnv = context.envStack.pop()!
      for (const { address } of Object.values(poppedEnv))
        mem.read(address).dead = true

      const isFunctionBody = node.parent!.type === 'function_definition'
      if (isFunctionBody) {
        // Mark function parameter cells as dead (they were allocated on the stack
        // for this call). Skip struct/array pass-by-reference params that share
        // the original heap address.
        for (const env of context.envStack) {
          for (const { address } of Object.values(env)) {
            const cell = mem.read(address)
            if (cell.region === 'stack')
              cell.dead = true
          }
        }
        context.envStack = context.callStack.pop()!.env
      }

      return returnValue
    }
    case 'return_statement': {
      const expr = node.firstNamedChild
      if (!expr)
        return null
      const returnValue = yield* evaluate(expr, context, mem)
      setCurrentNode(node)
      yield
      return returnValue
    }
    case 'expression_statement': {
      const expr = node.firstNamedChild
      if (expr)
        yield* evaluate(expr, context, mem)
      setCurrentNode(node)
      return yield
    }
    case 'binary_expression': {
      const op = node.childForFieldName('operator')!.text

      // Short-circuit evaluation for logical operators
      if (op === '&&') {
        const lhs = checksDefined(yield* evaluate(node.childForFieldName('left')!, context, mem))
        if (!isTruthy(lhs))
          return lhs
        return checksDefined(yield* evaluate(node.childForFieldName('right')!, context, mem))
      }
      if (op === '||') {
        const lhs = checksDefined(yield* evaluate(node.childForFieldName('left')!, context, mem))
        if (isTruthy(lhs))
          return lhs
        return checksDefined(yield* evaluate(node.childForFieldName('right')!, context, mem))
      }

      const lhs = checksDefined(yield* evaluate(node.childForFieldName('left')!, context, mem))
      const rhs = checksDefined(yield* evaluate(node.childForFieldName('right')!, context, mem))
      asserts(op in binaryOps, `Unsupported binary operator: ${op}`)
      return binaryOps[op](lhs, rhs)
    }
    case 'unary_expression': {
      const operand = checksDefined(yield* evaluate(node.childForFieldName('argument')!, context, mem))
      const op = node.childForFieldName('operator')!.text
      asserts(op in unaryOps, `Unsupported unary operator: ${op}`)
      asserts(typeof operand !== 'object')
      return unaryOps[op](operand)
    }
    case 'update_expression': {
      const [, addr] = lvalue(node.childForFieldName('argument')!, context, mem)
      const cell = mem.read(addr)
      const isPostfix = node.firstChild!.isNamed
      const op = node.childForFieldName('operator')!.text
      asserts(op === '++' || op === '--')
      asserts(typeof cell.value !== 'object')
      const old = cell.value
      const newVal = binaryOps[op[0]](old, 1)
      mem.write(addr, newVal)
      return isPostfix ? old : newVal
    }
    case 'assignment_expression': {
      const op = node.childForFieldName('operator')!.text
      return yield* processAssignment(
        node.childForFieldName('left')!,
        checksDefined(yield* evaluate(node.childForFieldName('right')!, context, mem)),
        op,
        context,
        mem,
      )
    }
    case 'subscript_expression': {
      const [, addr] = lvalue(node, context, mem)
      return mem.read(addr).value
    }
    case 'pointer_expression': {
      const argument = node.childForFieldName('argument')!
      const operator = node.childForFieldName('operator')!
      if (operator.text === '*') {
        const pointer = yield* evaluate(argument, context, mem)
        asserts(typeof pointer === 'object' && pointer?.type === 'pointer')
        if (pointer.address === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetCell = mem.read(pointer.address)
        if (targetCell.dead)
          throw new UseAfterFreeError(pointer.address, node)
        return targetCell.value
      }
      else if (operator.text === '&') {
        const [, addr] = lvalue(argument, context, mem)
        return { type: 'pointer', address: addr }
      }
      throw new UnsupportedError(operator.text, node)
    }
    case 'declaration': {
      const typeNode = node.childForFieldName('type')!
      // Support declaration lists: `int a, b, c;` has multiple declarators
      // Filter by id since Tree-sitter creates new wrapper objects per access
      const declarators = node.namedChildren.filter(c => c.id !== typeNode.id)
      for (const declarator of declarators) {
        const { type, name, value } = yield* processDeclaration(
          typeNode,
          declarator,
          context,
          mem,
        )
        asserts(!(name in context.envStack.at(-1)!), `Variable ${name} already declared`)
        // Structs and arrays already have their header cell allocated by initializeValue;
        // bind the variable directly to the header address instead of allocating a duplicate.
        let addr: number
        if (typeof value === 'object' && (value.type === 'struct' || value.type === 'array')) {
          addr = value.base
        }
        else {
          addr = mem.alloc(type, value!, 'stack')
        }
        context.envStack.at(-1)![name] = { type, address: addr }
      }
      setCurrentNode(node)
      return yield
    }
    case 'call_expression': {
      if (context.callStack.length >= MAX_CALL_DEPTH)
        throw new StackOverflowError(`Stack overflow: call depth exceeded ${MAX_CALL_DEPTH}`, node)
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
          value: castIfNull(type, checksDefined(yield* evaluate(argumentsNode[i], context, mem))),
        }])
      }

      const newEnv: Record<string, { type: CppType, address: number }> = {}
      for (const [name, arg] of args) {
        let addr: number
        if (typeof arg.value === 'object' && (arg.value.type === 'struct' || arg.value.type === 'array')) {
          addr = arg.value.base
        }
        else {
          addr = mem.alloc(arg.type, arg.value, 'stack')
        }
        newEnv[name] = { type: arg.type, address: addr }
      }

      context.callStack.push({ env: context.envStack })
      context.envStack = [newEnv]

      return yield* evaluate(body, context, mem)
    }
    case 'field_expression': {
      const argument = node.childForFieldName('argument')!
      const field = node.childForFieldName('field')!.text
      const operator = node.childForFieldName('operator')!
      const argumentValue = checksDefined(yield* evaluate(argument, context, mem))
      asserts(typeof argumentValue === 'object' && argumentValue !== null)
      if (operator.text === '.' && argumentValue.type === 'struct') {
        const structDecl = context.structs[argumentValue.name]
        asserts(field in structDecl)
        const [, fieldAddr] = mem.readField(argumentValue.base, field, structDecl)
        return mem.read(fieldAddr).value
      }
      else if (operator.text === '->' && argumentValue.type === 'pointer') {
        if (argumentValue.address === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetCell = mem.read(argumentValue.address)
        if (targetCell.dead)
          throw new UseAfterFreeError(argumentValue.address, node)
        const structVal = targetCell.value
        asserts(typeof structVal === 'object' && structVal.type === 'struct')
        asserts(field in context.structs[structVal.name])
        const [, fieldAddr] = mem.readField(structVal.base, field, context.structs[structVal.name])
        return mem.read(fieldAddr).value
      }
      throw new UnsupportedError(node.text, node)
    }
    case 'new_expression': {
      const typeNode = node.childForFieldName('type')!
      const type: CppType = typeNode.type === 'primitive_type'
        ? typeNode.text as CppType
        : { type: 'struct', name: typeNode.text }

      if (typeof type === 'object' && type.type === 'struct') {
        asserts(type.name in context.structs, `Struct ${type.name} not found`)
        const fieldDefs = context.structs[type.name]
        const base = mem.allocStruct(type.name, fieldDefs, 'heap')

        // Support constructor arguments: write arg values to field addresses
        const argsNode = node.childForFieldName('arguments')
        if (argsNode) {
          const argNodes = argsNode.namedChildren
          const fieldNames = Object.keys(fieldDefs)
          for (let i = 0; i < argNodes.length && i < fieldNames.length; i++) {
            const argValue = checksDefined(yield* evaluate(argNodes[i], context, mem))
            const [fieldType, fieldAddr] = mem.readField(base, fieldNames[i], fieldDefs)
            mem.write(fieldAddr, castIfNull(fieldType, argValue))
          }
        }

        return {
          type: 'pointer',
          address: base,
        }
      }
      else {
        // Primitive type on the heap
        const val = getGeneratorReturn(initializeValueForNew(type, context, mem))
        const addr = mem.alloc(type, val, 'heap')
        return {
          type: 'pointer',
          address: addr,
        }
      }
    }
    case 'delete_expression': {
      asserts(node.childCount !== 4, 'Unsupported: delete expression with array')
      const [, addr] = lvalue(node.lastNamedChild!, context, mem)
      const ptrValue = mem.read(addr).value
      asserts(typeof ptrValue === 'object' && ptrValue.type === 'pointer')
      if (ptrValue.address === NULL_ADDRESS)
        throw new NullPointerError(node)
      mem.free(ptrValue.address)
      return
    }
    case 'if_statement': {
      const condition = yield* evaluate(node.childForFieldName('condition')!, context, mem)
      const thenBlock = node.childForFieldName('consequence')!
      const elseBlock = node.childForFieldName('alternative')
      if (isTruthy(condition!))
        return yield* evaluate(thenBlock, context, mem)
      else if (elseBlock)
        return yield* evaluate(elseBlock, context, mem)
      return
    }
    case 'else_clause': {
      return yield* evaluate(node.namedChildren[0], context, mem)
    }
    case 'condition_clause': {
      const result = checksDefined(yield* evaluate(node.childForFieldName('value')!, context, mem))
      setCurrentNode(node)
      yield
      return result
    }
    case 'conditional_expression': {
      const condition = checksDefined(yield* evaluate(node.childForFieldName('condition')!, context, mem))
      setCurrentNode(node)
      yield
      return yield* evaluate(
        isTruthy(condition)
          ? node.childForFieldName('consequence')!
          : node.childForFieldName('alternative')!,
        context,
        mem,
      )
    }
    case 'break_statement':
      throw new Break('Break')
    case 'continue_statement':
      throw new Continue('Continue')
    case 'while_statement': {
      const conditionNode = node.childForFieldName('condition')!
      let condition = isTruthy((yield* evaluate(conditionNode, context, mem))!)
      const body = node.childForFieldName('body')!
      let returnValue: CppValue | null | undefined = undefined!
      while (condition) {
        try {
          returnValue = yield* evaluate(body, context, mem)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue) {
            condition = isTruthy((yield* evaluate(conditionNode, context, mem))!)
            continue
          }
          throw e
        }
        if (returnValue !== undefined)
          return returnValue
        condition = isTruthy((yield* evaluate(conditionNode, context, mem))!)
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
          returnValue = yield* evaluate(body, context, mem)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue) {
            condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context, mem)))
            continue
          }
          throw e
        }
        if (returnValue !== undefined)
          return returnValue
        condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context, mem)))
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
        yield* evaluate(init, context, mem)
      }
      let condition = conditionNode
        ? isTruthy(checksDefined(yield* evaluate(conditionNode, context, mem)))
        : true
      let returnValue: CppValue | null | undefined = undefined!
      while (condition) {
        try {
          returnValue = yield* evaluate(body, context, mem)
        }
        catch (e) {
          if (e instanceof Break)
            break
          if (e instanceof Continue) {
            if (updateNode) {
              yield* evaluate(updateNode, context, mem)
              setCurrentNode(updateNode)
              yield
            }
            if (conditionNode) {
              condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context, mem)))
              setCurrentNode(conditionNode)
              yield
            }
            continue
          }
          throw e
        }
        if (returnValue !== undefined) {
          if (init)
            context.envStack.pop()
          return returnValue
        }
        if (updateNode) {
          yield* evaluate(updateNode, context, mem)
          setCurrentNode(updateNode)
          yield
        }
        if (conditionNode) {
          condition = isTruthy(checksDefined(yield* evaluate(conditionNode, context, mem)))
          setCurrentNode(conditionNode)
          yield
        }
      }
      if (init)
        context.envStack.pop()
      return
    }
    case 'comment':
      return
    default:
      throw new UnsupportedError(node.type, node)
  }
}

// Helper for new_expression with primitive types
function* initializeValueForNew(
  type: CppType,
  _context: InterpreterContext,
  _mem: MemoryManager,
): Generator<void, CppValue> {
  switch (type) {
    case 'int':
    case 'float':
    case 'double':
    case 'char':
      return 0
    case 'bool':
      return false
    default:
      throw new UnsupportedError(`new with type ${JSON.stringify(type)}`)
  }
}

// Register evaluate into declarations.ts to break the circular dependency
setEvaluate(evaluate)
