---
title: business_operators table conflict rename
created: 2026-05-02
links:
  - mocs/business-operator
---

# business_operators table conflict rename

The orchestrator-config table is **`business_operators`**, not `businesses`. Migration 003 already created a `businesses` table for the legacy workspace concept used by `lib/graph/builder.ts`. Migration 024 (Phase A) introduced the new orchestrator table under a distinct name to avoid breaking the graph builder. Per-business semantics (slug, money_model JSONB, kpi_targets JSONB, approval_gates, slack_webhook_url) live in `business_operators`.

Source: `supabase/migrations/024_business_operators.sql`, commit `b7d1af2`.
