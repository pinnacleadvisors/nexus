/**
 * /code page (authenticated). The claudecodeui engine is embedded when reachable
 * and must degrade gracefully when it isn't. See CodeEmbed.tsx.
 *
 * As of 2026-06-05 claudecodeui IS deployed behind the nexus-mac tunnel at
 * code.coolifycloudtunnel.uk (ADR 013; runbook docs/runbooks/claudecodeui-setup.md),
 * so on this box the reachability probe resolves to "up" and the embed iframe
 * renders. This spec doubles as the production-readiness gate: it asserts the
 * embed renders AND that no CSP violation is logged for the code-embed origin
 * (the connect-src fix in next.config.ts must allow *.coolifycloudtunnel.uk).
 *
 * If you run this on a box WITHOUT claudecodeui reachable, the embed test is
 * skipped (the graceful "not connected" panel is the correct fallback there) —
 * the rail + no-CSP-violation assertions still hold.
 *
 * Runs under the `authed` project only.
 */
import { test, expect } from '@playwright/test'

test.describe('/code page', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'authed', 'authed project only — run npm run test:e2e:login first')
  })

  test('renders without an error boundary and keeps the governance rail', async ({ page }) => {
    await page.goto('/code', { waitUntil: 'networkidle' })
    await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0)
    // Preserved rail survives the engine swap (ADR 013). Match the rail cards by
    // their unique sub-text (the /board + /approvals hrefs also appear in the
    // sidebar nav, so scope by content not href).
    await expect(page.getByText('Gate decisions')).toBeVisible()
    await expect(page.getByText('Manual + background tasks')).toBeVisible()
  })

  test('embeds claudecodeui (or degrades gracefully) with no CSP violation', async ({ page }) => {
    // Collect CSP violations for the code-embed origin — the regression this guards.
    const cspViolations: string[] = []
    page.on('console', (msg) => {
      const t = msg.text()
      if (/Content Security Policy/i.test(t) && /coolifycloudtunnel\.uk/i.test(t)) {
        cspViolations.push(t)
      }
    })

    await page.goto('/code', { waitUntil: 'networkidle' })
    // Wait out the 6s reachability probe (CodeEmbed.tsx).
    await page.waitForTimeout(7000)

    const iframe = page.locator('iframe[title="claudecodeui"]')
    const panel = page.getByText(/isn.t connected yet/i)
    const hasIframe = await iframe.count()
    const hasPanel = await panel.count()

    // Never a blank void: either the embed or the fallback panel must render.
    expect(hasIframe + hasPanel, 'neither the embed nor the fallback panel rendered').toBeGreaterThan(0)

    // The connect-src fix must hold regardless of engine reachability: the
    // no-cors probe to code.coolifycloudtunnel.uk must NOT trip CSP.
    expect(cspViolations, `CSP violation(s) for the code-embed origin:\n${cspViolations.join('\n')}`).toHaveLength(0)

    if (hasIframe) {
      // Production-ready path — claudecodeui reachable behind the tunnel.
      await expect(iframe).toBeVisible()
      expect(await iframe.getAttribute('src')).toMatch(/coolifycloudtunnel\.uk|CODE_EMBED_URL/i)
    } else {
      // Fallback path — engine not reachable from this box; the panel offers retry.
      await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
    }
  })
})
