import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3333/structviz/',
    headless: true,
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3333/structviz/',
    // eslint-disable-next-line node/prefer-global/process
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
