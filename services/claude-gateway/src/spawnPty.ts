/**
 * runClaudePty — the SUBSCRIPTION-BILLED execution path.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `claude -p` (the path in spawn.ts) bills at the expensive per-token API
 * rate, NOT the flat Max/Pro subscription — confirmed even with OAuth and no
 * ANTHROPIC_API_KEY (anthropics/claude-code #43333, #37686). Anthropic's
 * June-15-2026 change makes this explicit: `-p` / Agent-SDK usage moves to a
 * separate API-metered credit, while subscription limits "stay reserved for
 * INTERACTIVE use of Claude Code". The CLI keys billing off non-interactive
 * detection ("via -p, OR when stdout is not a TTY" — `claude --help`).
 *
 * So to bill against the Max plan we must run `claude` as a GENUINE
 * INTERACTIVE session: a real pseudo-terminal (node-pty), no `-p`.
 *
 * THE OUTPUT PROBLEM + SOLUTION
 * ─────────────────────────────
 * Interactive mode has no `--output-format stream-json` (that flag is
 * --print-only) and the TUI uses cursor-movement escapes for spacing, so
 * scraping it is hopeless. Instead we pin a known `--session-id <uuid>` and
 * read Claude Code's own append-only JSONL transcript at
 * ~/.claude/projects/<cwd-slug>/<uuid>.jsonl — clean, structured events with
 * the same `message.content` block shape the stream-json parser uses.
 *
 * The pty is used ONLY to (a) make the session interactive (billing) and
 * (b) submit the prompt. All output is read from the JSONL.
 *
 * This NEVER falls back to `-p` on failure — that would silently re-introduce
 * API billing, defeating the whole point. On failure it returns a clear error.
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { readAgentSystemPrompt } from './agentSpec.js'
import { loadAgentHooks, writeMergedSettings, cleanupMergedSettings } from './agentHooks.js'
import type { RunArgs, RunResult } from './spawn.js'
import { emptyTranscriptState, applyTranscriptLine, turnComplete, transcriptPathFor } from './transcript.js'

// ── pty loader (lazy + non-fatal) ───────────────────────────────────────────

type PtyProcess = {
  onData: (cb: (d: string) => void) => void
  onExit: (cb: () => void) => void
  write:  (d: string) => void
  kill:   (signal?: string) => void
}
type PtySpawn = (file: string, args: string[], opts: Record<string, unknown>) => PtyProcess

/**
 * Import node-pty lazily so a missing/broken native binary breaks ONLY
 * pty-mode turns (clear error) — never the whole gateway. The print path in
 * spawn.ts keeps working regardless.
 */
