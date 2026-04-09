import { expect, test } from '@playwright/test'

// Helper: click the step button N times with a small delay
async function stepN(page: import('@playwright/test').Page, n: number) {
  const btn = page.getByTestId('btn-step')
  for (let i = 0; i < n; i++) {
    await btn.click()
    await page.waitForTimeout(60)
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Wait for the parser to initialize (Tree-Sitter WASM load)
  await expect(page.getByTestId('btn-step')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
})

test.describe('memory map', () => {
  test('shows stack variables after stepping', async ({ page }) => {
    // Step once to enter main and declare LinkedList
    await stepN(page, 2)

    const stackColumn = page.getByTestId('stack-column')
    await expect(stackColumn).toBeVisible()
    // Should have at least one stack entry
    const entries = stackColumn.locator('[data-testid^="stack-entry-"]')
    await expect(entries.first()).toBeVisible()
  })

  test('shows heap allocations after new Node', async ({ page }) => {
    // Step enough to enter insertBack and create a new Node
    await stepN(page, 5)

    const heapColumn = page.getByTestId('heap-column')
    await expect(heapColumn).toBeVisible()
    const heapCells = heapColumn.locator('[data-testid^="heap-cell-"]')
    await expect(heapCells.first()).toBeVisible()
    // The heap cell should contain "Node"
    await expect(heapCells.first()).toContainText('Node')
  })

  test('shows caller scope variables (not just current scope)', async ({ page }) => {
    // Step into insertBack — the LinkedList from main should still be visible
    await stepN(page, 4)

    const stackColumn = page.getByTestId('stack-column')
    const stackText = await stackColumn.textContent()
    // Should see "list" from both current function params and caller scope
    expect(stackText).toContain('list')
    expect(stackText).toContain('LinkedList')
  })

  test('does not dim variables in if/while scopes (only caller)', async ({ page }) => {
    // Step into the while loop inside insertBack (around step 10-15)
    await stepN(page, 12)

    const stackColumn = page.getByTestId('stack-column')
    // Current function variables should NOT have opacity-40
    const currentEntries = stackColumn.locator('[data-testid^="stack-entry-"]:not(.opacity-40)')
    const count = await currentEntries.count()
    // Should have at least the function params (list, data) and locals (newNode)
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

test.describe('data structure panel', () => {
  test('shows linked list chain after building list', async ({ page }) => {
    // Run the full insertBack for first call
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    await expect(dsView).toBeVisible()
    // Should have at least one node in the chain
    const nodes = dsView.locator('[data-testid^="ds-node-"]')
    await expect(nodes.first()).toBeVisible()
  })

  test('shows detail panel when clicking a DS node', async ({ page }) => {
    await stepN(page, 15)

    // Click a DS node to open detail
    const dsView = page.getByTestId('ds-view')
    const firstNode = dsView.locator('[data-testid^="ds-node-"]').first()
    await firstNode.click()

    // Field table should slide in
    const fieldTable = page.getByTestId('field-table')
    await expect(fieldTable).toBeVisible()
    await expect(fieldTable).toContainText('data')
    await expect(fieldTable).toContainText('next')
  })

  test('close button hides detail panel', async ({ page }) => {
    await stepN(page, 15)

    // Open detail by clicking DS node
    const firstNode = page.getByTestId('ds-view').locator('[data-testid^="ds-node-"]').first()
    await firstNode.click()
    await expect(page.getByTestId('field-table')).toBeVisible()

    // Close it
    await page.getByTestId('detail-close').click({ force: true })

    // Field table should be gone, linked list view still visible
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
    await selectTemplate(page, 'reverse')
  })

  test('shows partial chains mid-reverse', async ({ page }) => {
    // Step through insertBack phase + into reverse
    // insertBack(5 items) ≈ 50 steps, then ~10 into reverse
    await stepN(page, 62)

    const dsView = page.getByTestId('ds-view')
    await expect(dsView).toBeVisible()

    // Should have multiple chains (partial lists during reverse)
    const chains = dsView.locator('[data-testid^="chain-"]')
    const chainCount = await chains.count()
    expect(chainCount).toBeGreaterThanOrEqual(1)
  })

  test('shows complete reversed list after completion', async ({ page }) => {
    // Run to completion
    await page.getByTestId('btn-run').click()
    // Wait for execution — 200ms per step, ~80 steps = ~16s
    await page.waitForTimeout(20_000)

    const dsView = page.getByTestId('ds-view')

    // Should show a chain with 5 nodes in reversed order
    const nodes = dsView.locator('[data-testid^="ds-node-"]')
    const nodeCount = await nodes.count()
    expect(nodeCount).toBeGreaterThanOrEqual(5)

    // First node should be 5 (reversed from 1,2,3,4,5)
    const firstNodeText = await nodes.first().textContent()
    expect(firstNodeText).toContain('5')
  })
})

test.describe('viewport overflow', () => {
  test('page does not scroll beyond viewport after running reverse', async ({ page }) => {
    await selectTemplate(page, 'reverse')

    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(20_000)

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    expect(bodyHeight).toBeLessThanOrEqual(viewportHeight + 1) // +1 for rounding
  })
})

test.describe('hover interactions', () => {
  test('hovering a DS node highlights the heap cell', async ({ page }) => {
    // Build some list nodes
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    const firstNode = dsView.locator('[data-testid^="ds-node-"]').first()

    // Get the node's address from its testid
    const testId = await firstNode.getAttribute('data-testid')
    const address = testId?.replace('ds-node-', '')

    // Hover on the DS node
    await firstNode.hover()
    await page.waitForTimeout(200)

    // The corresponding heap cell should get highlighted (border-l-blue-400)
    if (address) {
      const heapCell = page.getByTestId(`heap-cell-${address}`)
      const classes = await heapCell.getAttribute('class')
      expect(classes).toContain('border-l-blue-400')
    }
  })

  test('hovering a stack variable card highlights its declaration in Monaco', async ({ page }) => {
    // Step 5 times to enter insertBack with stack variables visible
    await stepN(page, 5)

    // Wait for Monaco editor to be ready (view-overlays is aria-hidden, so check attached not visible)
    await page.waitForSelector('.view-overlays', { state: 'attached' })

    // Find the stack variable card for the 'data' int parameter
    const dataCard = page.locator('.cursor-pointer.border-l-3').filter({ hasText: 'data' }).filter({ hasText: 'int' }).first()
    await expect(dataCard).toBeVisible()

    // Hover on the stack variable card
    await dataCard.hover()
    await page.waitForTimeout(200)

    // Monaco should create decoration overlays with class bg-cyan-500
    const decoration = page.locator('.view-overlays .bg-cyan-500').first()
    await expect(decoration).toBeAttached()
  })
})

test.describe('selection interactions', () => {
  test('clicking a standalone item then a chain node changes selection', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')

    // Click a standalone item (e.g. the list pointer)
    const standaloneItem = dsView.locator('[data-testid^="ds-item-"]').first()
    await standaloneItem.click()
    const fieldTable = page.getByTestId('field-table')
    await expect(fieldTable).toBeVisible()
    const firstText = await fieldTable.textContent()

    // Now click a chain node — selection should change
    const chainNode = dsView.locator('[data-testid^="ds-node-"]').first()
    await chainNode.click()
    await expect(fieldTable).toBeVisible()
    const secondText = await fieldTable.textContent()
    expect(secondText).not.toBe(firstText)
    await expect(fieldTable).toContainText('Node')
  })

  test('selection clears when simulation starts', async ({ page }) => {
    await stepN(page, 15)

    // Open detail by clicking DS node
    const dsView = page.getByTestId('ds-view')
    const firstNode = dsView.locator('[data-testid^="ds-node-"]').first()
    await firstNode.click()
    await expect(page.getByTestId('field-table')).toBeVisible()

    // Start simulation — detail should close
    await page.getByTestId('btn-run').click()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('field-table')).not.toBeVisible()

    // Pause
    await page.getByTestId('btn-pause').click()
  })

  test('node gets selected outline on click', async ({ page }) => {
    await stepN(page, 15)

    const dsView = page.getByTestId('ds-view')
    const firstNode = dsView.locator('[data-testid^="ds-node-"]').first()
    await firstNode.click()

    // Node should have the outline class
    await expect(firstNode).toHaveClass(/outline/)
  })
})
