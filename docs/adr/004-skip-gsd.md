# 004 — Skip GSD (Get-Shit-Done) skill

- **Date:** 2026-05-06
- **Status:** Accepted

## Context

`gsd-build/get-shit-done` is a meta-prompting framework for Claude Code that introduces:

- A six-command loop: `init` → `discuss` → `plan` → `execute` → `verify` → `ship`
- Persistent artifacts: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`
- Subagent dispatch in fresh 200k-token contexts to combat context rot
- A verify step gating commit/PR

Evaluated as a candidate addition to the Nexus toolkit.

## Decision

**Skip GSD.** Its constructs overlap heavily with infrastructure already in this repo, and adding it would create two competing systems for the same job.

| GSD construct | Nexus equivalent |
|---|---|
| Six-command loop | `claude-evolve:build-project` + `:workflow` + `:verify-completion` skills, plus the 4-step North Star → Explore → Plan → Implement protocol in [CLAUDE.md](../../CLAUDE.md) |
| `PROJECT.md` / `REQUIREMENTS.md` / `STATE.md` | [task_plan.md](../../task_plan.md) (and per-feature `task_plan-<feature>.md`) — the Goal/Success/Constraints + Progress block already covers this |
| `ROADMAP.md` | Already exists at repo root (`ROADMAP.md`) |
| Subagent fresh-context dispatch | Native `Agent` tool with `subagent_type` (used everywhere via `.claude/agents/`) |
| Verify step gating commit | The pre-commit checklist in `AGENTS.md` plus `npm run check:retry-storm` |
| Cross-session memory | The 3-layer memory architecture in CLAUDE.md + memory-hq (a richer system than GSD's flat artifacts) |

Alternatives considered:

- **Adopt GSD's command names as aliases.** Rejected — the names overlap with existing skills (`workflow`, `build-project`) and would confuse routing.
- **Cherry-pick the verify step.** Rejected — `claude-evolve:verify-completion` already does this and is wired in.
- **Adopt GSD only for greenfield Nexus features.** Rejected — Nexus is brownfield by nature; the `task_plan-<feature>.md` pattern handles new features cleanly.

## Consequences

**Easier:**
- One blessed long-horizon protocol (the 4-step in CLAUDE.md) — no doubt about which system to use.
- No new artifacts to keep current; the existing memory layers stay authoritative.

**Harder:**
- If GSD evolves a genuinely novel pattern later, we'll need to revisit and explicitly cherry-pick.

**Must revisit if:**
- The current 4-step protocol drifts and people start ignoring it (signal of inadequacy).
- A new contributor reports the existing system is hard to learn — GSD's smaller surface might be easier onboarding.
