/**
 * agentHooks — fetches per-agent hooks from the `agent_library.hooks` jsonb
 * column (migration 055) and merges them with the repo-wide hooks baked into
 * `/root/.claude/settings.json` by entrypoint.sh.
 *
 * Phase 6 v2 of task_plan-collaborative-chat.md. Migration 055 added the
 * column + the convention; this module is the entrypoint wiring that
 * actually consumes it.
 *
 * Why per-spawn instead of at boot:
 *   - The gateway runs many different agents (platform-copilot, business-
 *     copilot, codex-maintainer, …) from the same container. Each can ship
 *     its own hook config. Baking them at boot would either pick one
 *     arbitrarily or union every agent's hooks (running everyone's hooks
 *     for every spawn — wasteful + surprising).
 *   - Per-spawn lets the merge happen with the *spawned slug's* hooks only.
 *
 * Why fail-soft:
 *   - If Supabase is unreachable / the env is missing / the row doesn't
 *     exist, fall back to the repo-wide hooks unchanged. The feature is
 *     additive — never blocks a spawn.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * Hooks shape — mirrors Claude Code's settings.json `hooks` key. Per event
 * (PreToolUse / UserPromptSubmit / SessionStart / Stop / SubagentStop /
 * Notification / PreCompact), an array of matcher groups. Stored as jsonb,
 * loaded as unknown — we re-validate shape lightly before merging so a
 * broken agent row can't poison the CLI's settings.json parse.
 */
export type AgentHooks = Record<string, unknown[]>

/**
 * Fetches the `hooks` column for a single agent slug. Returns null when:
 *   - Supabase env is missing (gateway running without the service role key)
 *   - The slug doesn't match a row
 *   - The fetch fails or times out
 *   - The row's hooks column is empty (`{}` — the migration's default)
 *
 * Logged at WARN level (not error) on failure paths so the gateway logs stay
 * readable; the spawn proceeds with repo-wide hooks only.
 */
export async function loadAgentHooks(slug: string): Promise<AgentHooks | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return null

  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/agent_library`)
    url.searchParams.set('slug',   `eq.${slug}`)
    url.searchParams.set('select', 'hooks')
    url.searchParams.set('limit',  '1')
    const res = await fetch(url.toString(), {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept:        'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.warn(`[gw] agentHooks fetch failed: ${res.status}`)
      return null
    }
    const rows = (await res.json()) as Array<{ hooks?: unknown }>
    const hooks = rows[0]?.hooks
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return null
    const keys = Object.keys(hooks as Record<string, unknown>)
    if (keys.length === 0) return null
    return hooks as AgentHooks
  } catch (err) {
    console.warn(`[gw] agentHooks fetch error: ${(err as Error).message}`)
    return null
  }
}

/**
 * Reads /root/.claude/settings.json (the repo-wide config written by
 * entrypoint.sh at boot), splices in per-agent hooks (additive — agent
 * matcher groups APPEND to repo matcher groups for the same event), and
 * writes the merged config to a per-job temp file. Returns the temp path
 * for `--mcp-config`.
 *
 * Returns null on any error — caller falls back to the base path.
 *
 * Merge semantics:
 *   - For each event key in agent hooks (PreToolUse, UserPromptSubmit, …),
 *     CONCAT agent groups onto repo groups. Matcher groups don't have ids
 *     so deduplication isn't meaningful at this layer.
 *   - The agent CANNOT remove repo hooks. This is intentional: the repo
 *     hooks are baseline guardrails (check-write-size.sh, skill-router).
 *     Per-agent hooks ADD to them, never override.
 *   - Non-hooks keys (mcpServers, permissions, …) come from the repo
 *     settings unchanged.
 */
export async function writeMergedSettings(args: {
  basePath: string
  hooks:    AgentHooks
  jobId:    string | null
}): Promise<string | null> {
  try {
    const raw = await fs.readFile(args.basePath, 'utf8')
    const base = JSON.parse(raw) as Record<string, unknown>

    const baseHooks = (base.hooks ?? {}) as Record<string, unknown[]>
    const merged: Record<string, unknown[]> = { ...baseHooks }
    for (const [event, groups] of Object.entries(args.hooks)) {
      if (!Array.isArray(groups)) continue
      const existing = Array.isArray(merged[event]) ? merged[event] : []
      merged[event] = [...existing, ...groups]
    }

    const out: Record<string, unknown> = { ...base, hooks: merged }

    // Suffix with a sortable timestamp + jobId so concurrent spawns don't
    // race on the same path. /tmp is the right place — ephemeral, container-
    // local, cleaned on container restart even if we miss the explicit
    // unlink in cleanupMergedSettings.
    const idPart = args.jobId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tmpPath = path.join(os.tmpdir(), `nexus-settings-${idPart}.json`)
    await fs.writeFile(tmpPath, JSON.stringify(out), 'utf8')
    return tmpPath
  } catch (err) {
    console.warn(`[gw] writeMergedSettings failed: ${(err as Error).message}`)
    return null
  }
}

/** Best-effort unlink — never throws. Called after the CLI exits. */
export async function cleanupMergedSettings(tmpPath: string | null): Promise<void> {
  if (!tmpPath) return
  try { await fs.unlink(tmpPath) } catch { /* ignore */ }
}
