/**
 * @nexus/mcp-platform-audit — local-exec audit tools for the bug-hunt-loop.
 *
 * Runs inside the claude-gateway container with access to the cloned
 * /repo. Spawns child processes for each audit command and returns
 * structured findings. Zero network calls — fast, free, deterministic.
 *
 * Four tools:
 *   audit_tsc()           → `npx tsc --noEmit` errors
 *   audit_retry_storm()   → `npm run check:retry-storm` failures
 *   audit_sentry_config() → `npm run check:sentry-config` failures
 *   audit_eslint(target?) → `npx eslint <target | .>` issues
 *
 * Each tool returns `{ ok: boolean, findings: Finding[] }` where Finding =
 * `{ file?, line?, message, rule? }`. The agent reads this in its turn
 * and emits `bug-hunt-finding` fenced blocks for each entry.
 *
 * Registered on the claude-gateway via services/claude-gateway/entrypoint.sh
 * — gated on `NEXUS_REPO_PATH` being a valid git checkout.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const REPO_PATH = process.env.NEXUS_REPO_PATH ?? '/repo'

function fatal(msg: string): never {
  console.error('[platform-audit] ' + msg)
  process.exit(2)
}

if (!existsSync(REPO_PATH)) fatal(`NEXUS_REPO_PATH=${REPO_PATH} does not exist`)

export interface Finding {
  file?:    string
  line?:    number
  message:  string
  rule?:    string
}

interface RunResult { code: number; stdout: string; stderr: string }

/** Run a command, capturing stdout + stderr + exit code. 5-min hard cap. */
function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (b: Buffer) => { stdout += b.toString() })
    p.stderr.on('data', (b: Buffer) => { stderr += b.toString() })
    const timer = setTimeout(() => p.kill('SIGTERM'), 5 * 60_000)
    p.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    p.on('error', err => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + (err as Error).message })
    })
  })
}

// ── Parsers ──────────────────────────────────────────────────────────────────

/** tsc output: "<file>(<line>,<col>): error TS<n>: <message>" */
function parseTsc(output: string): Finding[] {
  const findings: Finding[] = []
  const re = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    findings.push({
      file:    m[1],
      line:    Number(m[2]),
      rule:    m[3],
      message: m[4].trim(),
    })
  }
  return findings
}

/**
 * retry-storm + sentry-config use a structured output format from
 * scripts/check-retry-storm.mjs + scripts/check-sentry-config.mjs.
 * Both print lines like "  FAIL  <check-name>  (N findings)" followed
 * by `file:line  <message>` rows. We just grab the FAIL summaries —
 * the agent runs the same script and parses detail itself if needed.
 */
function parseChecker(output: string, label: string): Finding[] {
  const findings: Finding[] = []
  const lines = output.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const failMatch = /^\s*FAIL\s+(\S+)\s+\((\d+) findings?\)/.exec(line)
    if (!failMatch) continue
    const checkName = failMatch[1]
    const count     = Number(failMatch[2])
    // Slurp the next `count` non-blank lines as detail.
    const details: string[] = []
    for (let j = i + 1; j < lines.length && details.length < count; j++) {
      const detail = lines[j].trim()
      if (!detail) break
      if (/^(PASS|FAIL)\b/i.test(detail)) break
      details.push(detail)
    }
    for (const d of details) {
      const colon = d.match(/^([^:]+):(\d+)\s*(.*)$/)
      if (colon) {
        findings.push({
          file:    colon[1],
          line:    Number(colon[2]),
          rule:    `${label}/${checkName}`,
          message: colon[3].trim() || `${checkName} flagged this line`,
        })
      } else {
        findings.push({ rule: `${label}/${checkName}`, message: d })
      }
    }
  }
  return findings
}

/** eslint --format=compact: "<file>: line <n>, col <m>, <severity> - <message> (<rule>)" */
function parseEslint(output: string): Finding[] {
  const findings: Finding[] = []
  const re = /^(.+?):\s+line\s+(\d+),\s+col\s+\d+,\s+(?:Error|Warning)\s+-\s+(.+?)\s+\(([^)]+)\)$/gm
  let m
  while ((m = re.exec(output)) !== null) {
    findings.push({
      file:    m[1],
      line:    Number(m[2]),
      rule:    m[4],
      message: m[3].trim(),
    })
  }
  return findings
}

// ── Auditor entry points ─────────────────────────────────────────────────────

async function auditTsc(): Promise<{ ok: boolean; findings: Finding[] }> {
  const r = await run('npx', ['tsc', '--noEmit'], REPO_PATH)
  const findings = parseTsc(r.stdout + '\n' + r.stderr)
  return { ok: r.code === 0 && findings.length === 0, findings }
}

async function auditRetryStorm(): Promise<{ ok: boolean; findings: Finding[] }> {
  const r = await run('npm', ['run', 'check:retry-storm', '--silent'], REPO_PATH)
  const findings = parseChecker(r.stdout + '\n' + r.stderr, 'retry-storm')
  return { ok: r.code === 0 && findings.length === 0, findings }
}

async function auditSentryConfig(): Promise<{ ok: boolean; findings: Finding[] }> {
  const r = await run('npm', ['run', 'check:sentry-config', '--silent'], REPO_PATH)
  const findings = parseChecker(r.stdout + '\n' + r.stderr, 'sentry-config')
  return { ok: r.code === 0 && findings.length === 0, findings }
}

async function auditEslint(target?: string): Promise<{ ok: boolean; findings: Finding[] }> {
  const args = ['eslint', '--format=compact', target && target.trim() ? target : '.']
  const r = await run('npx', args, REPO_PATH)
  const findings = parseEslint(r.stdout + '\n' + r.stderr)
  return { ok: r.code === 0 && findings.length === 0, findings }
}

// ── MCP server ───────────────────────────────────────────────────────────────

async function main() {
  console.error(`[platform-audit] repo=${REPO_PATH}`)

  const server = new Server(
    { name: 'platform-audit', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'audit_tsc',
        description: 'Run `npx tsc --noEmit` against the Nexus repo and return TypeScript errors as structured findings. Use during a bug-hunt static-audit iteration. Fast (~3-8 s) and free.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'audit_retry_storm',
        description: 'Run `npm run check:retry-storm` against the Nexus repo. Catches the 6 grep-detectable retry-storm anti-patterns from AGENTS.md (n8n auto-retry on 5xx, Inngest implicit retries, missing fetch timeouts, etc.). Returns each finding as a structured row.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'audit_sentry_config',
        description: 'Run `npm run check:sentry-config`. Catches Sentry sampler regressions + polling endpoints not listed in SKIP_PATTERNS (the 2026-05-12 incident class).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'audit_eslint',
        description: 'Run ESLint against the Nexus repo or a specific path. Compact format, returns structured findings. Use sparingly — full-repo eslint can take 30+ seconds.',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Optional path (file or directory). Defaults to "." (full repo).' },
          },
          additionalProperties: false,
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const args = (rawArgs ?? {}) as Record<string, unknown>
    try {
      let result: { ok: boolean; findings: Finding[] }
      if (name === 'audit_tsc')           result = await auditTsc()
      else if (name === 'audit_retry_storm')   result = await auditRetryStorm()
      else if (name === 'audit_sentry_config') result = await auditSentryConfig()
      else if (name === 'audit_eslint')        result = await auditEslint(typeof args.target === 'string' ? args.target : undefined)
      else throw new Error(`unknown tool: ${name}`)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text', text: `error: ${msg}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
  console.error('[platform-audit] MCP server ready (stdio transport)')
}

main().catch(err => { console.error('[platform-audit] fatal:', err); process.exit(1) })
