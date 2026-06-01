import { spawn } from 'node:child_process'
import { readAgentSystemPrompt } from './agentSpec.js'
import { loadAgentHooks, writeMergedSettings, cleanupMergedSettings } from './agentHooks.js'

export interface RunArgs {
  agentSlug:  string | null
  message:    string
  env:        Record<string, string>
  repoPath:   string
  timeoutMs?: number
  /** Override the binary location for tests; defaults to whatever PATH resolves. */
  binary?:    string
  /**
   * Optional streaming callback. Fires once per assistant text delta with the
   * incremental string. The final RunResult is still returned with the full
   * concatenated content so non-streaming callers behave unchanged.
   */
  onDelta?:   (delta: string) => void
  /**
   * Optional tool-event callback. Fires twice per tool call:
   *   1. when the CLI's `assistant` event surfaces a `tool_use` block
   *      (record has id+name+input+startedAt; output is still undefined)
   *   2. when the matching `tool_result` block arrives (record gains
   *      output, isError, finishedAt)
   * Callers (chat SSE bridges) use this to render progressive
   * "Wrench → CheckCircle" cards in real time instead of waiting for
   * the whole turn to complete. The final RunResult.toolCalls still
   * contains the same set so non-streaming callers behave unchanged.
   */
  onToolEvent?: (record: ToolCallRecord) => void
  /**
   * Gateway jobId — injected into the child env as NEXUS_JOB_ID. Consumed by
   * the mcp-permission-broker (PR #189) so it can correlate a pending CLI
   * permission request to the right chat turn. When omitted, the broker
   * returns a hard-deny on any tool-permission call (fail-safe).
   */
  jobId?:     string
  /**
   * Per-turn model override (Phase 1 of task_plan-collaborative-chat.md).
   * When set, the CLI is invoked with `--model <id>` so this turn runs on
   * the chosen model instead of the OAuth-bound default (Opus 4.7). Invalid
   * ids surface as a CLI error in the turn's stderr.
   */
  model?:     string
}

/**
 * Tool-use event observed in the CLI's stream-json output (Phase 2b of
 * task_plan-chat.md). Captured per turn for UI rendering on the Vercel
 * side — chat renders a collapsible card per call so the operator sees
 * "what Claude is actually doing".
 */
export interface ToolCallRecord {
  /** Stable id from the CLI event; matches tool_use ↔ tool_result. */
  id:          string
  /** Tool name, e.g. "mcp__composio-admin__admin_execute_action", "Bash". */
  name:        string
  input:       unknown
  output?:     unknown
  isError?:    boolean
  startedAt:   number
  finishedAt?: number
}

