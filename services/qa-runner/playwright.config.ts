import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the autonomous QA runner.
 *
 * Projects mirror tests/playwright/playwright.config.ts (Phase 2 of
 * task_plan-mobile-copilot.md): chromium desktop, iPhone 12, Pixel 5.
 * The orchestrator dispatches per-project so a mobile-only regression
 * surfaces with the same fix-attempt loop as a desktop one — and the
 * orchestrator can subset to `--project=iphone` when triaging.
 *
 * - Single worker by default (`PLAYWRIGHT_WORKERS=1`) — small VPS tiers
 *   can't afford parallel Chromium instances. Bump on a 4 GB+ host.
 * - `BASE_URL` defaults to the local Vercel preview that the cron triggers
 *   against; the orchestrator overrides via `BASE_URL=...` per run.
 * - Failures emit a screenshot + trace + video so the dispatch brief has
 *   enough context to localise the regression.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir:    './e2e',
  timeout:    60_000,
  workers:    Number(process.env.PLAYWRIGHT_WORKERS ?? 1),
  reporter:   [['list'], ['json', { outputFile: 'dist/playwright-report.json' }]],
  forbidOnly: Boolean(process.env.CI),
  retries:    0,
  use: {
    baseURL:        BASE_URL,
    headless:       true,
    screenshot:     'only-on-failure',
    video:          'retain-on-failure',
    trace:          'retain-on-failure',
    actionTimeout:  10_000,
    navigationTimeout: 20_000,
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
  outputDir: 'dist/test-results',
})
