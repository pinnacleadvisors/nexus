# Nexus — Product Overview

## What it is

Nexus is an all-in-one business automation platform. AI agents (Claude, OpenClaw) build, market, and maintain business ideas autonomously. The owner monitors and approves work via a secure web dashboard.

**Single-owner platform** — designed for one operator managing multiple AI-driven business projects. Access locked via `ALLOWED_USER_IDS` in Doppler.

## All Pages

| URL | Page | Purpose |
|-----|------|---------|
| `/` | Sign-in | Clerk auth gate |
| `/idea` | Ideas (capture + library) | Two modes — Remodel a URL (Firecrawl + Tavily-grounded) or Description; produces structured idea cards with cost/revenue/automation %; library below |
| `/idea-library` | Redirect → `/idea` | Legacy URL kept for back-compat |
| `/forge` | Idea Forge | Streaming Claude chatbot; business consulting + milestone extraction; Gantt view; OpenClaw dispatch |
| `/dashboard` | Mission Control | KPI grid, today's spend, active runs panel, pending reviews, agent performance, alerts; Failures badge → `/manage-platform` |
| `/dashboard/org` | Org Chart | Live agent hierarchy tree (L0 User → L1 Strategic Queens → L2 Tactical → L3 Specialist → L4 Workers) |
| `/board` | Kanban Board / Pipeline | 4-column drag-and-drop (Backlog → In Progress → Review → Completed); asset preview; approve/reject flow; manual-task ranking by dependent count |
| `/swarm` | Swarm Orchestration | Goal → Queen → specialist agents → consensus → synthesis; real-time event log |
| `/graph` | 3D Knowledge Graph | Three.js 3D relational graph; nodes = businesses/projects/agents/tools; force-directed + Louvain clusters |
| `/learn` | Learn (Phase 23) | Duolingo path + FSRS-4 spaced repetition; 4 card kinds derived from `mol_atoms`; "Run sync now" button calls `/api/cron/sync-learning-cards` |
| `/signals` | Signals | Daily LLM council over Tavily/Firecrawl signals; "Run council now" for ad-hoc dispatch |
| `/build` | Dev Console | Feature/bug request → Claude Opus plan → OpenClaw dispatch; Research Loop tab (weekly Tavily digest); diff viewer (A12) |
| `/manage-platform` | Admin surface | System health (cron freshness, gateway, webhook, Sentry); orphan card cleanup; research-loop trigger |
| `/automation-library` | Automations | n8n workflow library; import-error surfacing |
| `/settings/businesses` | Businesses | CRUD for `business_operators` rows; Slack channel + webhook URL with on-save verification |
| `/tools/agents` | Agent Capabilities | 10+ specialist agents: research, content, code, SEO, social, email, design, finance, legal, consultant, neuro-content |
| `/tools/claw` | OpenClaw Config | Gateway URL + skill registry + skill audit log + status page + code task dispatch |
| `/tools/content` | Tribe v2 | Neuro-optimised content: format picker, tone picker, generate, score (12 cognitive principles), A/B variants |
| `/tools/knowledge` | Knowledge Base | Notion + Obsidian integration; link pages to projects; RAG for agent context |
| `/tools/library` | Library | Reusable code snippets, agent templates, prompt templates, skill definitions; auto-populated from agent runs |
| `/tools/memory` | Memory Viewer | Browse/search/edit the GitHub-backed agent memory store (Phase 20) |
| `/tools/n8n` | Workflows | n8n workflow management; 8 templates; AI generator; OpenClaw bridge for non-API steps |
| `/tools/video` | Video Pipeline | Script-to-video (Kling/Runway); UGC/talking-head (HeyGen/D-ID) — partial Phase 18 |

## Design Principles

- **Token efficiency first** — sliding window summarisation, prompt caching, library reuse before generation, molecular-memory MOC navigation (`/molecularmemory_local`)
- **Approval-gated autonomy** — agents propose, human approves at Board; no auto-merge to main
- **Fallback-safe** — every data source tries live (Supabase/GitHub) first, falls back to mock when unconfigured
- **Single binary of truth** — `ROADMAP.md` tracks all feature status; memory files are dense summaries, never duplicates

## Agent Priority

1. OpenClaw (Claude Pro — no API cost, browser automation capable)
2. `ANTHROPIC_API_KEY` (direct Anthropic — pay-per-token)
3. Helpful error message explaining what to configure
