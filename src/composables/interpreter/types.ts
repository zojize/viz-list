import type { Ref } from 'vue'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { LayoutNode } from './layout'
// NOTE: import type (erased at runtime) avoids a circular value-level import;
// MemoryManager is only referenced in the InterpreterContext type.
import type { MemoryManager } from './memory'

// eslint-disable-next-line unused-imports/no-unused-vars
const CppPrimitiveTypes = ['int', 'float', 'double', 'char', 'bool', 'void'] as const
export type CppPrimitiveType = (typeof CppPrimitiveTypes)[number]

export interface PointerType { type: 'pointer', to: CppType }

export type CppType
  = | CppPrimitiveType
    | PointerType
    | { type: 'array', of: CppType, size: number }
    | { type: 'struct', name: string }

export const NULL_ADDRESS = 0

/**
 * Transient carry type for expression evaluation.
 *  Storage representation is always bytes in AddressSpace.buffer.
 */
export type CppValue
  = | number
    | boolean
    | { type: 'pointer', address: number }
    | { type: 'array', base: number, length: number, elementType: CppType }
    | { type: 'struct', name: string, base: number }

export type MemoryRegion = 'global' | 'stack' | 'heap'

export interface Allocation {
  base: number
  size: number
  region: MemoryRegion
  dead: boolean
  layout: LayoutNode
}

/** Stack grows up from 1, heap grows down from MEMORY_SIZE. */
export const MEMORY_SIZE = 16384

export interface AddressSpace {
  buffer: Uint8Array
  view: DataView
  allocations: Map<number, Allocation>
  /** Next stack/global address (grows upward from 1) */
  stackTop: number
  /** Next heap address (grows downward from MEMORY_SIZE) */
  heapBottom: number
  /** Bumped after each write to invalidate reactive reads */
  version: number
}

export interface EnvEntry {
  type: CppType
  address: number
}

export interface FunctionDef {
  returnType: CppType
  params: { name: string, type: CppType }[]
  body: SyntaxNode
}

export type FieldDirection = 'right' | 'left' | 'dynamic'
export type ArrowStyle = 'bezier' | 'straight' | 'horizontal' | 'orthogonal'
export type ArrowAnchor = 'center' | 'closest'

export interface FieldMeta {
  direction: FieldDirection
  color?: string
  style?: ArrowStyle
  fallbackStyle?: ArrowStyle
}

export interface StructMeta {
  arrowAnchor?: ArrowAnchor
  arrowSize?: number
}

export interface InterpreterContext {
  structs: Record<string, Record<string, CppType>>
  /** Per-struct cached layout (added in this refactor) */
  structLayouts: Record<string, LayoutNode>
  /** Per-field metadata parsed from JSDoc annotations */
  structFieldMeta: Record<string, Record<string, FieldMeta>>
  /** Per-struct metadata parsed from JSDoc annotations */
  structMeta: Record<string, StructMeta>
  functions: Record<string, FunctionDef>
  globalEnv: Record<string, EnvEntry>
  envStack: Record<string, EnvEntry>[]
  callStack: { env: Record<string, EnvEntry>[] }[]
  /** The full MemoryManager — call .findAllocation(), .readScalar(), .space.version etc. */
  memory: MemoryManager
  currentNode?: SyntaxNode
  /** Set by breakpoint() builtin — signals play mode to pause */
  hitBreakpoint?: boolean
}

export interface UseCppInterpreterReturn {
  init: () => void
  step: () => boolean
  reset: () => void
  isActive: Readonly<Ref<boolean>>
  context: Readonly<InterpreterContext>
}

export class InterpreterError extends Error {
  constructor(
    message: string,
    public node?: SyntaxNode,
    public kind: 'runtime' | 'unsupported' | 'type' = 'runtime',
  ) {
    super(message)
    this.name = 'InterpreterError'
  }
}

export class NullPointerError extends InterpreterError {
  constructor(node?: SyntaxNode) {
    super('Null pointer dereference', node, 'runtime')
    this.name = 'NullPointerError'
  }
}

export class UseAfterFreeError extends InterpreterError {
  constructor(address: number, node?: SyntaxNode) {
    super(`Use after free: address ${address}`, node, 'runtime')
    this.name = 'UseAfterFreeError'
  }
}

export class StackOverflowError extends InterpreterError {
  constructor(message: string, node?: SyntaxNode) {
    super(message, node, 'runtime')
    this.name = 'StackOverflowError'
  }
}

export class UnsupportedError extends InterpreterError {
  constructor(feature: string, node?: SyntaxNode) {
    super(`Unsupported: ${feature}`, node, 'unsupported')
    this.name = 'UnsupportedError'
  }
}
