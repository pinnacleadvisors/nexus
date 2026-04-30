# <Your project> — Agent & contributor guidelines

> Replace this placeholder with **your** project-specific stack rules,
> file-structure conventions, and pre-commit checklist. Cross-project rules
> (memory architecture, output discipline, memory-hq protocol, multi-model
> collaboration) live in `CLAUDE.md` and are auto-synced from memory-hq.

## Project Overview

<one-paragraph description of what this project does>

## Stack rules

- <e.g. Python 3.12, ruff, pytest>
- <e.g. Node 20+, pnpm, vitest>
- <e.g. Rust 1.78, cargo fmt>

## File structure

```
<directory tree>
```

## Secrets

All secrets live in <Doppler / env / 1Password>. Required:

- `MEMORY_HQ_TOKEN` — fine-grained GitHub PAT, contents:rw on
  `pinnacleadvisors/memory-hq` only. Used by the molecular memory CLI and
  the daily framework-sync workflow.

## Pre-commit checklist

- [ ] <typecheck / lint / format passes>
- [ ] <tests pass>
- [ ] No secrets staged (`git diff --staged`)
- [ ] Memory-hq atoms written for any durable findings (see CLAUDE.md §4)
