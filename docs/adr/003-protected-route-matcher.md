# ADR 003 — Protected Route Matcher: Defence-in-Depth via Both Layout and Middleware

- Status: Accepted
- Date: 2026-05-02
- Deciders: Platform Owner

## Context

Authentication on protected pages currently has two gates:

1. **`proxy.ts` middleware** runs on every matched request, checks `auth().userId`, then enforces `ALLOWED_USER_IDS`. Any unmatched route gets only the Clerk-session check from the matcher's catch-all (`/(api|trpc)(.*)` covers APIs).

2. **`app/(protected)/layout.tsx`** wraps every page in the `(protected)` route group and re-runs `auth()` server-side, redirecting to `/sign-in` if the user is unauthenticated.

Until now, `proxy.ts::isProtectedRoute` only listed `/dashboard /forge /board /tools /build /graph /swarm`. New pages added under `(protected)/` — `/idea`, `/idea-library`, `/learn`, `/settings`, `/signals`, `/manage-platform`, `/automation-library` — are protected only by the layout.

## Problem

A future page added under `(protected)/x/` that forgets to use the route-group layout (e.g. opts out via its own layout file) would be reachable without auth. The middleware is the catch-all that prevents this regression.

## Decision

Add **all** authenticated pages to `proxy.ts::isProtectedRoute`. Pages and APIs both go through middleware **and** their own auth check (layout for pages, `auth()` in route handlers for APIs). One gate alone is not sufficient.

The matcher is updated to include:
- `/idea(.*)` (capture page + library)
- `/idea-library(.*)` (legacy redirect)
- `/learn(.*)`
- `/settings(.*)`
- `/signals(.*)`
- `/manage-platform(.*)`
- `/automation-library(.*)` (already covered by `/board` family but listed for clarity)

## Consequences

- **Defence-in-depth:** any new page under `(protected)/` is protected by middleware even when its layout is bypassed.
- **No behaviour change for the operator** — the same routes redirected to `/sign-in` before via the layout; now they redirect via middleware first (faster, before the React tree renders).
- **Multi-user readiness:** the same matcher is what gets tightened when `MULTI_USER_MODE=1` flips on (PR 6.5 deferred).

## Alternatives considered

- **Layout-only:** simple but fragile. Discarded.
- **Centralised auth in a shared `requireOwner()` helper called from every route handler:** doesn't help pages, would need server actions wrapped too. Discarded.

## Rollout

- `proxy.ts` matcher updated in PR 6 of `task_plan-ux-security-onboarding.md`.
- Smoke test: `curl -i https://<deployment>/learn` from an unauthenticated session → expect 302 to `/sign-in`.
- The bot path (`BOT_API_TOKEN`) is unaffected — bot calls hit `/api/...` routes which already authenticate via `lib/auth/bot.ts::authBotToken`.

## Related

- `proxy.ts`
- `app/(protected)/layout.tsx`
- `lib/auth/bot.ts`
- `task_plan-ux-security-onboarding.md` PR 6
