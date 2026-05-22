/**
 * Playwright config — root-level local + loop-time verification.
 *
 * Distinct from services/qa-runner/playwright.config.ts which targets the
 * live Vercel deploy via the qa-bot Clerk ticket. This config runs against
 * a dev server (developer: `npm run dev`; future Phase 2 codex-debug-loop:
 * the per-branch dev sandbox container). See task_plan-codex-debug-loop.md
 * Phase 1 (DL1).
 *
 * Single chromium project by deliberate choice — multi-browser multiplies
 * dispatch cost (and Phase 2 loop iterations) without changing the failure
 * signal. Browser-specific regressions are rare enough to add WebKit/Firefox
 * only when one is suspected.
 *
 * Single worker by default — keeps Clerk session reuse predictable and
 * matches the qa-runner's choice on small VPS tiers. Bump via PLAYWRIGHT_WORKERS
 * on workstations that can afford parallel Chromium instances.
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
  ],
  outputDir: 'test-results',
})
