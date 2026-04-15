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

// ── helpers ───────────────────────────────────────────────────────

/** Read a scalar or pointer value from memory at the given address+type. */
function readValue(mem: MemoryManager, addr: number, type: CppType): CppValue {
  if (typeof type === 'string') {
    return mem.readScalar(addr, type)
  }
  if (type.type === 'pointer') {
    const raw = mem.readScalar(addr, type) as number
    return { type: 'pointer', address: raw }
  }
  if (type.type === 'array') {
    // `type.size` is the declared length of this array dimension and `type.of` is
    // its element type — both come from the declaration, not the allocation, so they
    // are always correct even for inner rows of a multi-dimensional array.
    // Using `alloc.base` / `alloc.layout.length` would give the OUTER allocation's
    // values when `addr` points at an inner row (e.g. &a[1][0] for int a[3][4]).
    return { type: 'array', base: addr, length: type.size, elementType: type.of }
  }
  if (type.type === 'struct') {
    const alloc = mem.findAllocation(addr)
    asserts(alloc, `readValue: no allocation at ${addr}`)
    asserts(alloc.layout.kind === 'struct', `readValue: expected struct allocation at ${addr}`)
    return { type: 'struct', name: alloc.layout.structName, base: alloc.base }
  }
  asserts(false, `readValue: unsupported type ${JSON.stringify(type)}`)
}

/**
 * Return the byte stride for pointer arithmetic on a pointer whose current
 * address is `ptrAddr`.  We inspect the allocation that owns that byte:
 *   - If it is an array allocation → use the array stride.
 *   - Otherwise → use the size of the leaf scalar/struct at that byte.
 * Falls back to 1 if nothing can be determined.
 */
function pointerStride(mem: MemoryManager, ptrAddr: number): number {
  const desc = mem.describeByte(ptrAddr)
  if (!desc)
    return 1
  // Use the leaf element's size so that pointer arithmetic always moves by the
  // size of the innermost element being pointed at.  Using alloc.layout.stride
  // (the outer array's row stride) was wrong for int* pointing into a row of a
  // 2D array — it gave stride=16 instead of stride=4.
  const leafType = desc.leafType
  if (typeof leafType === 'string') {
    const sizes: Record<string, number> = { int: 4, float: 4, double: 8, char: 1, bool: 1, void: 1 }
    return sizes[leafType] ?? 1
  }
  // pointer-to type
  return 4
}

