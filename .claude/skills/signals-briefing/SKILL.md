---
name: signals_briefing
description: Renders the current "signals" briefing — recent gate events, kill-switch checks, top spenders, content publish stream — as a typed `signals` block inside platform-copilot chat. Replaces the static `/signals` page per Paperclip absorption phase 2 Task B. Invoke when the operator types "signals?", "briefing", "what's new?" or "/signals" in the chat.
status: verified
trigger:
  - exact: "/signals"
  - regex: "(?i)^\\s*(signals\\??|briefing|what'?s new\\??)\\s*$"
---

# signals_briefing skill

## Purpose

A static dashboard at `/signals` answered "what should I pay attention to right now?" Operator scanned it and either took action or dismissed it.

A skill answers the same question — but invoked inside a chat session where the operator can immediately drill into any signal ("explain that kill switch", "open the gate-event log for ledger-lane") via the same platform-copilot context. The chat agent has MCP + Composio access; the static page didn't. So the skill version is strictly more useful: same data, plus follow-up routing.

## How to invoke

The platform-copilot agent (see [`.claude/agents/platform-copilot.md`](../../agents/platform-copilot.md)) should detect the trigger patterns above and fire this skill — render the structured briefing as a typed `signals` block in the chat. Do NOT just paste a markdown summary; use the typed block so the chat UI can render it with the right card layout (mirrors what `/signals` used to render).

## Data sources

All read-only queries:

| Bucket | Query | Cap |
|---|---|---|
| Gate events | `experiment_metrics WHERE kind='gate_event' ORDER BY ts DESC` | last 20 |
| Kill-switch checks | `experiment_metrics WHERE kind='kill_switch_check' AND payload->>'kill'='true' ORDER BY ts DESC` | last 10 |
| Top spenders 24h | `experiment_metrics WHERE kind='cash_spend' AND ts >= now() - interval '24 hours'` then aggregate by `business_slug` | top 5 |
| Content publishes 24h | `experiment_metrics WHERE kind='content_published' AND ts >= now() - interval '24 hours'` | last 10 |
| Pending approvals (cross-business) | `approvals WHERE status='pending' ORDER BY created_at DESC` | last 10 |

Reuse the existing data layer at [`lib/signals/client.ts`](../../../lib/signals/client.ts) — `listNewSignals(limit=20)` does most of the work. The skill is a thin wrapper that:

1. Calls `listNewSignals(20)` for the curated signal feed
2. Augments with the typed sub-queries above (which `listNewSignals` doesn't surface)
3. Emits the typed `signals` block

## Output format

```
signals updated=<ISO timestamp>
gate_events:
  - business: <slug>
    type:     <niche_pick|domain_purchase|first_n_posts|paid_saas_signup|pricing_change>
    state:    <pending|approved|rejected>
    ts:       <ISO>
kill_switch_hits:
  - business: <slug>
    reason:   <string>
    ts:       <ISO>
spend_24h:
  - business: <slug>
    usd:      <number>
content_24h: <number>
pending_approvals: <number>
follow_up_hint: "<one-sentence next step the operator could take>"
```

Then in your assistant text, summarise: "X gate events pending, Y kill-switch hits, top spender Z…" — but only the typed block is the contract. The chat poll route parses the block, the assistant prose is for the operator's eyes only.

## Hard rules

- **Read-only.** This skill MUST NOT mutate any row. If a signal indicates a mutating action is needed, surface as an `approval-request` AFTER the `signals` block — never inline.
- **Cap at 20 of each.** A briefing with hundreds of items is unreadable. If there are more than 20, surface the count + "open /signals to see all" link as a follow-up.
- **No PII in the typed block.** Business slugs are public; payload contents may contain niche-specific PII (customer emails on the signups bucket, etc.) — strip those before emission. The existing `listNewSignals` helper already redacts; just don't add new buckets that bypass it.
- **Cost-cap aware.** Don't run this skill inside an autonomous loop (e.g. solopreneur-tick) — it's operator-facing. The trigger patterns above are user-input only.

## Verification

```bash
# Manual test from /manage-platform chat:
# Type:    signals?
# Expect:  a typed `signals` block followed by a 1-2 sentence summary.
# The signals block is parsed by the chat poll route and rendered as a
# SignalsCard with one row per gate event / kill-switch hit / top spender.
```
