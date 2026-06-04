#!/usr/bin/env node
/**
 * Secure authenticated-session capture for Playwright.
 *
 * Opens a REAL headed Chromium tab pointed at Nexus. YOU (the operator) log in
 * normally — email + password + Clerk Turnstile — exactly as in a browser. The
 * script never sees your credentials; it only watches for the Clerk session
 * cookie to appear, then saves the resulting `storageState` (cookies + origin
 * localStorage) to a gitignored file. Playwright specs / agent exploration then
 * REUSE that session via `storageState`, so tests run as a fully authenticated
 * user without anyone handling secrets.
 *
 * Why this exists: the programmatic Clerk sign-in ticket (BOT_SESSION_TICKET_URL)
 * is domain-whitelisted and fails against http://localhost (see memory atom
 * "Local Playwright auth"). A real manual login in a headed browser always works
 * — this harness captures it once and lets every later run reuse it.
 *
 * Usage:
 *   node scripts/playwright-auth-login.mjs                 # localhost:3000 (npm run dev)
 *   BASE_URL=https://nexus.coolifycloudtunnel.uk node scripts/playwright-auth-login.mjs
 *
 * Output: tests/playwright/.auth/operator.json  (gitignored)
 *   Reuse it with:  STORAGE_STATE=tests/playwright/.auth/operator.json npx playwright test
 *
 * The session expires per Clerk config — re-run this when specs start landing on
 * the sign-in page again.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.STORAGE_STATE ?? 'tests/playwright/.auth/operator.json';
const COOKIE = '__session'; // Clerk's session cookie
const TIMEOUT_MS = Number(process.env.LOGIN_TIMEOUT_MS ?? 300_000); // 5 min to log in

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  console.log(`\n  Opening a Chrome tab at ${BASE_URL}`);
  console.log('  → Log in normally (email + password + Turnstile). I never see your credentials.');
  console.log('  → Capture fires automatically once Clerk sets the session cookie.\n');

  // Prefer the operator's real system Chrome (no bundled-browser download needed;
  // also matches "opens a Chrome tab"). Fall back to Playwright's bundled Chromium
  // if a channel launch isn't available. Override with PW_CHANNEL=msedge etc.
  const channel = process.env.PW_CHANNEL ?? 'chrome';
  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel });
  } catch (err) {
    console.warn(`  (system "${channel}" unavailable — ${String(err).split('\n')[0]}; trying bundled Chromium)`);
    browser = await chromium.launch({ headless: false });
  }
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  const deadline = Date.now() + TIMEOUT_MS;
  let authed = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name === COOKIE && c.value)) { authed = true; break; }
    await sleep(1500);
  }

  if (!authed) {
    console.error(`\n✘ Timed out after ${Math.round(TIMEOUT_MS / 1000)}s — no Clerk session cookie seen.`);
    console.error('  If the platform was unreachable, start it first (npm run dev) or check BASE_URL.');
    await browser.close();
    process.exit(1);
  }

  // Settle a beat so post-login localStorage (Clerk client) is written.
  await sleep(1500);
  await context.storageState({ path: OUT });
  await browser.close();

  console.log(`\n✅  Authenticated session captured → ${OUT}`);
  console.log('   Reuse it:  STORAGE_STATE=' + OUT + ' npx playwright test --project=authed');
  console.log('   (or any spec via the `authed` project, which loads this storageState)\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
