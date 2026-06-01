/**
 * Unit test for lib/chat/exec-mode.ts — the pure pref→gateway-execMode mapping
 * that controls subscription vs API billing.
 *
 * Run with: `npx --yes tsx __tests__/exec-mode.test.ts`
 */
import { execModeFromPref } from '../lib/chat/exec-mode'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

assert(execModeFromPref('node-pty') === 'pty', "node-pty → pty (interactive, Max billing)")
assert(execModeFromPref('subscription') === 'pty', "subscription → pty (subscription-intent routes to the path that achieves it)")
assert(execModeFromPref('api') === 'print', "api → print (claude -p, per-token billing)")
assert(execModeFromPref(undefined) === undefined, "unset → undefined (gateway default)")
// @ts-expect-error — guard against an unexpected stored value
assert(execModeFromPref('garbage') === undefined, "unknown value → undefined (safe fallback)")

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
