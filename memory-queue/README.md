# memory-queue/

This folder is a staging area for pending nexus-memory updates.

Claude Code drops Markdown files here when it produces knowledge worth persisting
(agent outputs, new docs, architecture decisions, etc.). Running `npm run populate-memory`
processes every file in this folder, writes it to the `nexus-memory` GitHub repo,
then **deletes** the file so it isn't processed twice.

## File format

Each file must start with a YAML frontmatter block:

```markdown
---
memory_path: platform/STACK.md
memory_mode: append
---

...content to write or append...
```

### Frontmatter fields

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `memory_path` | yes | e.g. `agent-runs/2026-04-16/research-123.md` | Destination path inside nexus-memory repo |
| `memory_mode` | yes | `write` or `append` | `write` overwrites the file; `append` adds content after existing content |

## Example — write a new agent-run log

```markdown
---
memory_path: agent-runs/2026-04-16/seo-audit-1713312000000.md
memory_mode: write
---

# SEO Audit — Acme Corp
_Generated: 2026-04-16T10:00:00.000Z_

## Summary
...
```

## Example — append to an existing platform doc

```markdown
---
memory_path: platform/ARCHITECTURE.md
memory_mode: append
---

## New API Route — /api/video/generate

Added in Phase 18a. POST endpoint that auto-selects Kling or Runway...
```

## Processing

Run locally on your MacBook (requires Doppler with MEMORY_TOKEN + MEMORY_REPO):

```bash
npm run populate-memory
```

Or without Doppler (env vars must already be set):

```bash
npm run populate-memory:local
```

The script will:
1. Scan `memory-queue/` for `*.md` files (excluding this README)
2. Parse the YAML frontmatter
3. Write or append to the corresponding path in nexus-memory
4. Delete the processed file from `memory-queue/`
5. Print a summary of successes and failures
