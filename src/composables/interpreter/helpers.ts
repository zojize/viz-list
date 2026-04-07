import type { CppType, CppValue } from './types'
import { NULL_ADDRESS } from './types'

export function asserts(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}

export function checksDefined<T>(value: T | undefined): T {
  asserts(value !== undefined)
  return value
}

export function getGeneratorReturn<T>(gen: Generator<any, T>): T {
  let ret = gen.next()
  while (!ret.done)
    ret = gen.next()
  return ret.value
}

export function isTruthy(value: CppValue | null): boolean {
  if (value === null || value === undefined)
    return false
  switch (typeof value) {
    case 'number':
      return value !== 0
    case 'boolean':
      return value
    case 'object':
      switch (value.type) {
        case 'pointer':
          return value.address !== NULL_ADDRESS
        case 'array':
          return true
        case 'struct':
          return true
      }
  }
}

export function castIfNull(type: CppType, value: CppValue | null): CppValue {
  if (value != null)
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
    default:
      switch (type.type) {
        case 'pointer':
          return { type: 'pointer', address: NULL_ADDRESS }
        default:
          throw new Error(`Cannot assign null to type: ${JSON.stringify(type)}`)
      }
  }
}
