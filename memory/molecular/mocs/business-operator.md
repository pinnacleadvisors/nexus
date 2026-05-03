---
title: Business Operator
created: 2026-05-02
type: moc
---

# Business Operator — Map of Content

The autonomous orchestrator that runs each active business once per day. Reads the row from `business_operators`, assesses memory + Run events + Board, emits 3–7 actions for today, posts a Slack digest with inline Approve / Reject buttons.

## Atoms
- [[atoms/business_operators-table-conflict-rename|business_operators table conflict rename]]
- [[atoms/business-operator-daily-cron-04utc|Business operator daily cron at 04 UTC]]
- [[atoms/slack-approval-gates-flag-actions|Slack approval gates flag actions]]
- [[atoms/tasks-has-no-idea-fk-pre-mig025|tasks has no idea FK before migration 025]]
- [[atoms/n8n-strategist-swarm-mode-flag|n8n Strategist swarm mode flag]]

## Entities
- `.claude/agents/business-operator.md` — agent spec
- `inngest/functions/business-operator.ts` — daily cron
- `lib/business/db.ts` — read/write helpers
- `lib/business/types.ts` — typed row shape
- `app/api/slack/decision/route.ts` — inbound Approve / Reject

## Related
- ADR 002 codex-gateway-sandbox (gateway routing rules)
- `task_plan-ux-security-onboarding.md` PR 3 + PR 4 (lineage + webhook verify)
