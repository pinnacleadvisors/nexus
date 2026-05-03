---
title: business-operator daily cron at 04 UTC
created: 2026-05-02
links:
  - mocs/business-operator
---

# Business operator daily cron at 04 UTC

`inngest/functions/business-operator.ts` runs at `0 4 * * *` UTC (= 11:00 ICT). For each row in `business_operators WHERE status='active'` it dispatches the `business-operator` agent (sonnet) to claude-gateway, parses a structured JSON plan, and posts a Slack digest with inline Approve / Reject buttons (action prefixes match `approval_gates`). One identity per cycle — failures post a `:rotating_light:` message to the same webhook.

Source: `inngest/functions/business-operator.ts:256-273`.
