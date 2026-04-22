import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  retries: 1,
  // Our snapshots are pure JSON extracted from a deterministic interpreter;
  // strip Playwright's default OS suffix so Darwin and Linux goldens match
  // and one checked-in file covers every CI runner.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:3333/StructViz/',
    headless: true,
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3333/StructViz/',
    // eslint-disable-next-line node/prefer-global/process
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
