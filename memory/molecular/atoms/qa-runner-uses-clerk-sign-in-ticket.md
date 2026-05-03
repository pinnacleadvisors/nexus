---
title: qa-runner uses Clerk sign-in ticket
created: 2026-05-02
links:
  - mocs/autonomous-qa
---

# qa-runner uses Clerk sign-in ticket

The autonomous QA runner (Coolify, next to claude-gateway) authenticates as `qa-bot` by POSTing to `/api/admin/issue-bot-session` (HMAC `BOT_ISSUER_SECRET`) and redeeming the returned Clerk sign-in ticket URL. This produces a real Clerk session cookie usable in Playwright. For non-browser API calls the same bot uses `Authorization: Bearer $BOT_API_TOKEN` resolved by `lib/auth/bot.ts::authBotToken`. `BOT_CLERK_USER_ID` must be in `ALLOWED_USER_IDS`.

Source: `lib/auth/bot.ts`, `task_plan-autonomous-qa.md`.
