# Loop template — `dev→prod test-iterate`

Reusable [Loop](../../task_plan-loops-sprints.md) template for the workflow:
**make a change → test in dev (`npm run dev` + Playwright) → if green, test in prod
(`nexus.coolifycloudtunnel.uk`) → if red, fix and re-run dev → iterate until the
change is production-ready**, with environment cleanup each cycle.

This is the canonical example the Loops North Star was modelled on (operator ran
`npm run dev` + Playwright + Claude in a session and kept iterating until a feature
shipped). Saved here as a **template**, not an active Loop — the `loops` table
auto-dispatches on create, so instantiate it deliberately (it stays operator-gated).

## Instantiate

Create it **paused** (dormant in the library), then resume from `/settings → Loops`
when you want it to run:

```bash
# ops-token-authed; create paused so it doesn't auto-fire
doppler run -- bash -c 'curl -s -X POST "$NEXT_PUBLIC_APP_URL/api/loops" \
  -H "authorization: Bearer $NEXUS_OPS_TOKEN" -H "content-type: application/json" \
  -d @.claude/loops/dev-prod-test-iterate.json'
```

## Payload (`LoopCreateInput` — see `lib/loops/types.ts`)

```json
{
  "name": "dev→prod test-iterate",
  "delegated_agent_slug": "loop-runner",
  "mode": "iterate",
  "status": "paused",
  "north_star_md": "Ship a change to production-ready by iterating dev→prod. Each cycle: apply the change, run it in the dev environment (`npm run dev` on a clean port + the Playwright `authed` + `real-device-mobile` projects against it), and only promote to a prod test once dev is fully green. If dev fails, fix and re-run dev before any prod step. Production-ready = the prod target (nexus.coolifycloudtunnel.uk) passes the same Playwright smoke after deploy.",
  "end_outcome_md": "Acceptance: (1) `npx tsc --noEmit` + `npm run check:all` pass; (2) the Playwright `authed` + `real-device-mobile` projects pass against the dev server (`BASE_URL=http://localhost:<devport>`, `STORAGE_STATE=tests/playwright/.auth/operator.json`); (3) `nexus-app` deployed to the Mac local-OS stack; (4) the same Playwright smoke passes against `BASE_URL=https://nexus.coolifycloudtunnel.uk`. Two consecutive clean cycles (no net-new failures) ⇒ done.",
  "cost_cap_usd": 15,
  "iteration_cap": 8,
  "time_cap_hours": 6,
  "approval_gates": ["deploy_to_prod"]
}
```

## Per-iteration steps (what `loop-runner` runs)

1. **Apply** the proposed change (draft PR / working tree edit).
2. **Static gate:** `npx tsc --noEmit` + `npm run check:all`. Fail → fix, restart cycle.
3. **Dev env:** start `doppler run --config dev -- npx next dev -p <free-port>`; wait
   for ready; run `BASE_URL=http://localhost:<port> STORAGE_STATE=tests/playwright/.auth/operator.json
   npx playwright test --project=authed --project=real-device-mobile`. Filter the
   `THREE.*computeBoundingSphere` console noise from `/graph`. Fail → fix, restart.
4. **Promote (gated `deploy_to_prod`):** `npm run deploy -- --nexus-app`.
5. **Prod env:** `BASE_URL=https://nexus.coolifycloudtunnel.uk STORAGE_STATE=<prod-state>
   npx playwright test --project=authed`. Fail → open a fix, restart at step 1.
6. **Cleanup (every cycle):** kill the dev server started in step 3; close any
   browser tab/CDP session this cycle opened; leave shared services (OrbStack
   stack on :3000/:3001, Paperclip on :3100) untouched. See "Environment cleanup".

## Environment cleanup (folded into every cycle)

- **Stray dev servers:** `pkill -f 'next dev -p <port>'` for any port this loop
  started; before starting, check `lsof -nP -iTCP:<port> -sTCP:LISTEN` is free.
- **Unused Chrome/CDP tabs:** list with `curl -s http://127.0.0.1:<cdpPort>/json`;
  close tabs this loop opened (don't touch the operator's main Chrome / lone
  `chrome://newtab`).
- **Keep (in use):** OrbStack container stack (`:3000`/`:3001`), Paperclip
  workforce server (`:3100`, backs `/workforce`).

## Invariants (inherited)

Operator-gated kickoff · bounded per cycle · cost/iteration/time caps above ·
`deploy_to_prod` gated · draft PRs only, no auto-merge · `operator.json` storage
state is gitignored and re-captured via `scripts/playwright-auth-login.mjs` when a
spec lands on the sign-in page · memory atom on a generalisable failure class.
