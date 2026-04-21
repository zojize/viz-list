import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// One integration test per template. Each runs the template to completion
// (at fastest simulation speed) and compares a structured view-state
// snapshot against the checked-in golden. On first run / after intentional
// changes, regenerate with:
//
//   bun run test:e2e -- --update-snapshots
//
// The snapshot captures "what the three views should show" (allocations,
// their byte contents, and the pointer graph) rather than pixels, so it's
// stable across font/zoom/animation drift and diffs cleanly in PRs.

const thisDir = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(thisDir, '..', '..', 'src', 'templates', 'general')

const templateNames = readdirSync(templatesDir)
  .filter(f => f.endsWith('.cpp'))
  .map(f => f.replace(/\.cpp$/, ''))
  // blank has no breakpoint + no allocations; nothing interesting to snapshot
  .filter(name => name !== 'blank')
  .sort()

interface VizSnapshot {
  endianness: 'le' | 'be'
  pausedAt: { line: number, text: string } | null
  allocations: Array<{ base: string, size: number, region: string, layout: string }>
  liveBytes: Record<string, string>
  pointerEdges: Array<{ source: string, target: string }>
}

test.describe.configure({ mode: 'parallel' })

for (const template of templateNames) {
  test(`${template}: views match golden snapshot`, async ({ page }) => {
    // Pre-seed localStorage so the app boots straight into this template at
    // fastest speed. useStorage treats strings as raw — no JSON.stringify.
    // Also wipe `code` so the default (template source) kicks in instead of
    // whatever previous session happened to leave there.
    await page.addInitScript(({ name }) => {
      localStorage.setItem('selected-template', name)
      localStorage.setItem('sim-speed', '50')
      localStorage.removeItem('code')
    }, { name: template })
    await page.goto('/')
    // tree-sitter WASM loads asynchronously; btn-step flips data-ready=true
    // once the parser is live. Without this the Run click is a no-op.
    await expect(page.getByTestId('btn-step')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })

    // Click Run and wait for the interpreter to pause at the breakpoint.
    // Tracks "was ever active" on window so we don't false-positive on the
    // pre-click isActive=false state.
    // Reset the "was ever running" latch so the waitForFunction below
    // doesn't short-circuit on the pre-click idle state.
    await page.evaluate(() => {
      const w = window as unknown as { __sawRunning: boolean }
      w.__sawRunning = false
    })
    await page.click('[data-testid="btn-run"]')
    await page.waitForFunction(() => {
      const w = window as unknown as { __viz?: { isRunning: () => boolean }, __sawRunning: boolean }
      if (!w.__viz)
        return false
      if (w.__viz.isRunning()) {
        w.__sawRunning = true
        return false
      }
      return w.__sawRunning === true
    }, null, { timeout: 45_000 })

    const snapshot = await page.evaluate(() => {
      const w = window as unknown as { __viz: { snapshot: () => VizSnapshot } }
      return w.__viz.snapshot()
    })
    const canonical = `${JSON.stringify(snapshot, null, 2)}\n`
    expect(canonical).toMatchSnapshot(`${template}.json`)
  })
}
