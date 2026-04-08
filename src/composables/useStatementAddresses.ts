import type { Ref } from 'vue'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { InterpreterContext } from '~/composables/interpreter/types'
import { computed } from 'vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

/**
 * Extracts memory addresses involved in the current interpreter statement.
 * Returns LHS (write target) and RHS (read source) address sets.
 */
export function useStatementAddresses(
  context: Readonly<InterpreterContext>,
  isActive: Ref<boolean>,
) {
  const lhsAddresses = computed(() => {
    if (!isActive.value || !context.currentNode)
      return new Set<number>()
    return resolveAddresses(context.currentNode, context, 'lhs')
  })

  const rhsAddresses = computed(() => {
    if (!isActive.value || !context.currentNode)
      return new Set<number>()
    return resolveAddresses(context.currentNode, context, 'rhs')
  })

  return { lhsAddresses, rhsAddresses }
}

function resolveAddresses(
  node: SyntaxNode,
  context: Readonly<InterpreterContext>,
  side: 'lhs' | 'rhs' | 'all',
): Set<number> {
  const addrs = new Set<number>()

  switch (node.type) {
    case 'expression_statement': {
      const expr = node.firstNamedChild
      if (expr)
        return resolveAddresses(expr, context, side)
      break
    }
    case 'assignment_expression': {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (side === 'lhs' || side === 'all') {
        if (left)
          collectIdentifierAddresses(left, context, addrs)
      }
      if (side === 'rhs' || side === 'all') {
        if (right)
          collectIdentifierAddresses(right, context, addrs)
      }
      return addrs
    }
    case 'declaration': {
      const declarator = node.childForFieldName('declarator')
      if (declarator) {
        // The declared variable is the LHS
        if (side === 'lhs' || side === 'all') {
          const name = extractDeclaratorName(declarator)
          if (name)
            resolveVarAddress(name, context, addrs)
        }
        // The initializer (if any) is the RHS
        if (side === 'rhs' || side === 'all') {
          const initDecl = declarator.type === 'init_declarator' ? declarator.childForFieldName('value') : null
          if (initDecl)
            collectIdentifierAddresses(initDecl, context, addrs)
        }
      }
      return addrs
    }
    case 'return_statement': {
      if (side === 'rhs' || side === 'all') {
        const expr = node.firstNamedChild
        if (expr)
          collectIdentifierAddresses(expr, context, addrs)
      }
      return addrs
    }
    default: {
      // For other statement types (if condition, while condition), treat everything as RHS
      if (side === 'rhs' || side === 'all')
        collectIdentifierAddresses(node, context, addrs)
      return addrs
    }
  }

  return addrs
}

function extractDeclaratorName(node: SyntaxNode): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text
    case 'init_declarator':
      return extractDeclaratorName(node.childForFieldName('declarator')!)
    case 'pointer_declarator':
      return extractDeclaratorName(node.childForFieldName('declarator')!)
    default:
      return null
  }
}

/**
 * Walk an expression AST node and collect addresses of all referenced variables.
 * Handles: identifiers, field_expression (->), pointer_expression (*), call args.
 */