async function loadPtySpawn(): Promise<PtySpawn> {
  const mod = await import('@homebridge/node-pty-prebuilt-multiarch') as unknown as
    { spawn?: PtySpawn; default?: { spawn?: PtySpawn } }
  const spawn = mod.spawn ?? mod.default?.spawn
  if (typeof spawn !== 'function') throw new Error('node-pty spawn export not found')
  return spawn
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runClaudePty(args: RunArgs): Promise<RunResult> {
  const started   = Date.now()
  const timeoutMs = args.timeoutMs ?? 600_000
  const POLL_MS   = Number(process.env.PTY_POLL_MS ?? 400)
  const IDLE_MS   = Number(process.env.PTY_IDLE_MS ?? 4_000)
  const FIRST_MS  = Number(process.env.PTY_FIRST_RESPONSE_MS ?? 180_000)

  let ptySpawn: PtySpawn
  try { ptySpawn = await loadPtySpawn() } catch (err) {
    return { ok: false, content: '', durationMs: Date.now() - started,
      error: `pty execution unavailable (node-pty failed to load: ${(err as Error).message}). Switch execution_mode to 'subscription' to use the -p path, or rebuild the gateway image.` }
  }

  const sessionId = randomUUID()
  const transcriptFile = transcriptPathFor(args.repoPath, sessionId)

  let systemPrompt: string | null = null
  if (args.agentSlug) systemPrompt = await readAgentSystemPrompt(args.repoPath, args.agentSlug)

  // Merge per-agent hooks onto the repo-wide settings, same as the -p path.
  const baseConfigPath = process.env.MCP_CONFIG_PATH ?? '/root/.claude/settings.json'
  let mcpConfigPath = baseConfigPath
  let tmpSettingsPath: string | null = null
  if (args.agentSlug && baseConfigPath !== 'skip') {
    const hooks = await loadAgentHooks(args.agentSlug)
    if (hooks) {
      const merged = await writeMergedSettings({ basePath: baseConfigPath, hooks, jobId: args.jobId ?? null })
      if (merged) { mcpConfigPath = merged; tmpSettingsPath = merged }
    }
  }

  // Interactive invocation — NO `-p`. bypassPermissions because there is no
  // operator at the pty to approve tool calls (the container is the bound).
  const cliArgs: string[] = ['--session-id', sessionId, '--permission-mode', 'bypassPermissions']
  if (args.model) cliArgs.push('--model', args.model)
  if (mcpConfigPath && mcpConfigPath !== 'skip') cliArgs.push('--mcp-config', mcpConfigPath, '--strict-mcp-config')
  if (systemPrompt) cliArgs.push('--append-system-prompt', systemPrompt)
  cliArgs.push(args.message)   // positional prompt → auto-runs in interactive mode

  const childEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') childEnv[k] = v
  Object.assign(childEnv, args.env)
  // Force subscription/OAuth auth — any of these would route to API billing.
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.CLAUDE_CODE_USE_BEDROCK
  delete childEnv.CLAUDE_CODE_USE_VERTEX
  // Defensive: never let a parent "running inside Claude Code" marker leak in
  // (it forces non-interactive behaviour, breaking billing + the TUI).
  delete childEnv.CLAUDECODE
  delete childEnv.CLAUDE_CODE_ENTRYPOINT
  childEnv.TERM = 'xterm-256color'
  if (args.jobId) childEnv.NEXUS_JOB_ID = args.jobId

  console.log(`[gw] spawn claude (pty/interactive) agent=${args.agentSlug ?? 'none'} session=${sessionId} msgLen=${args.message.length}`)

  const state = emptyTranscriptState()
  let consumed = 0
  let lastGrowthAt = Date.now()

  async function pump(): Promise<void> {
    const raw = await fs.readFile(transcriptFile, 'utf8').catch(() => '')
    if (raw.length <= consumed) return
    const fresh = raw.slice(consumed)
    const lastNl = fresh.lastIndexOf('\n')
    if (lastNl === -1) return            // last line still being written
    consumed += lastNl + 1
    for (const line of fresh.slice(0, lastNl).split('\n')) {
      if (applyTranscriptLine(line, state, Date.now(), args.onDelta, args.onToolEvent)) lastGrowthAt = Date.now()
    }
  }

  let ptyExited = false
  let term: PtyProcess
  try {
    term = ptySpawn('claude', cliArgs, { name: 'xterm-256color', cols: 120, rows: 40, cwd: args.repoPath, env: childEnv })
  } catch (err) {
    void cleanupMergedSettings(tmpSettingsPath)
    return { ok: false, content: '', durationMs: Date.now() - started, error: `failed to spawn pty claude: ${(err as Error).message}` }
  }
  term.onData(() => { /* drain TUI bytes; output comes from the JSONL */ })
  term.onExit(() => { ptyExited = true })

  let timedOut = false
  for (;;) {
    await sleep(POLL_MS)
    await pump()
    const now = Date.now()
    if (turnComplete(state, IDLE_MS, lastGrowthAt, now)) break
    if (ptyExited) { await pump(); break }
    if (now - started > timeoutMs) { timedOut = true; break }
    if (!state.assistantSeen && now - started > FIRST_MS) { timedOut = true; break }
  }

  // Graceful exit, then hard kill. The response is already captured from the
  // JSONL, so killing mid-render is safe.
  try { term.write('\x03') } catch { /* ignore */ }
  try { term.write('/exit\r') } catch { /* ignore */ }
  await sleep(300)
  try { term.kill() } catch { /* ignore */ }
  await pump()
  void cleanupMergedSettings(tmpSettingsPath)

  const durationMs = Date.now() - started
  if (timedOut && !state.assistantSeen) {
    return { ok: false, content: '', durationMs, sessionId,
      error: state.assistantSeen ? `claude pty turn timed out after ${timeoutMs}ms` : `claude pty produced no response within ${Math.round(FIRST_MS / 1000)}s (transcript ${transcriptFile} never gained an assistant message — is the gateway logged in via OAuth?)` }
  }
  return {
    ok:         state.text.length > 0 && !timedOut,
    content:    state.text,
    error:      timedOut ? `claude pty turn timed out after ${timeoutMs}ms (partial output returned)` : undefined,
    durationMs,
    toolCalls:  state.toolCalls.size > 0 ? [...state.toolCalls.values()] : undefined,
    usage:      state.usage,
    model:      state.model ?? args.model,
    sessionId,
  }
}
