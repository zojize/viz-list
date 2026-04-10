import type { Ref } from 'vue'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// eslint-disable-next-line unused-imports/no-unused-vars
const CppPrimitiveTypes = ['int', 'float', 'double', 'char', 'bool', 'void'] as const
export type CppPrimitiveType = (typeof CppPrimitiveTypes)[number]

export type CppType
  = | CppPrimitiveType
    | { type: 'pointer', to: CppType }
    | { type: 'array', of: CppType, size: number }
    | { type: 'struct', name: string }

export const NULL_ADDRESS = 0

export type CppValue
  = | number
    | boolean
    | { type: 'pointer', address: number }
    | { type: 'array', base: number, length: number }
    | { type: 'struct', name: string, base: number }

export type MemoryRegion = 'global' | 'stack' | 'heap'

export interface MemoryCell {
  address: number
  type: CppType
  value: CppValue
  region: MemoryRegion
  dead: boolean
}

/** Stack grows up from 1, heap grows down from MEMORY_SIZE-1. */
export const MEMORY_SIZE = 4096

export interface AddressSpace {
  cells: Map<number, MemoryCell>
  /** Next stack/global address (grows upward from 1) */
  stackTop: number
  /** Bumped after each step to invalidate reactive cell reads */
  version: number
  /** Next heap address (grows downward from MEMORY_SIZE-1) */
  heapBottom: number
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

export interface FieldMeta {
  direction: FieldDirection
}

export interface InterpreterContext {
  structs: Record<string, Record<string, CppType>>
  /** Per-field metadata parsed from JSDoc annotations (e.g. `@position right`) */
  structFieldMeta: Record<string, Record<string, FieldMeta>>
  functions: Record<string, FunctionDef>
  globalEnv: Record<string, EnvEntry>
  envStack: Record<string, EnvEntry>[]
  callStack: { env: Record<string, EnvEntry>[] }[]
  memory: AddressSpace
  currentNode?: SyntaxNode
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
