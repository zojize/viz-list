import type { CppPrimitiveType, CppType } from './types'

export function alignUp(n: number, a: number): number {
  return (n + a - 1) & ~(a - 1)
}

function sizeOfPrimitive(t: CppPrimitiveType): number {
  switch (t) {
    case 'char': case 'bool': return 1
    case 'int': case 'float': return 4
    case 'double': return 8
    case 'void': return 0
  }
}

export interface LayoutField {
  name: string
  node: LayoutNode
  offset: number
}

export type LayoutNode
  = | { kind: 'scalar', type: CppPrimitiveType | { type: 'pointer', to: CppType }, size: number }
    | { kind: 'struct', structName: string, size: number, fields: LayoutField[] }
    | { kind: 'array', element: LayoutNode, length: number, stride: number, size: number }

// Resolver pattern breaks recursion for self-referential structs:
// callers pass a function that resolves (structName) -> layout (looking up a cache).
// Layout computation never calls this for pointer fields — only for inline struct/array fields.
type StructResolver = (structName: string) => LayoutNode

function layoutOfType(t: CppType, resolve: StructResolver): LayoutNode {
  if (typeof t === 'string') {
    return { kind: 'scalar', type: t, size: sizeOfPrimitive(t) }
  }
  if (t.type === 'pointer') {
    return { kind: 'scalar', type: t, size: 4 }
  }
  if (t.type === 'array') {
    return computeArrayLayout(t.of, t.size, resolve)
  }
  // inline struct field
  return resolve(t.name)
}

export function computeStructLayout(
  structName: string,
  fieldDefs: Record<string, CppType>,
  resolve: StructResolver,
): Extract<LayoutNode, { kind: 'struct' }> {
  let offset = 0
  let maxAlign = 1
  const fields: LayoutField[] = []

  for (const [name, type] of Object.entries(fieldDefs)) {
    const a = alignOfType(type, resolve)
    offset = alignUp(offset, a)
    const node = layoutOfType(type, resolve)
    fields.push({ name, node, offset })
    offset += node.size
    if (a > maxAlign)
      maxAlign = a
  }

  const size = fields.length === 0 ? 0 : alignUp(offset, maxAlign)
  return { kind: 'struct', structName, size, fields }
}

function alignOfType(t: CppType, resolve: StructResolver): number {
  if (typeof t === 'string')
    return sizeOfPrimitive(t) || 1
  if (t.type === 'pointer')
    return 4
  if (t.type === 'array')
    return alignOfType(t.of, resolve)
  const n = resolve(t.name)
  return n.size === 0 ? 1 : alignOfNode(n)
}

function alignOfNode(n: LayoutNode): number {
  if (n.kind === 'scalar') {
    if (typeof n.type === 'string')
      return sizeOfPrimitive(n.type) || 1
    return 4
  }
  if (n.kind === 'array')
    return alignOfNode(n.element)
  // struct: max align of its fields, or 1 if empty
  let a = 1
  for (const f of n.fields) {
    const fa = alignOfNode(f.node)
    if (fa > a)
      a = fa
  }
  return a
}

export function computeArrayLayout(
  elementType: CppType,
  length: number,
  resolve: StructResolver,
): Extract<LayoutNode, { kind: 'array' }> {
  const element = layoutOfType(elementType, resolve)
  const elementAlign = alignOfNode(element)
  const stride = alignUp(element.size, elementAlign)
  return { kind: 'array', element, length, stride, size: stride * length }
}

export function sizeOf(t: CppType, resolve?: StructResolver): number {
  if (typeof t === 'string')
    return sizeOfPrimitive(t)
  if (t.type === 'pointer')
    return 4
  if (t.type === 'array') {
    const elemSize = sizeOf(t.of, resolve)
    const elemAlign = alignOf(t.of, resolve)
    // Stride matches computeArrayLayout — keep in sync when updating either.
    return alignUp(elemSize, elemAlign) * t.size
  }
  if (t.type === 'struct') {
    if (!resolve)
      throw new Error(`sizeOf(struct ${t.name}) needs a resolver`)
    return resolve(t.name).size
  }
  throw new Error(`sizeOf: unsupported ${JSON.stringify(t)}`)
}

export function alignOf(t: CppType, resolve?: StructResolver): number {
  if (typeof t === 'string')
    return sizeOfPrimitive(t) || 1
  if (t.type === 'pointer')
    return 4
  if (t.type === 'array')
    return alignOf(t.of, resolve)
  if (t.type === 'struct') {
    if (!resolve)
      throw new Error(`alignOf(struct ${t.name}) needs a resolver`)
    return alignOfNode(resolve(t.name))
  }
  throw new Error(`alignOf: unsupported ${JSON.stringify(t)}`)
}
