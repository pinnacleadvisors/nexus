/**
 * mcpProbe — spawn each configured MCP, JSON-RPC handshake it for tools/list,
 * cache the result.
 *
 * Powers the V2 of the chat MCP status strip (audit 2026-05-16 Section 6 #6).
 * V1 (PR #202) just shows the manifested set from `lib/businesses/mcp-manifest.ts`.
 * V2 confirms each server actually starts AND reports its live tool count.
 *
 * Why spawn each MCP separately (not query the running claude CLI session):
 *   - The chat sessions are long-running and we don't want to perturb them.
 *   - The MCP servers are stdio-based — spawning a fresh process is the
 *     reference way to talk to them. We do the JSON-RPC initialize handshake
 *     ourselves (no MCP SDK dep needed in the gateway).
 *
 * Caching: 5 minutes. Manifest only changes on Docker rebuild, so the cost of
 * re-spawning every API call is unnecessary. Manual invalidation via
 * `invalidateMcpToolCache()` after a config write.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'

interface ServerConfig {
  command: string
  args?:   string[]
  env?:    Record<string, string>
}

export interface McpToolReport {
  /** Server id from settings.json (e.g. 'composio-admin', 'memory-hq'). */
  id:           string
  /** Number of tools the server reported. null when probe failed. */
  toolCount:    number | null
  /** First 50 tool names (capped to keep the response small). */
  toolNames:    string[]
  /** Truncated by `toolNames.length === 50`? — surfaces a "+N more" UI hint. */
  toolNamesTruncated: boolean
  /** 'ready' = probe succeeded. 'timeout' / 'spawn_error' / 'protocol_error'
   *  = probe failed with the named reason. */
  status:       'ready' | 'timeout' | 'spawn_error' | 'protocol_error'
  /** Last error message when status !== 'ready'. */
  error?:       string
  /** Wall-clock ms the probe took. */
  durationMs:   number
}

const CACHE_TTL_MS    = 5 * 60_000
const PROBE_TIMEOUT_MS = 10_000
const SETTINGS_PATH    = '/root/.claude/settings.json'

let cache: { at: number; reports: McpToolReport[] } | null = null

export function invalidateMcpToolCache(): void {
  cache = null
}

/** Read the live MCP config from /root/.claude/settings.json. Returns
 *  the `mcpServers` map, or {} when the file is missing / unparsable. */
async function readMcpServers(): Promise<Record<string, ServerConfig>> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, ServerConfig> }
    return parsed.mcpServers ?? {}
  } catch {
    return {}
  }
}

/** Probe a single MCP server: spawn, JSON-RPC handshake, get tools/list. */
async function probeOne(id: string, cfg: ServerConfig): Promise<McpToolReport> {
  const started = Date.now()

  return new Promise<McpToolReport>(resolve => {
    let proc: ChildProcess
    try {
      proc = spawn(cfg.command, cfg.args ?? [], {
        env:   { ...process.env, ...(cfg.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      resolve({
        id, toolCount: null, toolNames: [], toolNamesTruncated: false,
        status: 'spawn_error',
        error:  err instanceof Error ? err.message : 'spawn failed',
        durationMs: Date.now() - started,
      })
      return
    }

    let buf       = ''
    let stderrBuf = ''
    let finished  = false

    const finish = (report: McpToolReport) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { proc.kill('SIGTERM') } catch { /* already dead */ }
      // Force-kill stragglers after a grace period
      setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* gone */ } }, 1_000).unref()
      resolve(report)
    }

    const timer = setTimeout(() => {
      finish({
        id, toolCount: null, toolNames: [], toolNamesTruncated: false,
        status: 'timeout',
        error:  `no tools/list response within ${PROBE_TIMEOUT_MS}ms (stderr tail: ${stderrBuf.slice(-200)})`,
        durationMs: Date.now() - started,
      })
    }, PROBE_TIMEOUT_MS)

    proc.on('error', err => {
      finish({
        id, toolCount: null, toolNames: [], toolNamesTruncated: false,
        status: 'spawn_error',
        error:  err.message,
        durationMs: Date.now() - started,
      })
    })

    proc.stderr?.on('data', chunk => { stderrBuf += chunk.toString() })

    proc.stdout?.on('data', chunk => {
      buf += chunk.toString()
      // Process line-delimited JSON-RPC frames
      while (true) {
        const nl = buf.indexOf('\n')
        if (nl === -1) break
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: { id?: number; result?: { tools?: Array<{ name: string }> }; error?: { message?: string } }
        try { msg = JSON.parse(line) } catch { continue }

        if (msg.id === 1 && msg.result) {
          // initialize OK — send initialized notification + tools/list
          try {
            proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
            proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
          } catch (err) {
            finish({
              id, toolCount: null, toolNames: [], toolNamesTruncated: false,
              status: 'protocol_error',
              error:  err instanceof Error ? err.message : 'stdin write failed',
              durationMs: Date.now() - started,
            })
          }
        } else if (msg.id === 2 && msg.result) {
          // tools/list response
          const tools = Array.isArray(msg.result.tools) ? msg.result.tools : []
          const names = tools.map(t => t.name).filter(n => typeof n === 'string')
          finish({
            id,
            toolCount: tools.length,
            toolNames: names.slice(0, 50),
            toolNamesTruncated: names.length > 50,
            status: 'ready',
            durationMs: Date.now() - started,
          })
        } else if (msg.id === 2 && msg.error) {
          finish({
            id, toolCount: null, toolNames: [], toolNamesTruncated: false,
            status: 'protocol_error',
            error:  msg.error.message ?? 'tools/list errored',
            durationMs: Date.now() - started,
          })
        }
      }
    })

    // Send initialize first; the rest fires on the response.
    try {
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'initialize',
        params:  {
          protocolVersion: '2024-11-05',
          capabilities:    {},
          clientInfo:      { name: 'nexus-gateway-probe', version: '1.0.0' },
        },
      }) + '\n')
    } catch (err) {
      finish({
        id, toolCount: null, toolNames: [], toolNamesTruncated: false,
        status: 'protocol_error',
        error:  err instanceof Error ? err.message : 'stdin write failed',
        durationMs: Date.now() - started,
      })
    }
  })
}

/** Probe every configured MCP in parallel. Caches result for 5 minutes
 *  (the config only changes on Docker rebuild). */
export async function probeAllMcpTools(force = false): Promise<McpToolReport[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.reports
  }
  const servers = await readMcpServers()
  const ids     = Object.keys(servers).sort()
  if (ids.length === 0) {
    cache = { at: Date.now(), reports: [] }
    return cache.reports
  }
  const reports = await Promise.all(ids.map(id => probeOne(id, servers[id]!)))
  cache = { at: Date.now(), reports }
  return reports
}
