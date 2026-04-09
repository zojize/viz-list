import type { InjectionKey } from 'vue'
import type { InterpreterContext } from './interpreter/types'
import { inject, provide } from 'vue'

const key: InjectionKey<Readonly<InterpreterContext>> = Symbol('interpreter-context')

export function provideInterpreterContext(ctx: Readonly<InterpreterContext>) {
  provide(key, ctx)
}

export function useInterpreterContext(): Readonly<InterpreterContext> {
  const ctx = inject(key)
  if (!ctx)
    throw new Error('useInterpreterContext: no context provided. Call provideInterpreterContext in a parent component.')
  return ctx
}
