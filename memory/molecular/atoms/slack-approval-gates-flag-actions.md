---
title: Slack approval gates flag actions
created: 2026-05-02
links:
  - mocs/business-operator
---

# Slack approval gates flag actions

Each business row stores `approval_gates: string[]` — list of dotted action-kind prefixes that require human approval. Common prefixes: `spend.` (any paid action), `publish.paid.` (boost / sponsor), `publish.brand.` (brand voice or founder copy), `strategic.` (pivot / new SKU), `finance.` (refund / chargeback). When the operator emits an action whose `kind` matches a prefix, the digest renders Approve / Reject buttons; click verifies signing secret in `/api/slack/decision` and advances the linked Run.

Source: `lib/business/types.ts:55-66`, `inngest/functions/business-operator.ts:128-160`.
