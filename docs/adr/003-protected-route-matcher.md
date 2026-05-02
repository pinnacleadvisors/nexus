# ADR 003 — Protected route matcher in proxy.ts

- Status: Accepted
- Date: 2026-05-03
- Author: platform-improvements task plan
- Related: `task_plan-platform-improvements.md` Finding S1, Track 6.1

## Context

Nexus has two layers of authentication enforcement for the operator-facing app:

1. **Middleware (`proxy.ts`)** — Clerk session check + `ALLOWED_USER_IDS`
   allowlist, run on every matched request. The matcher previously enumerated
   only seven prefixes: `/dashboard`, `/forge`, `/board`, `/tools`, `/build`,
   `/graph`, `/swarm`.
2. **Route-group layout (`app/(protected)/layout.tsx`)** — server-side `auth()`
   call inside the layout component, redirecting unauthenticated users.

The audit in `task_plan-platform-improvements.md` identified that several
pages live under `app/(protected)/` but are NOT in the middleware matcher:
`/idea`, `/idea-library`, `/learn`, `/settings`, `/settings/businesses`,
`/signals`, `/manage-platform`, `/dashboard/org`. They rely on the layout's
`auth()` for protection.

## Decision

Widen the middleware matcher to cover every page under `app/(protected)/`. The
layout's `auth()` stays — it's defense-in-depth, not a replacement.

Rationale:
- A future contributor adding a page under `(protected)/x/` may forget the
  layout-level `auth()` and the page would leak.
- Middleware is the cheaper enforcement point — it short-circuits before any
  page code runs and avoids leaking React server-render output.
- The `(protected)` route group is invisible in URLs; there's no way to read
  the URL alone and tell whether middleware should apply. Listing every prefix
  in the matcher makes the contract explicit.
- The platform is single-owner today (`ALLOWED_USER_IDS=user_xxx`) — there is
  no scenario where any subset of `(protected)/` should be public-by-design.

## Consequences

### Positive
- Adding a new page under `(protected)/x/` no longer requires a sister change
  to the layout — middleware will gate it as long as the URL prefix matches.
- Unauthenticated requests to `/learn`, `/settings`, etc. now redirect to
  `/sign-in` immediately rather than rendering a brief skeleton before the
  layout's redirect kicks in.
- `task_plan-platform-improvements.md` Finding S1 closes.

### Negative
- The matcher list grows. If a future use case wants a public subset of
  `(protected)/x/y` (e.g. an embeddable preview), it has to be moved out of
  `(protected)/` or excluded from the matcher with a `!`-prefix entry. This is
  a fine constraint for the platform's current single-owner posture.

### Migration
- One-line change to `proxy.ts`. No data migration. No env var changes.

## Alternatives considered

1. **Match-all (`/(.*)`).** Too aggressive — also gates the marketing root,
   sign-in page, and OAuth callback. Rejected.
2. **Move auth entirely to middleware.** Possible but requires removing the
   layout `auth()` calls and any per-page `useUser()` reads that depend on
   the redirect having already happened. Out of scope for a security pass.
3. **Auto-discover `(protected)/` paths at build.** Tempting but the Clerk
   `createRouteMatcher` is a runtime function. A build-time codegen step
   could populate the array; deferred — current list is small enough to
   maintain by hand.
