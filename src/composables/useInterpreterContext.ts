import type { InjectionKey } from 'vue'
import type { InterpreterContext } from './interpreter/types'
import { inject, provide } from 'vue'

const key: InjectionKey<Readonly<InterpreterContext>> = Symbol('interpreter-context')
const setEndiannessKey: InjectionKey<(e: 'le' | 'be') => void> = Symbol('set-endianness')

export function provideInterpreterContext(
  ctx: Readonly<InterpreterContext>,
  setEndianness: (e: 'le' | 'be') => void,
) {
  provide(key, ctx)
  provide(setEndiannessKey, setEndianness)
}

export function useInterpreterContext(): Readonly<InterpreterContext> {
  const ctx = inject(key)
  if (!ctx)
    throw new Error('useInterpreterContext: no context provided. Call provideInterpreterContext in a parent component.')
  return ctx
}

export function useSetEndianness(): (e: 'le' | 'be') => void {
  const set = inject(setEndiannessKey)
  if (!set)
    throw new Error('useSetEndianness: no setter provided. Call provideInterpreterContext in a parent component.')
  return set
}
