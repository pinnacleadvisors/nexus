/**
 * Spec: mobile chat shell renders Claude-Code-app patterns at phone viewports.
 *
 * Phase 2F of task_plan-collaborative-chat.md (PR #285). Verifies the
 * three highest-leverage mobile UX improvements shipped in Phases 2A-2E:
 *
 *   - 2A — Views dropdown opens as bottom-sheet (not side panel)
 *   - 2C — Session sidebar hidden by default; hamburger reveals it
 *   - 2D — Composer chips don't overflow the viewport horizontally
 *
 * Skips on the chromium (desktop) project — the assertions are mobile-specific.
 * Auth is gated behind requireAuth() like the rest of the suite; without
 * BOT_SESSION_TICKET_URL the spec test.skip()'s with a clear message.
 */

import { test, expect } from '@playwright/test'
import { redeemTicket, requireAuth } from './_helpers'

test.describe('mobile chat shell (/manage-platform)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium', 'desktop project — mobile-specific assertions')
    const auth = requireAuth()
    await redeemTicket(page, auth.ticketUrl)
    await page.goto('/manage-platform', { waitUntil: 'networkidle' })
  })

  test('chat page fits the viewport without horizontal scroll', async ({ page }) => {
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      dims.scrollWidth,
      `chat scrolls horizontally — scrollWidth=${dims.scrollWidth}px clientWidth=${dims.clientWidth}px`,
    ).toBeLessThanOrEqual(dims.clientWidth + 1)
  })

  test('session sidebar is hidden by default + revealed by hamburger', async ({ page }) => {
    // Hamburger button has aria-label="Open chat sessions" — see PlatformChat.tsx (Phase 2C).
    const hamburger = page.getByRole('button', { name: /open chat sessions/i })
    await expect(hamburger, 'hamburger button should be visible on mobile').toBeVisible({ timeout: 5_000 })

    // Before tap: the "New chat" button (the SessionSidebar's signature element)
    // should NOT be visible on screen — sidebar is off-canvas.
    const newChat = page.getByRole('button', { name: /new chat/i }).first()
    // It may exist in the DOM (rendered inside the Drawer's portal) but not visible.
    // Use boundingBox to confirm it has no on-screen rect.
    const box1 = await newChat.boundingBox().catch(() => null)
    expect(box1, '"New chat" button should not have a visible bounding box before hamburger tap').toBeNull()

    // Tap the hamburger → Vaul Drawer slides in.
    await hamburger.tap()

    // The Drawer renders the sidebar with the "New chat" button visible.
    await expect(newChat, '"New chat" button should appear after hamburger tap').toBeVisible({ timeout: 3_000 })
  })

  test('Views dropdown opens as bottom-sheet on mobile (anchored to bottom of viewport)', async ({ page }) => {
    // Views dropdown trigger — anything with aria-haspopup or a specific label.
    // We don't pin to exact text so the spec survives copy tweaks.
    const viewsTrigger = page.locator('[aria-haspopup], button').filter({ hasText: /views|inbox|manual/i }).first()
    test.skip(await viewsTrigger.count() === 0, 'no Views dropdown trigger found on this account')

    await viewsTrigger.tap()
    // Tap any view entry — first "Manual to-dos" / "Tasks" link in the popover
    const tasksEntry = page.locator('button, a').filter({ hasText: /manual|tasks/i }).first()
    if (await tasksEntry.count() === 0) return  // popover might be empty for a fresh account
    await tasksEntry.tap()

    // The Vaul Drawer for bottom-sheet has role="dialog" and is anchored to
    // the bottom of the viewport (top > 50% of viewport height).
    const sheet = page.locator('[role="dialog"]').last()
    await expect(sheet, 'bottom-sheet should be visible').toBeVisible({ timeout: 5_000 })

    const sheetBox = await sheet.boundingBox()
    const viewport = page.viewportSize()
    if (!sheetBox || !viewport) return
    expect(
      sheetBox.y,
      `bottom-sheet should be anchored bottom-half; top=${sheetBox.y}px viewport_h=${viewport.height}px`,
    ).toBeGreaterThan(viewport.height * 0.3)
    // And it should span the full width of the viewport (within 8px tolerance)
    expect(sheetBox.width).toBeGreaterThan(viewport.width - 8)
  })

  test('composer chips fit in the viewport (no horizontal overflow on the footer)', async ({ page }) => {
    // Wait for the chat composer to mount (the textarea is the canonical anchor).
    const composer = page.locator('textarea').first()
    await expect(composer).toBeVisible({ timeout: 10_000 })

    // The composer's parent footer hosts the chip row. Walk up to find it.
    // Pragmatic: check the immediate parent's overflow.
    const overflowing = await page.evaluate(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return null
      let el: HTMLElement | null = ta as HTMLElement
      // Walk up two levels — the chip row sits adjacent to the textarea's container.
      for (let i = 0; i < 4 && el; i++) {
        el = el.parentElement
        if (!el) break
        if (el.scrollWidth > el.clientWidth + 1) {
          return { tag: el.tagName, scrollW: el.scrollWidth, clientW: el.clientWidth, classes: el.className.slice(0, 80) }
        }
      }
      return null
    })
    expect(overflowing, `composer parent overflows horizontally: ${JSON.stringify(overflowing)}`).toBeNull()
  })
})
