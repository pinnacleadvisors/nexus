import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readAgentSystemPrompt } from './agentSpec.js'

export interface RunArgs {
  agentSlug:  string | null
  message:    string
  env:        Record<string, string>
  repoPath:   string
  timeoutMs?: number
  /** Override the binary location for tests; defaults to whatever PATH resolves. */
  binary?:    string
  /** Optional model pin; forwarded as `--model <name>`. Falls back to env CODEX_MODEL. */
  model?:     string
  /**
   * Optional streaming callback. Fires once per assistant text delta with the
   * incremental string. The final RunResult is still returned with the full
   * concatenated content so non-streaming callers behave unchanged.
   */
  onDelta?:   (delta: string) => void
}

export interface RunResult {
  ok:         boolean
  content:    string
  error?:     string
  durationMs: number
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
 * Spawns `codex exec --json --skip-git-repo-check --output-last-message <tmp>`
 * and accumulates the final assistant message. The CLI authenticates against
 * the OAuth credentials in /root/.codex (mounted from a persistent Coolify
 * volume — Phase 6 in the gateway README).
 *
 * Event parsing is defensive across codex CLI versions: we accept both
 * `agent_message_delta`/`agent_message`/`task_complete` (newer schemas) and
 * `message_delta`/`message`/`result` (older / alternate). The
 * --output-last-message file is read on close as a canonical fallback in case
 * the JSON stream parser misses the terminal event.
 *
 * Codex has no equivalent of claude's `--append-system-prompt`, so the agent
 * spec body is prepended to the user message under a labelled section so the
 * model can see it as instructions while the underlying ChatGPT system prompt
 * stays in force.
 */
export async function runCodex(args: RunArgs): Promise<RunResult> {
  const started = Date.now()
  const timeoutMs = args.timeoutMs ?? 120_000
  const model = args.model ?? process.env.CODEX_MODEL ?? null

  let promptText = args.message
  if (args.agentSlug) {
    const sys = await readAgentSystemPrompt(args.repoPath, args.agentSlug)
    if (sys) {
      promptText = `[AGENT SPEC: ${args.agentSlug}]\n${sys}\n\n[USER REQUEST]\n${args.message}`
    }
  }

  // Tmp file for codex to write the final message into. Acts as a parser
  // fallback if the JSON event stream is missing the terminal task_complete
  // event (which has happened across CLI versions).
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-'))
  const lastMsgFile = path.join(tmpDir, 'last.md')

  const cliArgs = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--output-last-message', lastMsgFile,
  ]
  if (model) {
    cliArgs.push('--model', model)
  }
  cliArgs.push(promptText)

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...args.env,
  }
  // Force plan-mode auth: any of these would override the OAuth token in
  // /root/.codex/auth.json and silently route to per-token API billing.
  delete childEnv.OPENAI_API_KEY
  delete childEnv.OPENAI_BASE_URL
  delete childEnv.OPENAI_ORG_ID

  console.log(
    `[gw] spawn codex agent=${args.agentSlug ?? 'none'} ` +
    `model=${model ?? 'default'} msgLen=${args.message.length}`,
  )

  return await new Promise<RunResult>(resolve => {
    const child = spawn(args.binary ?? 'codex', cliArgs, {
      cwd:   args.repoPath,
      env:   childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let lastAssistantText = ''
    let result: RunResult = { ok: false, content: '', durationMs: 0 }
    let resolved = false

    const cleanup = async () => {
      try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch { /* swallow */ }
    }

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      child.kill('SIGTERM')
      void cleanup()
      resolve({
        ok:         false,
        content:    lastAssistantText,
        error:      `codex CLI timeout after ${timeoutMs}ms`,
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
      void cleanup()
      resolve({
        ok:         false,
        content:    '',
        error:      `failed to spawn codex CLI: ${(err as Error).message}`,
        durationMs: Date.now() - started,
      })
    })

    child.on('close', async code => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)

      // Prefer the --output-last-message file if codex wrote one — it's the
      // canonical final assistant message and survives parser drift.
      let finalText = result.content || lastAssistantText
      try {
        const fileText = await fs.readFile(lastMsgFile, 'utf8')
        if (fileText.trim()) finalText = fileText.trim()
      } catch { /* file may not exist if codex errored early */ }

      await cleanup()

      const ok = code === 0 && finalText.length > 0
      resolve({
        ok,
        content:    finalText,
        usage:      result.usage,
        model:      result.model,
        sessionId:  result.sessionId,
        error:      ok ? undefined : (result.error
          ?? `codex CLI exited with code ${code}: ${stderrBuf.slice(-512)}`),
        durationMs: Date.now() - started,
      })
    })

    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string | undefined

      // Session / task id — codex emits this in task_started or session_started.
      if (type === 'task_started' || type === 'session_started') {
        const sid = (event.session_id ?? event.task_id ?? event.id) as string | undefined
        if (sid) result.sessionId = sid
      }

      // Streaming text deltas. Codex schemas vary across versions — accept both.
      if (type === 'agent_message_delta' || type === 'message_delta') {
        const delta = (event.delta ?? event.text) as string | undefined
        if (typeof delta === 'string' && delta.length) {
          lastAssistantText += delta
          if (args.onDelta) {
            try { args.onDelta(delta) } catch { /* swallow */ }
          }
        }
      }

      // Full assistant message (non-streamed path).
      if (type === 'agent_message' || type === 'message') {
        const msg = event.message as { content?: string } | undefined
        const text = (event.text as string | undefined) ?? msg?.content
        if (typeof text === 'string' && text.length) {
          lastAssistantText = text
          if (args.onDelta) {
            try { args.onDelta(text) } catch { /* swallow */ }
          }
        }
      }

      // Terminal completion event — preferred source for usage + final text.
      if (type === 'task_complete' || type === 'result') {
        const text = (event.last_agent_message as string | undefined)
                  ?? (event.result as string | undefined)
                  ?? lastAssistantText
        result = {
          ok:         (event.subtype as string | undefined) !== 'error',
          content:    text,
          durationMs: Date.now() - started,
          usage:      event.usage as RunResult['usage'],
          model:      event.model as string | undefined,
          sessionId:  result.sessionId ?? (event.session_id as string | undefined),
        }
      }

      if (type === 'task_error' || type === 'error') {
        const msg = (event.message as string | undefined)
                 ?? (event.error as string | undefined)
                 ?? 'codex task error'
        result.error = msg
        result.ok = false
      }
    }
  })
}
