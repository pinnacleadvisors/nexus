# 002 — Codex CLI gateway as sandboxed manual-ops runtime

- **Date:** 2026-05-02
- **Status:** Accepted

## Context

Nexus's primary AI runtime is the self-hosted Claude Code gateway at `services/claude-gateway/`, which drains the user's 20x Max plan via the `claude` CLI. That covers design-heavy work — codegen, architecture, multi-file refactors. The operator now also has a ChatGPT Pro 10x plan and wants to route the **execution slice** of work (debugging, container setup, sysadmin, current-UI research, deploy scripts) to GPT-5.5 in order to:

1. Drain that subscription instead of leaving it idle
2. Free Claude Code capacity for design work that benefits most from Sonnet / Opus
3. Provide a sandboxed environment where destructive autonomous ops can't blast-radius the primary platform

OpenAI's **Codex CLI** is the official, TOS-clean way to drain the ChatGPT Pro plan. Driving the consumer ChatGPT web product programmatically is against TOS, so we don't.

## Decision

Run a **second self-hosted gateway** at `services/codex-gateway/` (1:1 protocol mirror of claude-gateway) on a **separate VPS** (Hostinger KVM2, distinct from the KVM4 hosting claude-gateway), with a **separate Cloudflare tunnel** (`codex-gw.<domain>`) and a **separate Doppler `sandbox` config** that excludes financial and secret-management secrets.

**Routing decision** is per-call via a new `model` field on `/api/claude-session/dispatch`:
- When `model` matches `gpt*` / `codex*` AND `CODEX_GATEWAY_URL` is configured → dispatch to the codex gateway
- Otherwise → fall through to the existing OpenClaw / Claude Code gateway path

Helper module: `lib/claw/codex-gateway.ts` exposes `dispatchToCodexGateway`, `streamCodexGateway`, `isCodexGatewayConfigured`, and `shouldRouteToCodex`. Mirrors `lib/claw/gateway-call.ts` so chat / agent surfaces can opt into codex by selecting a `gpt-*` model.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Same VPS as claude-gateway (cheaper, ~$0/mo extra) | A runaway agent on either gateway could affect the other. Codex does destructive ops autonomously — needs hard isolation. ~$10/mo for KVM2 is cheap insurance. |
| Local UTM / OrbStack VM on the operator's MacBook | Less reliable for autonomous multi-day runs (laptop sleeps, network changes, IP rotation). Cloud VM has stable uptime and a fixed Cloudflare tunnel. |
| Drive ChatGPT consumer web via browser automation | Against OpenAI TOS. Codex CLI is the official path. |
| Single gateway that picks model per-request | Tightly couples two failure domains. Separate processes / separate sandboxes / separate tunnels is cleaner and lets us snapshot/restore one without touching the other. |
| Use OpenAI API key directly (per-token billing) | Defeats the purpose of draining the ChatGPT Pro plan, which is the operator's existing subscription. |
| Add codex to the `/api/chat` priority chain | Wrong default: chat is interactive, design-heavy — Claude is the right primary. Codex stays opt-in via `model`. |

## Consequences

### Easier

- The operator can dispatch execution-heavy work to GPT-5.5 from n8n workflows or chat by setting `model: 'gpt-5.5-codex'`
- A blown sandbox (codex makes a mess) is recovered by restoring the KVM2 VPS snapshot — claude-gateway / production unaffected
- The same audit / cost-cap / `ALLOWED_USER_IDS` infrastructure protects both gateways equally
- Future trust-ladder progression (PR-only → staging → main merge) is encoded in the `codex-operator` agent spec (`.claude/agents/codex-operator.md`), not in custom routing code
- The n8n-strategist now picks per-step gateway based on whether the work is execution-heavy or design-heavy (see updated spec)

### Harder

