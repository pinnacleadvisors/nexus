# Authenticated Playwright testing — operator-driven "test + improve" loop

Run Playwright against Nexus **as a fully signed-in operator** without anyone ever
handling your Clerk credentials. You log in once in a real Chrome tab; the harness
captures the session; the agent drives Playwright as that authenticated user to
explore the platform, catch bugs, and implement fixes.

This is the robust path for **local** testing — the programmatic Clerk sign-in
ticket (`BOT_SESSION_TICKET_URL`, used by `services/qa-runner/`) is
domain-whitelisted and fails against `http://localhost`. A real manual login in a
headed browser always works; we capture it once and reuse it.

---

## 1. Start the platform you want to test

```bash
npm run dev                       # http://localhost:3000 — live reload, best for implement+retest
# or test the live Mac stack:    BASE_URL=https://nexus.coolifycloudtunnel.uk
```

## 2. Capture your authenticated session (once per session lifetime)

```bash
npm run test:e2e:login            # opens a headed Chrome tab at localhost:3000
# or:  BASE_URL=https://nexus.coolifycloudtunnel.uk npm run test:e2e:login
```

A Chrome window opens on the Nexus sign-in page. **Log in normally** — email,
password, Clerk Turnstile. The script never sees your credentials; it watches for
Clerk's `__session` cookie and, the moment it appears, saves the session to:

```
tests/playwright/.auth/operator.json     # gitignored — a live session, never committed
```

Re-run this whenever specs start bouncing to `/sign-in` (the session expired per
your Clerk config).

## 3. Run authenticated tests

The `authed` Playwright project is auto-registered once the state file exists:

```bash
npm run test:e2e:authed                              # all authed-tagged specs, signed in
npx playwright test --project=authed authed-explore  # just the exploration crawl
npx playwright test --project=authed --headed        # watch it drive the browser
```

`tests/playwright/authed-explore.spec.ts` is the **bug-catching crawl**: it visits
every key protected route (`/dashboard`, `/forge`, `/board`, `/inbox`, `/approvals`,
`/businesses`, `/teams`, `/manage-platform`, `/workforce`, `/code`, `/graph`, …) and
hard-fails on auth bounces, 5xx, and error boundaries while reporting console errors
and failed requests. Extend `ROUTES` as the platform grows.

---

## 4. The reusable prompt (paste this to kick off a session)

> **Authenticated test-and-improve session.**
> The platform is running (`npm run dev` at http://localhost:3000) and I've
> captured my authenticated session via `npm run test:e2e:login` (storageState at
> `tests/playwright/.auth/operator.json`). Drive Playwright as the signed-in
> operator using the `authed` project:
> 1. **Explore** — run `npx playwright test --project=authed authed-explore` and
>    open the report. Then crawl deeper into the surfaces that look richest
>    (chat, board, approvals, businesses, workforce) with ad-hoc authed Playwright
>    scripts. Collect: console errors, failed/5xx requests, broken layouts at
>    1280px AND 375px, dead buttons, error boundaries, slow routes.
> 2. **Plan** — write findings to `task_plan-platform-polish.md` as atomic tasks
>    (North Star → Explore → Plan), ranked by severity × reach. Show me the plan.
> 3. **Implement** — after I approve, fix top items test-first: add/extend an
>    `authed` spec that reproduces the bug (RED), fix it (GREEN), keep the crawl
>    green. One PR per coherent batch; `npm run check:all` before pushing.
> Honour AGENTS.md (write-size discipline, retry-storm rule, mobile-at-375px,
> branch hygiene). Never commit `tests/playwright/.auth/`.

---

## Security notes

- **Credentials never touch the agent or the repo.** You type them into a real
  browser; only the resulting session cookie is captured, to a gitignored file.
- `tests/playwright/.auth/` is gitignored. If you ever see it in `git status`,
  stop — do not commit a live session.
- The captured session has YOUR access. Treat `operator.json` like a password:
  it's machine-local, short-lived, and never shared.
- To revoke, sign out in Clerk (or delete the session in the Clerk dashboard) and
  delete `tests/playwright/.auth/operator.json`.

## How it fits the test taxonomy

| Layer | System | Auth |
|---|---|---|
| Production smoke (post-deploy) | `services/qa-runner/` → live deploy | Clerk ticket (`BOT_SESSION_TICKET_URL`) |
| Local + loop verification (unauthed-friendly) | `tests/playwright/` default projects | middleware-throw fallthrough / `requireAuth()` skip |
| **Local authenticated (this doc)** | `tests/playwright/` `authed` project | **captured operator session (storageState)** |
