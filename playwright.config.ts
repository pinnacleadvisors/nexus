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
 *
 * Single worker by default — keeps Clerk session reuse predictable and
 * matches the qa-runner's choice on small VPS tiers. Bump via PLAYWRIGHT_WORKERS
 * on workstations that can afford parallel Chromium instances.
 *
 * Running subsets:
 *   - `npx playwright test --project=chromium`  — desktop only
 *   - `npx playwright test --project=iphone`    — iPhone-emulated only
 *   - `npx playwright test --project=android`   — Pixel 5 only
 *   - `npx playwright test` (no flag)           — all three projects
 *
 * BASE_URL defaults to http://localhost:3000. CI / loop scenarios override
 * via BASE_URL=https://branch-preview.example.
 */

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

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
  ],
  outputDir: 'test-results',
})
