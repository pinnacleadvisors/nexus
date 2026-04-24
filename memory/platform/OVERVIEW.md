# Nexus — Product Overview

## What it is

Nexus is an all-in-one business automation platform. AI agents (Claude, OpenClaw) build, market, and maintain business ideas autonomously. The owner monitors and approves work via a secure web dashboard.

**Single-owner platform** — designed for one operator managing multiple AI-driven business projects. Access locked via `ALLOWED_USER_IDS` in Doppler.

## All Pages

| URL | Page | Purpose |
|-----|------|---------|
| `/` | Sign-in | Clerk auth gate |
| `/forge` | Idea Forge | Streaming Claude chatbot; business consulting + milestone extraction; Gantt view; OpenClaw dispatch |
| `/dashboard` | Operations Dashboard | KPI grid, revenue/cost chart, agent performance table, alerts panel |
| `/dashboard/org` | Org Chart | Live agent hierarchy tree (L0 User → L1 Strategic Queens → L2 Tactical → L3 Specialist → L4 Workers) |
| `/board` | Kanban Board | 4-column drag-and-drop (Backlog → In Progress → Review → Completed); asset preview; approve/reject flow |
| `/swarm` | Swarm Orchestration | Goal → Queen → specialist agents → consensus → synthesis; real-time event log |
| `/graph` | 3D Knowledge Graph | Three.js 3D relational graph; nodes = businesses/projects/agents/tools; force-directed + Louvain clusters |
| `/build` | Dev Console | Feature/bug request → Claude Opus plan → OpenClaw dispatch; Research Loop tab (weekly Tavily digest) |
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
