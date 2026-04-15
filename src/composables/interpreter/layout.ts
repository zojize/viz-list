import type { CppPrimitiveType, CppType } from './types'

export function alignUp(n: number, a: number): number {
  return (n + a - 1) & ~(a - 1)
}

export function sizeOfPrimitive(t: CppPrimitiveType): number {
  switch (t) {
    case 'char': case 'bool': return 1
    case 'int': case 'float': return 4
    case 'double': return 8
    case 'void': return 0
  }
}

export function sizeOf(t: CppType): number {
  if (typeof t === 'string')
    return sizeOfPrimitive(t)
  if (t.type === 'pointer')
    return 4
  // array and struct handled in Tasks 2 and 3
  throw new Error(`sizeOf: unsupported type ${JSON.stringify(t)}`)
}

export function alignOf(t: CppType): number {
  if (typeof t === 'string')
    return sizeOfPrimitive(t) || 1
  if (t.type === 'pointer')
    return 4
  throw new Error(`alignOf: unsupported type ${JSON.stringify(t)}`)
}
