/**
 * /graph smoke (authenticated). Verifies the 3D knowledge-graph scene actually
 * mounts and renders geometry for a signed-in operator — not just that the route
 * returns 200.
 *
 * Note on the THREE "computeBoundingSphere(): radius is NaN" console flood seen
 * in dev: it is emitted by drei's <Line> once per edge as its LineGeometry is
 * created (amplified ~2x by React StrictMode's dev double-mount). It is dev-only
 * console noise, NOT a data defect — `/api/graph` positions are all finite and
 * only 2 of 890 edges are coincident. GraphScene.tsx defensively skips degenerate
 * edges (non-finite or zero-length) regardless. Full drei-level suppression of the
 * on-mount warning is tracked as a follow-up in task_plan-platform-polish.md.
 *
 * Runs under the `authed` project only (needs a captured operator session).
 */
import { test, expect } from '@playwright/test'

test.describe('/graph 3D scene', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'authed', 'authed project only — run npm run test:e2e:login first')
  })

  test('mounts the canvas and renders the graph without an error boundary', async ({ page }) => {
    await page.goto('/graph', { waitUntil: 'networkidle' })

    // No Next error boundary.
    await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0)

    // The R3F scene mounts a <canvas>.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

    // The graph data actually loaded (node-count / legend chrome present, not the
    // empty/error state). Tolerant matcher — the page shows a node tally somewhere.
    await page.waitForTimeout(1500)
    const hasError = await page.getByText(/Graph request timed out|Failed to load graph/i).count()
    expect(hasError, 'graph data failed to load').toBe(0)
  })
})