export interface RunResult {
  ok:         boolean
  content:    string
  error?:     string
  durationMs: number
  /** Phase 2b — tool calls observed during this turn. */
  toolCalls?: ToolCallRecord[]
  usage?:     {
    input_tokens?:  number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  model?:     string
  sessionId?: string
}

/**
 * Tools pre-allowed for every spawned agent — the workhorse tools + the
 * trusted MCP servers. Shared by BOTH spawn paths (print `runClaude` and
 * interactive `runClaudePty`) so tool-permission behaviour doesn't depend on
 * the billing mode. Mirrors the permissions.allow block entrypoint.sh writes.
 *
 * Safe under the container threat model (ephemeral /repo clone, no financial
 * secrets in this gateway's env per ADR 002). Anything NOT in this list is
 * routed to the permission-broker MCP, which surfaces an Allow/Deny card in
 * the chat UI.
 */
export const PRE_ALLOWED_TOOLS = [
  // MCP — Composio admin-scope wrapper
  'mcp__composio-admin__admin_list_connected_platforms',
  'mcp__composio-admin__admin_list_actions',
  'mcp__composio-admin__admin_execute_action',
  // MCP — memory-hq
  'mcp__memory-hq__memory_atom',
  'mcp__memory-hq__memory_entity',
  'mcp__memory-hq__memory_moc',
  'mcp__memory-hq__memory_query',
  'mcp__memory-hq__memory_search',
  // MCP — codex-delegate (only registered when the codex-gateway env is set)
  'mcp__codex-delegate__delegate_to_codex',
  // MCP — permission-broker (PR #189; only registered when the broker MCP builds)
  'mcp__permission-broker__permission_prompt',
  // MCP — coolify (PR #191; only registered when COOLIFY_KVM4_* envs are set)
  'mcp__coolify__coolify_list_apps',
  'mcp__coolify__coolify_get_app',
  'mcp__coolify__coolify_get_logs',
  'mcp__coolify__coolify_list_env_keys',
  'mcp__coolify__coolify_get_env_value',
  'mcp__coolify__coolify_redeploy',
  'mcp__coolify__coolify_restart',
  'mcp__coolify__coolify_start',
  'mcp__coolify__coolify_stop',
  'mcp__coolify__coolify_set_env',
  'mcp__coolify__coolify_delete_env',
  // Workhorse tools — bounded by the container, gated at chat-level via
  // approval-request blocks and the permission-broker for un-allowed cases
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Read',
  'Glob',
  'Grep',
  'LS',
  'BashOutput',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
]

/**
 * Build the CLI permission args shared by both spawn paths: pre-allow the
 * trusted tools, then point anything else at the permission-broker MCP
 * (unless MCP_PERMISSION_BROKER=skip). The broker writes a pending row to
 * chat_permission_requests and surfaces an Allow/Deny card in the chat.
 *
 * The interactive (pty) path relies on THIS instead of `--permission-mode
 * bypassPermissions`: in interactive mode bypass triggers a one-time
 * acceptance dialog (default "No, exit") that no operator is at the pty to
 * answer, so the session would exit ~1s later with no output.
 */
export function buildPermissionCliArgs(): string[] {
  const out: string[] = []
  for (const t of PRE_ALLOWED_TOOLS) out.push('--allowedTools', t)
  if ((process.env.MCP_PERMISSION_BROKER ?? '') !== 'skip') {
    out.push('--permission-prompt-tool', 'mcp__permission-broker__permission_prompt')
  }
  return out
}

/**
 * Spawns `claude -p --output-format stream-json` and accumulates the final
 * assistant message. The CLI authenticates against the OAuth credentials in
 * /root/.claude (mounted from a persistent Coolify volume).
 *
 * stream-json output is one JSON event per line; we look for the terminal
 * `result` event which carries `result`, `total_cost_usd`, and `usage`. Falls
 * back to capturing assistant message deltas if the result event is missing.
 */
export async function runClaude(args: RunArgs): Promise<RunResult> {
  const started = Date.now()
  const timeoutMs = args.timeoutMs ?? 120_000

  let systemPrompt: string | null = null
  if (args.agentSlug) {
    systemPrompt = await readAgentSystemPrompt(args.repoPath, args.agentSlug)
  }

  // Max agentic-loop turns the CLI may take before exiting with code 1.
  //
  // Why 200 (was 25): at ~7-8s per CLI turn, 25 turns hit the wall at
  // ~175-200s — operators with the 15-min wall-clock dropdown saw their
  // turns crash at that mark with "claude CLI exited with code 1" and
  // were confused because the wall-clock cap hadn't been reached. The
  // wall-clock REQUEST_MAX_MS (default 10min) is the real soft cap;
  // max-turns should be high enough that the agent has room to do real
  // work without hitting it as a side limit. 200 turns × 8s ≈ 26min,
  // comfortably above the wall-clock floor.
  //
  // Override via CLAUDE_MAX_TURNS env on the gateway container.
  const maxTurns = Number(process.env.CLAUDE_MAX_TURNS ?? 200)

  const cliArgs = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 200),
  ]
  // Per-turn model override. When omitted, the CLI uses the OAuth-bound
  // default (typically claude-opus-4-7). See lib/chat/models.ts for the
  // Nexus-side whitelist of accepted ids. Invalid ids surface as a clear
  // CLI error in the turn's stderr — no special handling here.
  if (args.model) {
    cliArgs.push('--model', args.model)
  }
  // MCP loading: `claude -p` (print/non-interactive mode) does NOT reliably
  // auto-load ~/.claude/settings.json across versions. The entrypoint writes
  // the MCP server registrations to /root/.claude/settings.json at boot, but
  // each per-request CLI spawn needs the path explicitly. --strict-mcp-config
  // makes discovery deterministic (only this file, no fallback hunting).
  // Skip when MCP_CONFIG_PATH=skip — useful for tests that intentionally run
  // without MCP, or to revert behaviour during incident response.
  const baseConfigPath = process.env.MCP_CONFIG_PATH ?? '/root/.claude/settings.json'

  // Phase 6 v2 of task_plan-collaborative-chat.md — merge per-agent hooks
  // from `agent_library.hooks` (migration 055) on top of the repo-wide
  // settings.json the entrypoint wrote at boot. Result is written to a
  // per-spawn temp file in /tmp; the original /root/.claude/settings.json
  // stays the repo-wide baseline so the next spawn's merge starts from a
  // clean slate. Fail-soft: no agent / no hooks / unreachable Supabase /
  // unreadable settings.json all fall through to baseConfigPath unchanged.
  let mcpConfigPath = baseConfigPath
  let tmpSettingsPath: string | null = null
  if (args.agentSlug && baseConfigPath !== 'skip') {
    const hooks = await loadAgentHooks(args.agentSlug)
    if (hooks) {
      const merged = await writeMergedSettings({
        basePath: baseConfigPath,
        hooks,
        jobId:    args.jobId ?? null,
      })
      if (merged) {
        mcpConfigPath = merged
        tmpSettingsPath = merged
        console.log(`[gw] merged ${Object.keys(hooks).length} hook-event(s) for agent=${args.agentSlug} → ${merged}`)
      }
    }
  }

  if (mcpConfigPath && mcpConfigPath !== 'skip') {
    cliArgs.push('--mcp-config', mcpConfigPath, '--strict-mcp-config')
  }

  // Pre-allow the trusted MCP tools + workhorse tools and route anything else
  // to the permission-broker MCP. Shared with the interactive (pty) path via
  // buildPermissionCliArgs() so both billing modes behave identically.
  cliArgs.push(...buildPermissionCliArgs())
  if (systemPrompt) {
    cliArgs.push('--append-system-prompt', systemPrompt)
  }
  cliArgs.push(args.message)

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...args.env,
  }
  // Force plan-mode auth: any of these would override the OAuth token in
  // /root/.claude/.credentials.json and silently route to API/Bedrock/Vertex billing.
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.CLAUDE_CODE_USE_BEDROCK
  delete childEnv.CLAUDE_CODE_USE_VERTEX
  // Surface the gateway's jobId to spawned MCP servers (currently only
  // mcp-permission-broker consumes it). Absence = broker fail-safes to deny.
  if (args.jobId) childEnv.NEXUS_JOB_ID = args.jobId

  console.log(`[gw] spawn claude agent=${args.agentSlug ?? 'none'} msgLen=${args.message.length}`)

  return await new Promise<RunResult>(resolve => {
    const child = spawn(args.binary ?? 'claude', cliArgs, {
      cwd:   args.repoPath,
      env:   childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let lastAssistantText = ''
    /** Tool-use records keyed by CLI tool_use_id, accumulated as the agent runs. */
    const toolCalls = new Map<string, ToolCallRecord>()
    let result: RunResult = { ok: false, content: '', durationMs: 0 }
    let resolved = false

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      child.kill('SIGTERM')
      void cleanupMergedSettings(tmpSettingsPath)
      resolve({
        ok:         false,
        content:    lastAssistantText,
        error:      `claude CLI timeout after ${timeoutMs}ms`,
        durationMs: Date.now() - started,
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdoutBuf += chunk.toString('utf8')
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        try {
          const event = JSON.parse(line) as Record<string, unknown>
          handleEvent(event)
        } catch {
          // Non-JSON line — ignore. Some early CLI messages are plain text.
        }
      }
    })

    child.stderr.on('data', chunk => {
      stderrBuf += chunk.toString('utf8')
    })

    child.on('error', err => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      void cleanupMergedSettings(tmpSettingsPath)
      resolve({
        ok:         false,
        content:    '',
        error:      `failed to spawn claude CLI: ${(err as Error).message}`,
        durationMs: Date.now() - started,
      })
    })

    child.on('close', code => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      void cleanupMergedSettings(tmpSettingsPath)
      if (result.content) {
        result.durationMs = Date.now() - started
        result.ok = code === 0
        if (code !== 0 && !result.error) {
          result.error = `claude CLI exited with code ${code}: ${stderrBuf.slice(-512)}`
        }
        resolve(result)
        return
      }
      resolve({
        ok:         code === 0 && !!lastAssistantText,
        content:    lastAssistantText,
        error:      code === 0 ? undefined : `claude CLI exited with code ${code}: ${stderrBuf.slice(-512)}`,
        durationMs: Date.now() - started,
        toolCalls:  toolCalls.size > 0 ? [...toolCalls.values()] : undefined,
      })
    })

    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string | undefined

      if (type === 'system' && (event.subtype === 'init' || event.subtype === 'session_started')) {
        const sid = event.session_id as string | undefined
        if (sid) result.sessionId = sid
      }

      if (type === 'assistant' && event.message) {
        const message = event.message as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }> }
        const blocks = message.content ?? []
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string') {
            lastAssistantText += block.text
            if (args.onDelta) {
              try { args.onDelta(block.text) } catch { /* swallow */ }
            }
          }
          // Phase 2b — capture tool_use blocks. Matched to the eventual
          // tool_result block via the same tool_use_id when it lands.
          if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
            const record: ToolCallRecord = {
              id:        block.id,
              name:      block.name,
              input:     block.input,
              startedAt: Date.now(),
            }
            toolCalls.set(block.id, record)
            if (args.onToolEvent) {
              try { args.onToolEvent(record) } catch { /* swallow */ }
            }
          }
        }
      }

      // tool_result blocks arrive inside `user` events synthesised by the
      // CLI when a tool returns. Match by tool_use_id and attach output.
      if (type === 'user' && event.message) {
        const message = event.message as { content?: Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> }
        for (const block of message.content ?? []) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const rec = toolCalls.get(block.tool_use_id)
            if (rec) {
              rec.output     = block.content
              rec.isError    = block.is_error === true
              rec.finishedAt = Date.now()
              if (args.onToolEvent) {
                try { args.onToolEvent(rec) } catch { /* swallow */ }
              }
            }
          }
        }
      }

      if (type === 'result') {
        const text = (event.result as string) ?? lastAssistantText
        result = {
          ok:         (event.subtype as string | undefined) !== 'error',
          content:    text,
          durationMs: Date.now() - started,
          toolCalls:  toolCalls.size > 0 ? [...toolCalls.values()] : undefined,
          usage:      event.usage as RunResult['usage'],
          model:      event.model as string | undefined,
          sessionId:  result.sessionId ?? (event.session_id as string | undefined),
        }
      }
    }
  })
}