function collectIdentifierAddresses(
  node: SyntaxNode,
  context: Readonly<InterpreterContext>,
  addrs: Set<number>,
) {
  switch (node.type) {
    case 'identifier':
      resolveVarAddress(node.text, context, addrs)
      break
    case 'field_expression': {
      // For `node->field` or `node.field`, resolve the base object AND the field
      const arg = node.childForFieldName('argument')
      if (arg)
        collectIdentifierAddresses(arg, context, addrs)
      // Also resolve the specific field address
      resolveFieldAddress(node, context, addrs)
      break
    }
    case 'pointer_expression':
    case 'unary_expression':
    case 'update_expression':
    case 'parenthesized_expression': {
      const child = node.firstNamedChild
      if (child)
        collectIdentifierAddresses(child, context, addrs)
      break
    }
    case 'binary_expression':
    case 'assignment_expression': {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left)
        collectIdentifierAddresses(left, context, addrs)
      if (right)
        collectIdentifierAddresses(right, context, addrs)
      break
    }
    case 'call_expression': {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren)
          collectIdentifierAddresses(arg, context, addrs)
      }
      break
    }
    case 'conditional_expression': {
      const cond = node.childForFieldName('condition')
      const cons = node.childForFieldName('consequence')
      const alt = node.childForFieldName('alternative')
      if (cond)
        collectIdentifierAddresses(cond, context, addrs)
      if (cons)
        collectIdentifierAddresses(cons, context, addrs)
      if (alt)
        collectIdentifierAddresses(alt, context, addrs)
      break
    }
    case 'condition_clause': {
      const val = node.childForFieldName('value')
      if (val)
        collectIdentifierAddresses(val, context, addrs)
      break
    }
    default:
      // Recurse into named children for other node types
      for (const child of node.namedChildren)
        collectIdentifierAddresses(child, context, addrs)
  }
}

function resolveVarAddress(name: string, context: Readonly<InterpreterContext>, addrs: Set<number>) {
  // Search envStack (current function scopes)
  for (let i = context.envStack.length - 1; i >= 0; i--) {
    const env = context.envStack[i]
    if (name in env) {
      addrs.add(env[name].address)
      return
    }
  }
  // Search globals
  if (name in context.globalEnv) {
    addrs.add(context.globalEnv[name].address)
  }
}

/**
 * For field_expression like `node->data` or `node.field`, resolve the actual
 * field cell address by looking up the struct's base in memory.
 */
function resolveFieldAddress(node: SyntaxNode, context: Readonly<InterpreterContext>, addrs: Set<number>) {
  const operator = node.childForFieldName('operator')
  const fieldName = node.childForFieldName('field')?.text
  const argument = node.childForFieldName('argument')
  if (!operator || !fieldName || !argument)
    return

  // Resolve the base variable to get a pointer or struct
  const varName = extractBaseIdentifier(argument)
  if (!varName)
    return

  let varAddr: number | undefined
  for (let i = context.envStack.length - 1; i >= 0; i--) {
    if (varName in context.envStack[i]) {
      varAddr = context.envStack[i][varName].address
      break
    }
  }
  if (varAddr === undefined && varName in context.globalEnv)
    varAddr = context.globalEnv[varName].address

  if (varAddr === undefined)
    return

  const cell = context.memory.cells.get(varAddr)
  if (!cell)
    return

  if (operator.text === '->') {
    // Pointer dereference: cell value should be a pointer
    const val = cell.value
    if (typeof val !== 'object' || val.type !== 'pointer' || val.address === NULL_ADDRESS)
      return
    const targetCell = context.memory.cells.get(val.address)
    if (!targetCell || typeof targetCell.value !== 'object' || targetCell.value.type !== 'struct')
      return
    // Resolve field within the struct
    const structDef = context.structs[targetCell.value.name]
    if (!structDef)
      return
    const fieldIdx = Object.keys(structDef).indexOf(fieldName)
    if (fieldIdx >= 0) {
      addrs.add(targetCell.value.base + 1 + fieldIdx)
      addrs.add(val.address) // Also highlight the struct itself
    }
  }
  else if (operator.text === '.') {
    // Direct struct access
    if (typeof cell.value !== 'object' || cell.value.type !== 'struct')
      return
    const structDef = context.structs[cell.value.name]
    if (!structDef)
      return
    const fieldIdx = Object.keys(structDef).indexOf(fieldName)
    if (fieldIdx >= 0)
      addrs.add(cell.value.base + 1 + fieldIdx)
  }
}

function extractBaseIdentifier(node: SyntaxNode): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text
    case 'pointer_expression':
    case 'parenthesized_expression':
      return node.firstNamedChild ? extractBaseIdentifier(node.firstNamedChild) : null
    case 'field_expression':
      return node.childForFieldName('argument') ? extractBaseIdentifier(node.childForFieldName('argument')!) : null
    default:
      return null
  }
}
