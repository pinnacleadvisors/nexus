---
type: entity
subtype: concept
title: "OpenClaw"
id: openclaw
created: 2026-05-19
---

# OpenClaw

MyClaw / OpenClaw — Claude Code CLI gateway pattern that lets a Claude Pro subscription serve as an LLM backend instead of pay-per-token API. Used as the legacy SECONDARY fallback in app/api/chat/route.ts. Tool-switchboard architecture is brittle on updates — Nexus rejects that aspect, keeps the gateway-as-LLM-bridge concept.
