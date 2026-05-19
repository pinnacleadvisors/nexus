/**
 * nexus-sandbox — POST /exec runs a script inside an ephemeral rootless
 * Podman container, returns its stdout / stderr / exit_code.
 *
 * No dependencies — pure node: builtins. Compiled-free, single-file.
 *
 * Env:
 *   SANDBOX_PORT                  HTTP port (default 8080)
 *   NEXUS_SANDBOX_TOKEN           Required Bearer for /exec (denies if unset)
 *   SANDBOX_DEFAULT_IMAGE         Image when body omits it (default 'alpine')
 *   SANDBOX_DEFAULT_TIMEOUT_MS    Per-exec timeout (default 60_000)
 *   SANDBOX_MAX_OUTPUT_BYTES      stdout/stderr ring buffer cap (default 262144)
 *   SANDBOX_MAX_MEMORY            podman --memory (default '512m')
 *   SANDBOX_MAX_CPUS              podman --cpus (default '1')
 *   SANDBOX_ALLOW_HOST_NETWORK    '1' to honour network:'host' in body
 *
 * Body shape:
 *   { script: string,
 *     image?: string,
 *     timeout_ms?: number,
 *     network?: 'none' | 'host',
 *     env?: Record<string,string> }
 *
 * Response:
 *   { ok: true, stdout, stderr, exit_code, duration_ms, sandbox_id, truncated }
 *   { ok: false, error, ... }
 */

import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const PORT                       = Number(process.env.SANDBOX_PORT ?? 8080)
const TOKEN                      = process.env.NEXUS_SANDBOX_TOKEN
const DEFAULT_IMAGE              = process.env.SANDBOX_DEFAULT_IMAGE ?? 'alpine'
const DEFAULT_TIMEOUT_MS         = Number(process.env.SANDBOX_DEFAULT_TIMEOUT_MS ?? 60_000)
const MAX_OUTPUT_BYTES           = Number(process.env.SANDBOX_MAX_OUTPUT_BYTES ?? 262_144)
const MAX_MEMORY                 = process.env.SANDBOX_MAX_MEMORY ?? '512m'
const MAX_CPUS                   = process.env.SANDBOX_MAX_CPUS ?? '1'
const ALLOW_HOST_NETWORK         = process.env.SANDBOX_ALLOW_HOST_NETWORK === '1'

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req, capBytes = 1_048_576 /* 1 MB request cap */) {
  let total = 0
  const chunks = []
  for await (const chunk of req) {
    total += chunk.length
    if (total > capBytes) throw new Error('request too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function ringBuffer(maxBytes) {
  let buf = ''
  let truncated = false
  return {
    push(chunk) {
      buf += chunk
      if (buf.length > maxBytes) {
        buf = buf.slice(buf.length - maxBytes)
        truncated = true
      }
    },
    toString() { return buf },
    get truncated() { return truncated },
  }
}

function authorise(req) {
  if (!TOKEN) return false
  const got = req.headers.authorization ?? ''
  return got === `Bearer ${TOKEN}`
}

async function handleExec(req, res) {
  if (!authorise(req)) return writeJson(res, 401, { ok: false, error: 'unauthorized' })

  let raw
  try { raw = await readBody(req) }
  catch (err) { return writeJson(res, 413, { ok: false, error: err.message }) }

  let body
  try { body = JSON.parse(raw) }
  catch { return writeJson(res, 400, { ok: false, error: 'invalid json' }) }

  const script     = String(body.script ?? '')
  const image      = String(body.image  ?? DEFAULT_IMAGE)
  const timeoutMs  = Math.min(Math.max(Number(body.timeout_ms ?? DEFAULT_TIMEOUT_MS), 1_000), 300_000)
  const network    = String(body.network ?? 'none').toLowerCase()
  const extraEnv   = (body.env && typeof body.env === 'object') ? body.env : {}

  if (!script)             return writeJson(res, 400, { ok: false, error: 'script required' })
  if (script.length > 32_768) return writeJson(res, 400, { ok: false, error: 'script too long (max 32 KB)' })
  if (network !== 'none' && network !== 'host') {
    return writeJson(res, 400, { ok: false, error: `invalid network: ${network}` })
  }
  if (network === 'host' && !ALLOW_HOST_NETWORK) {
    return writeJson(res, 403, { ok: false, error: 'host network disabled; set SANDBOX_ALLOW_HOST_NETWORK=1' })
  }

  const sandboxId = randomUUID()
  const start = Date.now()

  const envArgs = []
  for (const [k, v] of Object.entries(extraEnv)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(k)) continue
    envArgs.push('-e', `${k}=${String(v)}`)
  }

  const args = [
    'run',
    '--rm',
    '--name', `nexus-sandbox-${sandboxId}`,
    `--network=${network}`,
    `--memory=${MAX_MEMORY}`,
    `--cpus=${MAX_CPUS}`,
    '--pids-limit=128',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=64m',
    ...envArgs,
    image,
    'sh', '-c', script,
  ]

  const proc = spawn('podman', args, { stdio: ['ignore', 'pipe', 'pipe'] })

  const stdoutBuf = ringBuffer(MAX_OUTPUT_BYTES)
  const stderrBuf = ringBuffer(MAX_OUTPUT_BYTES)

  proc.stdout.on('data', (d) => stdoutBuf.push(d.toString('utf8')))
  proc.stderr.on('data', (d) => stderrBuf.push(d.toString('utf8')))

  let killedByTimeout = false
  const timer = setTimeout(() => {
    killedByTimeout = true
    try { proc.kill('SIGKILL') } catch {}
    spawn('podman', ['kill', `nexus-sandbox-${sandboxId}`], { stdio: 'ignore' })
      .on('error', () => {})
  }, timeoutMs)

  proc.on('error', (err) => {
    clearTimeout(timer)
    writeJson(res, 500, {
      ok: false,
      error: `podman spawn failed: ${err.message}`,
      sandbox_id: sandboxId,
    })
  })

  proc.on('close', (code) => {
    clearTimeout(timer)
    writeJson(res, 200, {
      ok: !killedByTimeout && code === 0,
      stdout: stdoutBuf.toString(),
      stderr: stderrBuf.toString(),
      exit_code: code ?? -1,
      killed_by_timeout: killedByTimeout,
      truncated: stdoutBuf.truncated || stderrBuf.truncated,
      duration_ms: Date.now() - start,
      sandbox_id: sandboxId,
    })
  })

  console.log(`[sandbox] exec ${sandboxId} image=${image} network=${network} timeout=${timeoutMs}ms`)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return writeJson(res, 200, { ok: true, service: 'nexus-sandbox' })
  }
  if (req.method === 'POST' && req.url === '/exec') return handleExec(req, res)
  return writeJson(res, 404, { ok: false, error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`[sandbox] listening on :${PORT}`)
  if (!TOKEN) console.warn('[sandbox] NEXUS_SANDBOX_TOKEN not set — /exec will reject all requests')
})

process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
process.on('SIGINT',  () => { server.close(() => process.exit(0)) })
