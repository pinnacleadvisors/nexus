import { spawn } from 'node:child_process'
import { readAgentSystemPrompt } from './agentSpec.js'

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

  const cliArgs = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '25',
  ]
  if (systemPrompt) {
    cliArgs.push('--append-system-prompt', systemPrompt)
  }
  cliArgs.push(args.message)

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...args.env,
  }

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
    let result: RunResult = { ok: false, content: '', durationMs: 0 }
    let resolved = false

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      child.kill('SIGTERM')
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
      })
    })

    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string | undefined

      if (type === 'system' && (event.subtype === 'init' || event.subtype === 'session_started')) {
        const sid = event.session_id as string | undefined
        if (sid) result.sessionId = sid
      }

      if (type === 'assistant' && event.message) {
        const message = event.message as { content?: Array<{ type?: string; text?: string }> }
        const blocks = message.content ?? []
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string') {
            lastAssistantText += block.text
            if (args.onDelta) {
              try { args.onDelta(block.text) } catch { /* swallow */ }
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
          usage:      event.usage as RunResult['usage'],
          model:      event.model as string | undefined,
          sessionId:  result.sessionId ?? (event.session_id as string | undefined),
        }
      }
    }
  })
}
