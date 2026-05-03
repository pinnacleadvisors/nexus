---
title: manage-platform is the admin surface
created: 2026-05-02
links:
  - mocs/autonomous-qa
---

# /manage-platform is the admin surface

`/manage-platform` is reserved for admin-only operations — orphan card cleanup, system health (cron freshness, gateway, webhook health, Sentry counts), research-loop trigger. Distinct from `/dashboard` (Mission Control = high-level KPIs and active runs). PR 5 adds the unified Health Panel here. PR 6 adds `/manage-platform` to `proxy.ts::isProtectedRoute` so it's middleware-gated, not just layout-gated.

Source: `app/(protected)/manage-platform/page.tsx`, `docs/adr/003-protected-route-matcher.md` (TBD).