- Two gateway codebases to maintain. Mitigated by keeping `services/codex-gateway` a strict copy of `services/claude-gateway` with minimal divergence — only `Dockerfile` (CLI install + volume name), `entrypoint.sh` (auth check), `src/spawn.ts` (CLI invocation + JSON event parser), and the env-var prefix differ.
- Two Cloudflare connectors, two Doppler service tokens, two Coolify projects — all on different VPS instances.
- Codex CLI's JSON event schema differs slightly across versions; the parser in `services/codex-gateway/src/spawn.ts` is intentionally defensive (accepts both `agent_message_delta` / `task_complete` and older `message_delta` / `result` shapes) and falls back to reading `--output-last-message` if the stream is missing the terminal event.

### Must be revisited

- After 4 weeks of production: review whether `dispatchToCodexGateway` callers always set `model` correctly, or whether per-step routing should move into the n8n-strategist's classification logic (auto-route by task verb).
- After the trust ladder graduates codex to L2 (`main` merge): revisit whether the sandbox deny-list is still appropriate or should be tightened further.
- If OpenAI ships an SDK that supersedes the Codex CLI: migrate `services/codex-gateway/src/spawn.ts` to that SDK while keeping the gateway HTTP protocol intact.

## Sandbox config — Doppler `sandbox` deny-list

The codex-gateway VPS holds a Doppler service token scoped to a `sandbox` config. The deny-list — secrets that **must not** appear in the `sandbox` config:

- `STRIPE_*`, `PLAID_*`, anything `*BILLING*` / `WEBHOOK_SECRET` (financial)
- `*_SERVICE_ROLE_KEY` (Supabase service role)
- `CLERK_SECRET_KEY`
- Other `*_BEARER_TOKEN` values (claude gateway, OpenClaw — codex has its own only)
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`

For secret-gated work, codex must invoke the `doppler-broker` agent (ADR 001), which pulls a single named secret through `/api/composio/doppler` server-side, runs the gated command, and returns scrubbed output. Codex never holds the raw value.

## Network egress (UFW on KVM2)

Block outbound to:
- `*.stripe.com/dashboard` (Stripe console)
- `*.plaid.com`
- `dashboard.clerk.com`
- `dashboard.doppler.com`
- `console.aws.amazon.com`

We block the *consoles*, not the APIs the platform code already calls. This stops codex from accidentally browsing a sensitive admin page even if the deny-list missed a secret.

## Trust ladder

| Level | When | Permissions |
|---|---|---|
| **L0 (current)** — PR-only | Day 1 of codex deployment | Codex commits to `codex/*` branches and opens PRs. Operator merges manually. |
| L1 — staging | After ~10 clean PRs | Codex can merge to a `staging` branch. Operator reviews staging deploys. |
| L2 — main | After ~10 clean staging deploys | Codex can merge to `main`. Operator reviews via PR review. |
| L3 — publish | TBD | Reserved for direct production deploys. Out of scope for this ADR. |

Encoded today in `.claude/agents/codex-operator.md`. Future: encode in the gateway bearer token's scope so the gateway itself rejects merges above the current level.

## Implementation summary

| File | Purpose |
|------|---------|
| `services/codex-gateway/` | The gateway service itself — Dockerfile, compose, src/. Mirrors `services/claude-gateway`. |
| `lib/claw/codex-gateway.ts` | Nexus-side helper — `dispatchToCodexGateway`, `streamCodexGateway`, `shouldRouteToCodex`, `isCodexGatewayConfigured`. |
| `app/api/claude-session/dispatch/route.ts` | Routing branch — checks `body.model` + `isCodexGatewayConfigured()`, falls through to OpenClaw on miss. |
| `.claude/agents/codex-operator.md` | Managed-agent spec describing constraints (sandbox, egress, trust ladder). |
| `.claude/agents/n8n-strategist.md` | Updated routing logic: when to set `model: 'gpt-5.5-codex'` vs leave unset for Claude. |
| `memory/platform/SECRETS.md` | Documents `CODEX_GATEWAY_URL` / `CODEX_GATEWAY_BEARER_TOKEN` (Nexus-side) + `CODEX_GATEWAY_BEARER` / `CODEX_MODEL` (container-side). |
| `memory/platform/STACK.md` | One-liner pointing to this ADR for execution-heavy work. |
