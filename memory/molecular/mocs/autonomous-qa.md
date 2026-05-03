---
title: Autonomous QA
created: 2026-05-02
type: moc
---

# Autonomous QA — Map of Content

The post-deploy smoke loop. Vercel cron at `*/30 * * * *` HMAC-pings the qa-runner on Coolify. The runner mints a Clerk sign-in ticket via `/api/admin/issue-bot-session`, runs Playwright smoke specs as `qa-bot`, and on failure dispatches a fix-attempt to the self-hosted gateway. Server-side context comes from `lib/logs/vercel.ts::attachLogsToBrief`.

## Atoms
- [[atoms/qa-runner-uses-clerk-sign-in-ticket|qa-runner uses Clerk sign-in ticket]]
- [[atoms/log_events-replaces-cron-status-table|log_events replaces dedicated cron status table]]
- [[atoms/signals-page-runs-council-on-demand|Signals page runs council on demand]]
- [[atoms/manage-platform-is-the-admin-surface|/manage-platform is the admin surface]]

## Entities
- `services/qa-runner/` — Coolify-hosted Playwright runner
- `lib/auth/bot.ts` — `authBotToken` + `resolveCallerUserId`
- `app/api/admin/issue-bot-session/route.ts` — sign-in ticket issuer
- `app/api/logs/slice/route.ts` — log slicer for fix-attempt briefs
- `app/api/cron/post-deploy-smoke/route.ts` — cron entrypoint

## Related
- `task_plan-autonomous-qa.md`
- `lib/logs/vercel.ts` — log search & brief formatter
