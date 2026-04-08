import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['test/basic.test.ts', 'test/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/composables/interpreter/**'],
      exclude: ['src/composables/interpreter/index.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
})
