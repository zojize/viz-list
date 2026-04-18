import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { provideHoverHighlight, useHoverHighlight } from '../../src/composables/useHoverHighlight'

function runInApp<T>(fn: () => T): T {
  let captured!: T
  const Child = defineComponent({
    setup() {
      captured = fn()
      return () => null
    },
  })
  const Parent = defineComponent({
    setup() {
      provideHoverHighlight()
      return () => h(Child)
    },
  })
  const app = createApp(Parent)
  app.mount(document.createElement('div'))
  return captured
}

describe('useHoverHighlight', () => {
  it('starts null', () => {
    const s = runInApp(() => useHoverHighlight())
    expect(s.address.value).toBe(null)
    expect(s.fieldAddress.value).toBe(null)
    expect(s.source.value).toBe(null)
  })

  it('setHover records address and source together', () => {
    const s = runInApp(() => useHoverHighlight())
    s.setHover(42, 'stack')
    expect(s.address.value).toBe(42)
    expect(s.source.value).toBe('stack')
  })

  it('setHover(null, null) clears both', () => {
    const s = runInApp(() => useHoverHighlight())
    s.setHover(42, 'stack')
    s.setHover(null, null)
    expect(s.address.value).toBe(null)
    expect(s.source.value).toBe(null)
  })

  it('setField does not affect address/source', () => {
    const s = runInApp(() => useHoverHighlight())
    s.setHover(10, 'stack')
    s.setField(20)
    expect(s.address.value).toBe(10)
    expect(s.source.value).toBe('stack')
    expect(s.fieldAddress.value).toBe(20)
  })

  it('clear() resets everything', () => {
    const s = runInApp(() => useHoverHighlight())
    s.setHover(10, 'heap')
    s.setField(20)
    s.clear()
    expect(s.address.value).toBe(null)
    expect(s.fieldAddress.value).toBe(null)
    expect(s.source.value).toBe(null)
  })

  it('throws if used without provider', () => {
    expect(() => useHoverHighlight()).toThrow(/provideHoverHighlight/)
  })
})
