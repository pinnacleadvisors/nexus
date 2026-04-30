@AGENTS.md

---

> **This file is auto-generated** by the `sync-framework.yml` workflow from
> `pinnacleadvisors/memory-hq/framework/`. Do not edit by hand — your changes
> will be overwritten on the next daily sync. To change the framework itself,
> edit `pinnacleadvisors/nexus/docs/framework/` and re-run the bootstrap.
>
> Project-specific stack rules go in `AGENTS.md`, not here.

---

# Agent framework — placeholder

The `.github/workflows/sync-framework.yml` workflow runs daily and replaces
this file with the assembled framework (AGENT-FRAMEWORK.md +
ADAPTERS/CLAUDE-CODE.md) pulled from memory-hq.

If you're seeing this placeholder, the workflow hasn't run yet. Either wait
24h, or trigger it manually:

```bash
gh workflow run sync-framework.yml
```

Or pull manually from any working directory:

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github framework-pull \
  --to=.claude/framework --dropIn=CLAUDE.md
```

Required env: `MEMORY_HQ_TOKEN` (GitHub Actions secret + your local env).
