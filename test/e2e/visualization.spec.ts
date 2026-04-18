import { expect, test } from '@playwright/test'

// Helper: click the step button N times, waiting for each step to complete
// by observing the data-step attribute (memory version) change on the button.
async function stepN(page: import('@playwright/test').Page, n: number) {
  const btn = page.getByTestId('btn-step')
  for (let i = 0; i < n; i++) {
    const before = Number(await btn.getAttribute('data-step')) || 0
    await btn.click()
    // Wait for version to increment (first step is slower due to init + parse)
    await expect(async () => {
      const after = Number(await btn.getAttribute('data-step')) || 0
      expect(after).toBeGreaterThan(before)
    }).toPass({ timeout: 10_000 })
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The Step button renders immediately, but tree-sitter WASM loads
  // asynchronously and the first click is a no-op until `tree` is populated.
  // `data-ready` flips to "true" once the parser has loaded and produced a
  // tree — wait on it deterministically instead of a fixed timeout.
  await expect(page.getByTestId('btn-step')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
})

test.describe('memory map', () => {
  test('shows stack variables after stepping', async ({ page }) => {
    await stepN(page, 3)

    const stackColumn = page.getByTestId('stack-column')
    await expect(stackColumn).toBeVisible()
    const entries = stackColumn.locator('[data-testid^="stack-entry-"]')
    await expect(entries.first()).toBeVisible()
  })

  test('shows heap allocations after new ListNode', async ({ page }) => {
    await stepN(page, 5)

    const heapColumn = page.getByTestId('heap-column')
    await expect(heapColumn).toBeVisible()
    const heapCells = heapColumn.locator('[data-testid^="heap-cell-"]')
    await expect(heapCells.first()).toBeVisible()
    await expect(heapCells.first()).toContainText('ListNode')
  })

  test('shows caller scope variables (not just current scope)', async ({ page }) => {
    // Step into insertBack — head from main should still be visible
    await stepN(page, 4)

    const stackColumn = page.getByTestId('stack-column')
    const stackText = await stackColumn.textContent()
    expect(stackText).toContain('head')
  })

  test('does not dim variables in if/while scopes (only caller)', async ({ page }) => {
    await stepN(page, 12)

    const stackColumn = page.getByTestId('stack-column')
    const currentEntries = stackColumn.locator('[data-testid^="stack-entry-"]:not(.opacity-40)')
    const count = await currentEntries.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

test.describe('data structure panel', () => {
  test('shows DS items after building list', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    await expect(dsView).toBeVisible()
    const items = dsView.locator('[data-testid^="ds-item-"]')
    await expect(items.first()).toBeVisible()
  })

  test('shows detail panel when clicking a DS item', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    // Click a struct item (contains "ListNode"), not a stack pointer
    const structItem = dsView.locator('[data-testid^="ds-item-"]').filter({ hasText: 'ListNode' }).first()
    await structItem.click()

    const fieldTable = page.getByTestId('field-table')
    await expect(fieldTable).toBeVisible()
    await expect(fieldTable).toContainText('data')
    await expect(fieldTable).toContainText('next')
  })

  test('close button hides detail panel', async ({ page }) => {
    await stepN(page, 15)

    const firstItem = page.getByTestId('ds-view').locator('[data-testid^="ds-item-"]').first()
    await firstItem.click()
    await expect(page.getByTestId('field-table')).toBeVisible()

    await page.getByTestId('detail-close').click({ force: true })

    await expect(page.getByTestId('field-table')).not.toBeVisible()
    await expect(page.getByTestId('ds-view')).toBeVisible()
  })
})

// Helper to select a template via dropdown
async function selectTemplate(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('template-picker').locator('button').first().click()
  await page.waitForTimeout(100)
  await page.getByTestId(`template-${name}`).click()
  await page.waitForTimeout(200)
}

test.describe('reverse algorithm visualization', () => {
  test.beforeEach(async ({ page }) => {
    await selectTemplate(page, 'singly-reverse')
  })

  test('shows DS items mid-reverse', async ({ page }) => {
    // Step through insertBack phase + into reverse
    await stepN(page, 62)

    const dsView = page.getByTestId('ds-view')
    await expect(dsView).toBeVisible()

    const items = dsView.locator('[data-testid^="ds-item-"]')
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('shows complete reversed list after completion', async ({ page }) => {
    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(20_000)

    const dsView = page.getByTestId('ds-view')
    const items = dsView.locator('[data-testid^="ds-item-"]')
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })
})

test.describe('viewport overflow', () => {
  test('page does not scroll beyond viewport after running reverse', async ({ page }) => {
    await selectTemplate(page, 'singly-reverse')

    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(20_000)

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    expect(bodyHeight).toBeLessThanOrEqual(viewportHeight + 1)
  })
})

test.describe('hover interactions', () => {
  test('hovering a DS item highlights the heap cell', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    // Target a heap struct item (contains "ListNode"), not a stack pointer
    const structItem = dsView.locator('[data-testid^="ds-item-"]').filter({ hasText: 'ListNode' }).first()

    const testId = await structItem.getAttribute('data-testid')
    const address = testId?.replace('ds-item-', '')

    await structItem.hover()
    await page.waitForTimeout(200)

    if (address) {
      const heapCell = page.getByTestId(`heap-cell-${address}`)
      const classes = await heapCell.getAttribute('class')
      expect(classes).toContain('border-l-blue-400')
    }
  })

  test('hovering a stack variable card highlights its declaration in Monaco', async ({ page }) => {
    await stepN(page, 5)

    await page.waitForSelector('.view-overlays', { state: 'attached' })

    const dataCard = page.locator('.cursor-pointer.border-l-3').filter({ hasText: 'data' }).filter({ hasText: 'int' }).first()
    await expect(dataCard).toBeVisible()

    await dataCard.hover()
    await page.waitForTimeout(200)

    const decoration = page.locator('.view-overlays .bg-cyan-500').first()
    await expect(decoration).toBeAttached()
  })
})

test.describe('pointer arrows', () => {
  // Skipped: kept as documentation for the "arrows stay at the previous view's
  // coordinates after a KeepAlive toggle" regression. getBoundingClientRect
  // isn't a Vue reactive dep, so ArrowOverlay's computed won't re-run on a
  // plain mode swap — the fix is a MutationObserver on the host that bumps
  // `tick` when the KeepAlive subtree changes. Re-enable if that regression
  // resurfaces.
  test.skip('arrows re-anchor to the active view after toggling Bytes/Allocations', async ({ page }) => {
    await selectTemplate(page, 'doubly-insertBack')
    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(3500)

    await page.getByRole('button', { name: 'Bytes' }).click()
    await page.waitForTimeout(300)
    const arrowsToggle = page.getByRole('button', { name: 'arrows' })
    await arrowsToggle.click()
    await page.waitForTimeout(300)

    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Allocations' }).click()
      await page.waitForTimeout(250)
      await page.getByRole('button', { name: 'Bytes' }).click()
      await page.waitForTimeout(250)
    }
    await page.getByRole('button', { name: 'Allocations' }).click()
    await page.waitForTimeout(400)

    const check = await page.evaluate(() => {
      const bezier = Array.from(document.querySelectorAll<SVGPathElement>('svg path'))
        .map(el => ({ el, d: el.getAttribute('d') ?? '' }))
        .filter(({ d }) => /^M[\d.]+\s[\d.]+\sQ/.test(d))
      if (bezier.length === 0)
        return { arrows: 0, bad: [] as { path: string, start: [number, number] }[] }

      const links = Array.from(document.querySelectorAll<HTMLElement>('[data-pointer-source]'))
        .filter(el => el.offsetParent !== null)
        .map(el => el.getBoundingClientRect())
      if (links.length === 0)
        return { arrows: bezier.length, bad: [{ path: '(no AddressLinks visible)', start: [0, 0] as [number, number] }] }

      const tol = 4
      const bad: { path: string, start: [number, number] }[] = []
      for (const { el, d } of bezier) {
        const m = d.match(/^M([\d.]+)\s([\d.]+)/)
        if (!m)
          continue
        const svg = el.closest('svg')!.getBoundingClientRect()
        const cx = svg.left + Number.parseFloat(m[1])
        const cy = svg.top + Number.parseFloat(m[2])
        const insideLink = links.some(r =>
          cx >= r.left - tol && cx <= r.right + tol
          && cy >= r.top - tol && cy <= r.bottom + tol,
        )
        if (!insideLink)
          bad.push({ path: d, start: [Math.round(cx), Math.round(cy)] })
      }
      return { arrows: bezier.length, bad }
    })

    expect(check.arrows).toBeGreaterThan(0)
    expect(check.bad, `${check.bad.length} arrow(s) do not start at any AddressLink: ${JSON.stringify(check.bad, null, 2)}`).toEqual([])
  })
})

test.describe('selection interactions', () => {
  test('clicking different DS items changes selection', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')

    const firstItem = dsView.locator('[data-testid^="ds-item-"]').first()
    await firstItem.click()
    const fieldTable = page.getByTestId('field-table')
    await expect(fieldTable).toBeVisible()
    const firstText = await fieldTable.textContent()

    const secondItem = dsView.locator('[data-testid^="ds-item-"]').nth(1)
    await secondItem.click()
    await expect(fieldTable).toBeVisible()
    const secondText = await fieldTable.textContent()
    expect(secondText).not.toBe(firstText)
  })

  test('selection clears when simulation starts', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    const firstItem = dsView.locator('[data-testid^="ds-item-"]').first()
    await firstItem.click()
    await expect(page.getByTestId('field-table')).toBeVisible()

    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('field-table')).not.toBeVisible()

    await page.getByTestId('btn-pause').click()
  })

  test('DS item gets selected outline on click', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    const firstItem = dsView.locator('[data-testid^="ds-item-"]').first()
    await firstItem.click()

    await expect(firstItem).toHaveClass(/outline/)
  })
})
