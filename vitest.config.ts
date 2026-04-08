import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['test/basic.test.ts', 'test/e2e/**', 'node_modules/**'],
  },
})
