import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['test/basic.test.ts', 'node_modules/**'],
  },
})
