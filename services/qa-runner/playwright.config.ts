import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the autonomous QA runner.
 *
 * - Single project: chromium-headless. The orchestrator dispatches fix-attempts
 *   on failure, so adding browsers multiplies dispatch cost without changing
 *   the signal. Add WebKit/Firefox only when an issue is suspected to be
 *   browser-specific.
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
  ],
  outputDir: 'dist/test-results',
})
