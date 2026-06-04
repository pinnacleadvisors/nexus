#!/usr/bin/env node
/**
 * Attach to a Chrome YOU logged into, and capture the session — without ever
 * driving the browser during login.
 *
 * Why: Clerk's Google OAuth refuses browsers that Playwright *launches* (the
 * automation flag trips Google's "this browser may not be secure"). The fix is
 * to launch a normal Chrome with a remote-debugging port, let YOU complete the
 * login (Playwright is NOT attached, so the browser is indistinguishable from a
 * normal one), and only THEN connect over CDP to read the resulting session.
 *
 * Flow (see docs/runbooks/authenticated-playwright-testing.md):
 *   1. A Chrome window is opened for you (separate profile, remote-debugging on).
 *   2. You log in at the dev URL — Google OAuth works because nothing is attached.
 *   3. This script connects over CDP, waits for Clerk's __session cookie, saves
 *      storageState to a gitignored file, and detaches (your window stays open).
 *
 * Usage:  CDP_URL=http://127.0.0.1:9222 node scripts/playwright-attach-capture.mjs
 * Output: tests/playwright/.auth/operator.json  (gitignored)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const OUT = process.env.STORAGE_STATE ?? 'tests/playwright/.auth/operator.json';
const COOKIE = '__session';
const TIMEOUT_MS = Number(process.env.LOGIN_TIMEOUT_MS ?? 900_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  // Wait for the debugging endpoint to come up (Chrome may still be starting).
  let browser = null;
  const connectDeadline = Date.now() + 60_000;
  while (Date.now() < connectDeadline) {
    try { browser = await chromium.connectOverCDP(CDP_URL); break; }
    catch { await sleep(1500); }
  }
  if (!browser) {
    console.error(`✘ Could not reach Chrome DevTools at ${CDP_URL} within 60s.`);
    console.error('  Make sure the debugging Chrome window is open (the launcher prints its PID).');
    process.exit(1);
  }

  console.log(`  Attached to your Chrome at ${CDP_URL}. Watching for the Clerk session...`);
  console.log('  (Log in normally in that window — Google OAuth works; I am not driving it.)\n');

  const deadline = Date.now() + TIMEOUT_MS;
  let authed = false;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      const cookies = await ctx.cookies().catch(() => []);
      if (cookies.some((c) => c.name === COOKIE && c.value)) {
        await sleep(1200); // let post-login localStorage settle
        await ctx.storageState({ path: OUT });
        authed = true;
        break;
      }
    }
    if (authed) break;
    await sleep(1500);
  }

  await browser.close(); // detaches CDP; does NOT close your Chrome window

  if (!authed) {
    console.error(`\n✘ Timed out after ${Math.round(TIMEOUT_MS / 1000)}s — no Clerk session seen.`);
    process.exit(1);
  }
  console.log(`\n✅  Session captured → ${OUT}`);
  console.log('   Next: I run the authed crawl against it (system Chrome, no download).\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