/** Write a CppValue to memory at the given address+type. */
function writeValue(mem: MemoryManager, addr: number, type: CppType, value: CppValue) {
  if (typeof type === 'string') {
    mem.writeScalar(addr, type, value as number | boolean)
  }
  else if (type.type === 'pointer') {
    // Array-to-pointer decay: `int *p = arr` stores arr.base as the pointer address.
    if (typeof value === 'object' && value !== null && value.type === 'array') {
      mem.writeScalar(addr, type, value.base)
    }
    else {
      const ptrVal = value as { type: 'pointer', address: number }
      mem.writeScalar(addr, type, ptrVal.address)
    }
  }
  // struct/array: in-place, no write needed (they share the allocation)
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
          const alloc = mem.findAllocation(address)
          if (alloc?.dead)
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
        asserts(typeof type === 'object' && type.type === 'struct')
        const { address: fieldAddr, type: fieldType } = mem.fieldAddress(addr, field)
        return [fieldType, fieldAddr]
      }
      else if (operator.text === '->') {
        const [type, addr] = lvalue(argument, context, mem)
        asserts(typeof type === 'object' && type.type === 'pointer')
        const ptrAddress = mem.readScalar(addr, type) as number
        if (ptrAddress === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetAlloc = mem.findAllocation(ptrAddress)
        if (targetAlloc?.dead)
          throw new UseAfterFreeError(ptrAddress, node)
        const { address: fieldAddr, type: fieldType } = mem.fieldAddress(ptrAddress, field)
        return [fieldType, fieldAddr]
      }
      throw new UnsupportedError(node.text, node)
    }
    case 'subscript_expression': {
      const array = node.childForFieldName('argument')!
      const index = node.childForFieldName('indices')!
      asserts(index.namedChildCount === 1, 'Unsupported: multiple indices')
      const [type, addr] = lvalue(array, context, mem)
      // BUG FIX: use getGeneratorReturn to properly exhaust the generator
      const indexValue = getGeneratorReturn(evaluate(index.namedChildren[0], context, mem))
      asserts(typeof indexValue === 'number')
      if (typeof type === 'object' && type.type === 'array') {
        // Use elementAddressTyped so multi-dimensional arrays (where inner rows share
        // the same base address as the outer allocation) are indexed correctly.
        const { address: elemAddr, type: elemType } = mem.elementAddressTyped(addr, indexValue, type)
        return [elemType, elemAddr]
      }
      else if (typeof type === 'object' && type.type === 'pointer') {
        // Pointer subscript: ptr[n] == *(ptr + n).  Read the pointer value, then
        // offset by index * stride (same logic as binary pointer arithmetic).
        const ptrValue = mem.readScalar(addr, type) as number
        const stride = pointerStride(mem, ptrValue)
        return [type.to, ptrValue + indexValue * stride]
      }
      throw new Error(`subscript_expression: expected array or pointer type, got ${JSON.stringify(type)}`)
    }
    case 'pointer_expression': {
      const pointer = node.childForFieldName('argument')!
      const [type, addr] = lvalue(pointer, context, mem)
      const operator = node.childForFieldName('operator')!
      asserts(operator.text === '*')
      asserts(typeof type === 'object' && type.type === 'pointer')
      const ptrAddress = mem.readScalar(addr, type) as number
      if (ptrAddress === NULL_ADDRESS)
        throw new NullPointerError(node)
      return [type.to, ptrAddress]
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
  if (op !== '=') {
    op = op.slice(0, -1)
    // Read current value for compound assignment
    const currentValue = readValue(mem, addr, type)
    // Pointer compound assignment (ptr += n, ptr -= n) — stride-scaled
    if (typeof currentValue === 'object' && currentValue.type === 'pointer' && typeof value === 'number') {
      const stride = pointerStride(mem, currentValue.address)
      if (op === '+')
        value = { type: 'pointer', address: currentValue.address + value * stride }
      else if (op === '-')
        value = { type: 'pointer', address: currentValue.address - value * stride }
      else
        asserts(false, `Unsupported pointer operator: ${op}`)
    }
    else {
      asserts(op in binaryOps, `Unsupported assignment operator: ${op}`)
      value = binaryOps[op](currentValue, castIfNull(type, value) as number | boolean)
    }
  }
  const newValue = castIfNull(type, value)
  writeValue(mem, addr, type, newValue)
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
      const [type, addr] = lvalue(node, context, mem)
      return readValue(mem, addr, type)
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
      for (const { address } of Object.values(poppedEnv)) {
        const alloc = mem.findAllocation(address)
        if (alloc)
          alloc.dead = true
      }

      const isFunctionBody = node.parent!.type === 'function_definition'
      if (isFunctionBody) {
        // Mark function parameter cells as dead (they were allocated on the stack
        // for this call). Skip struct/array pass-by-reference params that share
        // the original heap address.
        for (const env of context.envStack) {
          for (const { address } of Object.values(env)) {
            const alloc = mem.findAllocation(address)
            if (alloc && alloc.region === 'stack')
              alloc.dead = true
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

      // Pointer arithmetic: ptr + int, int + ptr, ptr - int, ptr - ptr
      // All offsets are C-style (scaled by element stride in bytes).
      const lPtr = lhs !== null && typeof lhs === 'object' && lhs.type === 'pointer'
      const rPtr = rhs !== null && typeof rhs === 'object' && rhs.type === 'pointer'
      if (lPtr || rPtr) {
        if (op === '+') {
          if (lPtr && typeof rhs === 'number') {
            const base = (lhs as { address: number }).address
            return { type: 'pointer', address: base + rhs * pointerStride(mem, base) }
          }
          if (rPtr && typeof lhs === 'number') {
            const base = (rhs as { address: number }).address
            return { type: 'pointer', address: base + lhs * pointerStride(mem, base) }
          }
        }
        if (op === '-') {
          if (lPtr && typeof rhs === 'number') {
            const base = (lhs as { address: number }).address
            return { type: 'pointer', address: base - rhs * pointerStride(mem, base) }
          }
          if (lPtr && rPtr) {
            const la = (lhs as { address: number }).address
            const ra = (rhs as { address: number }).address
            const stride = pointerStride(mem, la)
            return (la - ra) / stride
          }
        }
        // Pointer comparison
        if (lPtr && rPtr && (op === '<' || op === '>' || op === '<=' || op === '>=')) {
          const la = (lhs as { address: number }).address
          const ra = (rhs as { address: number }).address
          if (op === '<')
            return la < ra
          if (op === '>')
            return la > ra
          if (op === '<=')
            return la <= ra
          return la >= ra
        }
      }

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
      const [type, addr] = lvalue(node.childForFieldName('argument')!, context, mem)
      const isPostfix = node.firstChild!.isNamed
      const op = node.childForFieldName('operator')!.text
      asserts(op === '++' || op === '--')
      const old = readValue(mem, addr, type)
      // Pointer increment/decrement (stride-scaled)
      if (typeof old === 'object' && old.type === 'pointer') {
        const stride = pointerStride(mem, old.address)
        const delta = (op === '++' ? 1 : -1) * stride
        const newVal: CppValue = { type: 'pointer', address: old.address + delta }
        writeValue(mem, addr, type, newVal)
        return isPostfix ? old : newVal
      }
      const newVal = binaryOps[op[0]](old, 1)
      writeValue(mem, addr, type, newVal)
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
      const [type, addr] = lvalue(node, context, mem)
      return readValue(mem, addr, type)
    }
    case 'pointer_expression': {
      const argument = node.childForFieldName('argument')!
      const operator = node.childForFieldName('operator')!
      if (operator.text === '*') {
        const pointer = yield* evaluate(argument, context, mem)
        asserts(typeof pointer === 'object' && pointer?.type === 'pointer')
        if (pointer.address === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetAlloc = mem.findAllocation(pointer.address)
        if (targetAlloc?.dead)
          throw new UseAfterFreeError(pointer.address, node)
        // Determine the pointee type: try lvalue first (works for identifiers and
        // subscript/field expressions), fall back to describeByte for computed
        // pointers like (p + 1) that aren't lvalues.
        let pointeeType: CppType
        try {
          const [ptrType] = lvalue(argument, context, mem)
          asserts(typeof ptrType === 'object' && ptrType.type === 'pointer')
          pointeeType = ptrType.to
        }
        catch {
          const desc = mem.describeByte(pointer.address)
          asserts(desc, `Cannot dereference pointer at ${pointer.address}: no allocation`)
          pointeeType = desc.leafType
        }
        return readValue(mem, pointer.address, pointeeType)
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
        // Structs and arrays already have their allocation created by initializeValue;
        // bind the variable directly to the base address instead of allocating a duplicate.
        let addr: number
        if (typeof value === 'object' && (value.type === 'struct' || value.type === 'array')) {
          addr = value.base
        }
        else {
          addr = mem.alloc(type, 'stack', value ?? undefined)
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

      // Built-in: breakpoint() pauses execution and stops play mode
      if (func.text === 'breakpoint') {
        setCurrentNode(node)
        context.hitBreakpoint = true
        yield
        return null
      }

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
          addr = mem.alloc(arg.type, 'stack', arg.value)
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
      if (operator.text === '.') {
        const [type, addr] = lvalue(node, context, mem)
        return readValue(mem, addr, type)
      }
      else if (operator.text === '->') {
        const argumentValue = checksDefined(yield* evaluate(argument, context, mem))
        asserts(typeof argumentValue === 'object' && argumentValue !== null && argumentValue.type === 'pointer')
        if (argumentValue.address === NULL_ADDRESS)
          throw new NullPointerError(node)
        const targetAlloc = mem.findAllocation(argumentValue.address)
        if (targetAlloc?.dead)
          throw new UseAfterFreeError(argumentValue.address, node)
        const { address: fieldAddr, type: fieldType } = mem.fieldAddress(argumentValue.address, field)
        return readValue(mem, fieldAddr, fieldType)
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
        const base = mem.allocStruct(type.name, 'heap')

        // Support constructor arguments: write arg values to field addresses
        const argsNode = node.childForFieldName('arguments')
        if (argsNode) {
          const argNodes = argsNode.namedChildren
          const fieldNames = Object.keys(context.structs[type.name])
          for (let i = 0; i < argNodes.length && i < fieldNames.length; i++) {
            const argValue = checksDefined(yield* evaluate(argNodes[i], context, mem))
            const { address: fieldAddr, type: fieldType } = mem.fieldAddress(base, fieldNames[i])
            writeValue(mem, fieldAddr, fieldType, castIfNull(fieldType, argValue))
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
        const addr = mem.alloc(type, 'heap', val)
        return {
          type: 'pointer',
          address: addr,
        }
      }
    }
    case 'delete_expression': {
      asserts(node.childCount !== 4, 'Unsupported: delete expression with array')
      const [type, addr] = lvalue(node.lastNamedChild!, context, mem)
      asserts(typeof type === 'object' && type.type === 'pointer')
      const ptrAddress = mem.readScalar(addr, type) as number
      if (ptrAddress === NULL_ADDRESS)
        throw new NullPointerError(node)
      mem.free(ptrAddress)
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
