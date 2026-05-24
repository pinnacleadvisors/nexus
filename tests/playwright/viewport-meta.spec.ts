/**
 * Spec: viewport meta tag is emitted on every page.
 *
 * Catches the 2026-05-24 incident class: app/layout.tsx had no
 * `export const viewport`, so Next.js 16 never emitted
 * `<meta name="viewport" content="width=device-width, ...">`. Mobile
 * browsers fell back to ~980px assumed viewport, Tailwind sm:/md:/lg:
 * breakpoints never matched on phones, and the desktop layout rendered
 * at scale → "squashed and unusable" on iPhone (fixed in PR #301).
 *
 * The existing iphone/android Playwright projects didn't catch the
 * regression because Playwright sets viewport via device config,
 * bypassing the meta tag entirely. This spec asserts the meta tag
 * directly so future SSR-layout changes that drop the export break here.
 *
 * Runs on /sign-in because it's the only fully-public route — no Clerk
 * ticket needed. Every other surface inherits the same root layout, so
 * one assertion site covers the whole app.
 */

import { test, expect } from '@playwright/test'

test.describe('viewport meta', () => {
  test('emits <meta name="viewport"> with width=device-width', async ({ page }) => {
    const response = await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
    expect(response, '/sign-in returned no response').not.toBeNull()
    expect(response!.status(), `/sign-in returned HTTP ${response!.status()}`).toBeLessThan(400)

    // Read the viewport meta directly from the rendered DOM rather than
    // parsing the raw HTML — handles edge cases where the framework injects
    // the tag via React Helmet equivalents instead of SSR.
    const viewport = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
    )

    expect(
      viewport,
      'No <meta name="viewport"> in the rendered HTML. Next.js 16 emits this from the root layout\'s `export const viewport` — if it disappeared, mobile browsers will fall back to ~980px assumed viewport and Tailwind sm:/md:/lg: breakpoints will stop firing on phones. See PR #301.',
    ).not.toBeNull()

    expect(
      viewport,
      `viewport content "${viewport}" missing "width=device-width" — without it, mobile rendering breaks.`,
    ).toContain('width=device-width')
  })

  test('emits <meta name="theme-color">', async ({ page }) => {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
    const themeColor = await page.evaluate(() =>
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    )
    expect(
      themeColor,
      'No <meta name="theme-color"> — the iOS / Android UI chrome won\'t match the page background. Set via the `themeColor` field on app/layout.tsx\'s viewport export.',
    ).not.toBeNull()
  })
})
