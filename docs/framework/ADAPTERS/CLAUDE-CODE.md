# Claude Code adapter

Implementation overlay for Anthropic's Claude Code CLI. Read `../AGENT-FRAMEWORK.md` first — this file only documents the Claude-specific bindings. Principles always win over adapter details.

## Instruction file location

| Scope | Path | Loaded by |
|---|---|---|
| Per-user (every repo, every machine) | `~/.claude/CLAUDE.md` | Every Claude Code session |
| Per-repo | `<repo>/CLAUDE.md` | Sessions inside that repo |
| Sub-import | `@AGENTS.md` directive | Whatever file references it |

Recommended setup: framework principles in `~/.claude/CLAUDE.md` (pulled from memory-hq via `framework-pull`), per-repo `CLAUDE.md` carries only project-specific stack rules.

## Tool surface mapping

| Framework concept | Claude Code tool |
|---|---|
| File write | `Write` |
| File edit | `Edit` (with `old_string` / `new_string`) |
| Shell command | `Bash` |
| File read | `Read` (with optional `offset`/`limit`) |
| Search | `Glob`, `Grep` (or delegate to `Explore` agent) |
| Task tracking | `TodoWrite` |
| Sub-agent dispatch | `Agent` (with `subagent_type`) |

## Output cap enforcement

The `PreToolUse` hook in `.claude/settings.json` matches `Write|Edit|Bash` and runs `.claude/hooks/check-write-size.sh`. The script counts lines/bytes in the staged payload and exits with code 2 (block) when over the cap, with a chunking instruction in stderr that the model reads.

Default caps in this org: 300 lines / 10 KB per `Write`/`Edit`, 300 lines per `Bash` heredoc. Override with `WRITE_HOOK_MAX_LINES` / `WRITE_HOOK_MAX_BYTES` env vars (rarely needed).

## Memory HQ — write paths

### MCP server (preferred for in-session writes)

`services/mcp-memory/` exposes five tools to any Claude Code session:
- `memory_atom`, `memory_entity`, `memory_moc`, `memory_query`, `memory_search`

Register per-user in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory-hq": {
      "command": "node",
      "args": ["/absolute/path/to/services/mcp-memory/dist/index.js"],
      "env": {
        "NEXUS_BASE_URL": "https://nexus.example.com",
        "MEMORY_HQ_TOKEN": "github_pat_..."
      }
    }
  }
}
```

After restart, the tools appear under the `memory-hq` namespace. Writes go through `POST /api/memory/event` so provenance + rate-limit are enforced.

### CLI (`cli.mjs --backend=github`)

For shell scripts, hooks, or sessions where MCP isn't registered:

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github \
  --scope=repo:pinnacleadvisors/nexus \
  atom "Acme prefers annual billing" \
  --fact="Confirmed 2026-04-15 in pricing page footer" \
  --locator=url:https://acme.com/pricing
```

The CLI infers `scope.repo` from `git remote get-url origin` when omitted. Set `MOLECULAR_BACKEND=github` to default to GitHub mode without the flag.

### Pulling the framework to your machine

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github framework-pull
# Writes:
#   ~/.claude/CLAUDE.md                     ← combined / drop-in instructions
#   ~/.claude/framework/AGENT-FRAMEWORK.md  ← model-agnostic core (reference)
#   ~/.claude/framework/ADAPTERS/*.md       ← per-model overlays
```

Run after every framework update. Idempotent — safe to wrap in a daily SessionStart hook if you want truly automatic sync.

## Long-horizon plan files

- `task_plan.md` — the active plan (per-repo, gitignored if private)
- `task_plan-<feature>.md` — secondary plans for parallel initiatives

Atomic-task format from §2 of AGENT-FRAMEWORK applies verbatim. Use `Parallel: yes` to mark tasks the `Agent` tool can dispatch concurrently.

## Skill routing — Claude Code-specific tools

When the prompt matches one of these patterns, prefer the listed skill before falling back to general-purpose tools:

| Prompt pattern | Skill |
|---|---|
| Read a public URL | `/firecrawl_local scrape <url>` |
| Discover URLs on a site | `/firecrawl_local map <url>` |
| Crawl a small site (≤ 20 pages) | `/firecrawl_local crawl <url>` |
| Search the open web | built-in `WebSearch`, or Tavily if configured |
| Remember a durable fact | `memory_atom` MCP tool |
| Look up an entity | `memory_search` MCP tool |
| Build a topic hub | `memory_moc` MCP tool |
| Health-check the local graph | `/molecularmemory_local lint --write` |
| Review a PR | `/review` (built-in) |
| Security audit | `/security-review` (built-in) |
| TDD workflow | `/superpowers` TDD skill (if installed) |
| Systematic debugging | `/superpowers` 4-phase debugging skill |
| Reduce permission prompts | `/fewer-permission-prompts` (built-in) |

The `UserPromptSubmit` hook at `.claude/hooks/skill-router.sh` echoes hint blocks for these. Treat the hint as advisory — invoke a skill only when the match is genuine.

## Sub-agent dispatch

Specialised agents in `.claude/agents/` are auto-discovered. Frequent ones in this org:
- `nexus-memory` — platform context lookups
- `nexus-architect` — stack-rule-aware design
- `nexus-tester` — pre-commit TS + boundary checks
- `agent-generator` — emits new managed agent specs
- `firecrawl` — web scraping
- `supermemory` — memory-hq writer (terminal node — does not chain)
- `workflow-optimizer` — review-feedback driven agent diffs
- `n8n-strategist` — workflow JSON generation
- `doppler-broker` — secret-gated commands without leaking the secret

Dispatch via the `Agent` tool with `subagent_type=<slug>`. For independent work, send multiple `Agent` calls in one assistant turn so they run in parallel.

## Required env (Claude Code-side)

| Var | Purpose |
|---|---|
| `MEMORY_HQ_TOKEN` | Bearer for `/api/memory/event` and `/api/memory/query` |
| `MEMORY_HQ_REPO` | Default `pinnacleadvisors/memory-hq` |
| `MOLECULAR_BACKEND` | `local` (default) or `github` — sets the CLI's default backend |
| `MEMORY_AUTHOR` | Stamps `frontmatter.author` on writes (e.g. `claude-agent:research`). Defaults to `cli`. |
| `NEXUS_BASE_URL` | For the MCP server's `/api/memory/*` calls |

All managed via Doppler in this org — never committed.
