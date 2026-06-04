/**
 * Playwright config — root-level local + loop-time verification.
 *
 * Distinct from services/qa-runner/playwright.config.ts which targets the
 * live Vercel deploy via the qa-bot Clerk ticket. This config runs against
 * a dev server (developer: `npm run dev`; future Phase 2 codex-debug-loop:
 * the per-branch dev sandbox container). See task_plan-codex-debug-loop.md
 * Phase 1 (DL1).
 *
 * Projects:
 *   - chromium (Desktop Chrome 1280×720) — the default surface; matches
 *     what the operator uses on their laptop.
 *   - iphone   (iPhone 12 emulation, 390×844 with touch + DPR 3) — Phase 2
 *     of task_plan-mobile-copilot.md; the operator's primary mobile
 *     device class. Specs ending in `-mobile.spec.ts` should only run
 *     on this project (and `android`).
 *   - android  (Pixel 5 emulation, 393×851 with touch + DPR 2.75) — broader
 *     Android coverage so a Chrome-mobile-only quirk surfaces in CI.
 *   - real-device-mobile — Safari-iOS user-agent + 390×844 viewport, no
 *     Playwright device-injection. Catches the viewport-meta-class
 *     regression fixed by PR #301: the other mobile projects use
 *     `devices['iPhone 12']` which presets viewport from device config,
 *     bypassing the page's own `<meta name="viewport">` tag entirely.
 *     This project leaves layout responsibility to the page so the
 *     `viewport-meta.spec.ts` assertions are exercised against the
 *     real SSR output, not against Playwright's emulator defaults.
 *
 * Single worker by default — keeps Clerk session reuse predictable and
 * matches the qa-runner's choice on small VPS tiers. Bump via PLAYWRIGHT_WORKERS
 * on workstations that can afford parallel Chromium instances.
 *
 * Running subsets:
 *   - `npx playwright test --project=chromium`             — desktop only
 *   - `npx playwright test --project=iphone`               — iPhone-emulated only
 *   - `npx playwright test --project=android`              — Pixel 5 only
 *   - `npx playwright test --project=real-device-mobile`   — Safari-iOS UA only
 *   - `npx playwright test` (no flag)                      — all four projects
 *
 * BASE_URL defaults to http://localhost:3000. CI / loop scenarios override
 * via BASE_URL=https://branch-preview.example.
 */

import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

// Authenticated-session reuse. `scripts/playwright-auth-login.mjs` captures a
// real operator login into this gitignored storageState file; the `authed`
// project below loads it so specs run as a signed-in user. The project is only
// registered when the file exists, so `npx playwright test` (no capture) never
// errors on a missing state file.
const AUTH_STATE = process.env.STORAGE_STATE ?? 'tests/playwright/.auth/operator.json'
const HAS_AUTH = existsSync(AUTH_STATE)

export default defineConfig({
  testDir:    './tests/playwright',
  timeout:    60_000,
  workers:    Number(process.env.PLAYWRIGHT_WORKERS ?? 1),
  reporter:   process.env.CI ? [['list'], ['github']] : [['list']],
  forbidOnly: Boolean(process.env.CI),
  retries:    0,
  fullyParallel: false,
  use: {
    baseURL:            BASE_URL,
    headless:           true,
    screenshot:         'only-on-failure',
    video:              'retain-on-failure',
    trace:              'retain-on-failure',
    actionTimeout:      10_000,
    navigationTimeout:  20_000,
  },
  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
    {
      name: 'iphone',
      use:  { ...devices['iPhone 12'] },
    },
    {
      name: 'android',
      use:  { ...devices['Pixel 5'] },
    },
    {
      // Real-device-mobile — explicit Safari iOS UA + minimal viewport
      // override, NO Playwright device-injection. Used by viewport-meta.spec.ts
      // to verify the page's own meta tag is doing its job. Don't add
      // touch / DPR / isMobile here — that would defeat the purpose.
      name: 'real-device-mobile',
      use:  {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        viewport:  { width: 390, height: 844 },
      },
    },
    // Authenticated desktop surface — only registered once a session has been
    // captured (scripts/playwright-auth-login.mjs). Run with --project=authed
    // to exercise protected flows as a signed-in operator.
    ...(HAS_AUTH
      ? [{
          name: 'authed',
          // channel: 'chrome' uses the operator's installed Chrome — no bundled
          // chromium download needed (matches the login-capture path).
          use:  { ...devices['Desktop Chrome'], channel: 'chrome', storageState: AUTH_STATE },
          // Only the authed-intended specs run here. The rest of the suite assumes
          // an UNauthenticated session (sign-in flow, redirect guards, mobile
          // layout) and would fail under a logged-in storageState. New authed
          // specs: add the filename here.
          testMatch: /(authed-explore|authed-interactions|code-page|graph-scene)\.spec\.ts$/,
        }]
      : []),
  ],
  outputDir: 'test-results',
})
