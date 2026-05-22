#!/usr/bin/env node
/**
 * scripts/diagnose-codex-gateway.mjs
 *
 * Focused diagnostic for the codex-gateway 502 incident class. Runs in one
 * shot via `doppler run -- npm run diagnose:codex` (or directly:
 * `doppler run -- node scripts/diagnose-codex-gateway.mjs`).
 *
 * Probes, in order:
 *   1. Coolify app state — running? exited? restarting?
 *   2. Recent container logs (last 200 lines, filtered to non-empty)
 *   3. /health (basic)            — does the HTTP server respond at all?
 *   4. /health?deep=1             — does the actual `codex --version` subprocess work?
 *   5. POST /api/sessions/.../messages with a no-op (with --probe-dispatch)
 *
 * Then prints a focused "Most likely root cause" verdict tying the symptoms
 * back to one of:
 *   * cloudflared tunnel down (Cloudflare 502 + can't reach gateway directly)
 *   * codex-gateway container crash-loop (Coolify status != running)
 *   * codex CLI broken (deep=1 fails but loggedIn=true)
 *   * codex auth.json expired (deep=1 fails, stderr contains "not logged in")
 *   * codex container OOM (logs show "Killed" or stderr mentions memory)
 *
 * Required env (via Doppler):
 *   COOLIFY_KVM4_URL                — Coolify host base URL (e.g. https://coolify.example.com)
 *   COOLIFY_KVM4_API_TOKEN          — API token with read access to applications
 *   COOLIFY_KVM4_CODEX_UUID         — codex-gateway app UUID (or COOLIFY_KVM2_CODEX_UUID for legacy)
 *   CODEX_GATEWAY_URL               — public URL of the gateway (e.g. https://codex-gw.example.com)
 *   CODEX_GATEWAY_BEARER_TOKEN      — needed for --probe-dispatch only
 *
 * Flags:
 *   --probe-dispatch   — also fires a signed POST to the gateway to see if a
 *                        real dispatch succeeds. Skipped by default — uses the
 *                        Codex Pro plan window.
 *   --logs-lines=N     — pull N log lines (default 200).
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { createHmac } from 'node:crypto'

const args = process.argv.slice(2)
const probeDispatch = args.includes('--probe-dispatch')
const logsLines = (() => {
  const f = args.find(a => a.startsWith('--logs-lines='))
  if (!f) return 200
  const n = parseInt(f.split('=')[1] ?? '200', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 200
})()

const RED   = '\x1b[31m'
const GREEN = '\x1b[32m'
const YEL   = '\x1b[33m'
const CYAN  = '\x1b[36m'
const DIM   = '\x1b[2m'
const RST   = '\x1b[0m'

function section(title) {
  console.log(`\n${CYAN}== ${title} ==${RST}`)
}
function ok(msg)    { console.log(`${GREEN}✓${RST} ${msg}`) }
function warn(msg)  { console.log(`${YEL}!${RST} ${msg}`) }
function fail(msg)  { console.log(`${RED}✗${RST} ${msg}`) }
function info(msg)  { console.log(`  ${msg}`) }
function dim(msg)   { console.log(`${DIM}  ${msg}${RST}`) }

// ── Env resolution ───────────────────────────────────────────────────────────

const baseUrl  = (process.env.COOLIFY_KVM4_URL ?? '').replace(/\/$/, '')
const token    = process.env.COOLIFY_KVM4_API_TOKEN ?? ''
const uuid     = process.env.COOLIFY_KVM4_CODEX_UUID ?? process.env.COOLIFY_KVM2_CODEX_UUID ?? ''
const gwUrl    = (process.env.CODEX_GATEWAY_URL ?? '').replace(/\/$/, '')
const gwBearer = process.env.CODEX_GATEWAY_BEARER_TOKEN ?? ''

const missing = []
if (!baseUrl) missing.push('COOLIFY_KVM4_URL')
if (!token)   missing.push('COOLIFY_KVM4_API_TOKEN')
if (!uuid)    missing.push('COOLIFY_KVM4_CODEX_UUID (or COOLIFY_KVM2_CODEX_UUID)')
if (!gwUrl)   missing.push('CODEX_GATEWAY_URL')
if (missing.length) {
  fail('Missing required env vars (run via `doppler run -- ...`):')
  for (const m of missing) info(`  - ${m}`)
  process.exit(2)
}

const findings = {
  coolifyState:        null,  // 'running' | 'exited' | 'restarting' | ...
  recentLogsSnippet:   null,
  healthBasic:         null,  // {ok, status, loggedIn, ...}
  healthDeep:          null,
  dispatchProbe:       null,
  hasOomKilled:        false,
  hasNotLoggedIn:      false,
  hasCrashLoop:        false,
}

// ── 1. Coolify app state ─────────────────────────────────────────────────────

section('1. Coolify — codex-gateway app state')

async function callCoolify(path) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  try {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal:  ac.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

try {
  const r = await callCoolify(`/applications/${uuid}`)
  if (!r.ok) {
    fail(`/applications/${uuid} → ${r.status} ${r.text.slice(0, 120)}`)
  } else {
    const state = r.json?.status ?? 'unknown'
    findings.coolifyState = state
    const lower = state.toLowerCase()
    if (lower.includes('running')) ok(`status: ${state}`)
    else if (lower.includes('restarting')) {
      warn(`status: ${state} — container is restarting (likely crash-looping)`)
      findings.hasCrashLoop = true
    } else if (lower.includes('exited') || lower.includes('stopped')) {
      fail(`status: ${state} — container is NOT running`)
    } else {
      warn(`status: ${state} — unrecognised state, may need manual inspection in Coolify UI`)
    }
    info(`fqdn: ${r.json?.fqdn ?? '(no fqdn set)'}`)
  }
} catch (err) {
  fail(`Coolify API unreachable: ${err.message}`)
}

// ── 2. Recent container logs ────────────────────────────────────────────────

section(`2. Coolify — last ${logsLines} log lines`)

try {
  const r = await callCoolify(`/applications/${uuid}/logs?lines=${logsLines}`)
  if (!r.ok) {
    fail(`/applications/${uuid}/logs → ${r.status}`)
  } else {
    // Coolify returns the logs as a string field — shape varies by version.
    // Be permissive and look for common keys before giving up.
    const logs = r.json?.logs ?? r.json?.data ?? (typeof r.json === 'string' ? r.json : r.text)
    if (!logs || (typeof logs === 'string' && logs.trim().length === 0)) {
      warn('logs response was empty — container may have just restarted (no fresh logs yet)')
    } else {
      const lines = String(logs).split('\n').filter(l => l.trim().length > 0)
      const tail  = lines.slice(-30)            // show only the last 30 for readability
      findings.recentLogsSnippet = tail.join('\n')

      // Pattern-match for known failure modes.
      const all = String(logs)
      if (/Killed|out of memory|OOMKilled|memory limit/i.test(all)) {
        findings.hasOomKilled = true
      }
      if (/not.*logged in|missing.*auth\.json|authentication.*failed|unauthor/i.test(all)) {
        findings.hasNotLoggedIn = true
      }
      // Crash-loop heuristic: ≥3 "[codex-gw]" or container-start lines in last 200 = restarting
      const startMarkers = lines.filter(l => /\[codex-gw\] (refreshing|cloning|starting|listening)/i.test(l))
      if (startMarkers.length >= 3) findings.hasCrashLoop = true

      info(`(showing last ${tail.length} non-empty lines)`)
      console.log(DIM)
      console.log(tail.map(l => `  ${l}`).join('\n'))
      console.log(RST)
    }
  }
} catch (err) {
  fail(`logs fetch failed: ${err.message}`)
}

// ── 3. /health basic ────────────────────────────────────────────────────────

section('3. /health — basic probe')

async function probeHealth(url, timeoutMs = 10_000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: ac.signal })
    const text = await res.text().catch(() => '')
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - t0,
      json,
      bodySnippet: text.slice(0, 200),
      serverHeader: res.headers.get('server') ?? null,
      contentType:  res.headers.get('content-type') ?? null,
    }
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

try {
  const h = await probeHealth(`${gwUrl}/health`, 8_000)
  findings.healthBasic = h
  if (h.error) {
    fail(`${gwUrl}/health → ${h.error}`)
  } else if (!h.ok) {
    fail(`${gwUrl}/health → ${h.status} (latency ${h.latencyMs}ms)`)
    if (h.serverHeader) info(`server: ${h.serverHeader}`)
    if (h.contentType)  info(`content-type: ${h.contentType}`)
    if (h.bodySnippet)  dim(`body: ${h.bodySnippet.replace(/\s+/g, ' ').slice(0, 140)}`)
  } else {
    ok(`${gwUrl}/health → 200 (latency ${h.latencyMs}ms)`)
    if (h.json) {
      info(`loggedIn:    ${h.json.loggedIn}`)
      info(`queueDepth:  ${h.json.queueDepth}/${h.json.queueMax}`)
      info(`jobsTracked: ${h.json.jobsTracked}`)
    }
  }
} catch (err) {
  fail(`/health unreachable: ${err.message}`)
}

// ── 4. /health?deep=1 ────────────────────────────────────────────────────────

section('4. /health?deep=1 — exercises codex --version subprocess')

try {
  const h = await probeHealth(`${gwUrl}/health?deep=1`, 12_000)
  findings.healthDeep = h
  if (h.error) {
    fail(`${gwUrl}/health?deep=1 → ${h.error}`)
  } else if (!h.ok) {
    fail(`${gwUrl}/health?deep=1 → ${h.status} (latency ${h.latencyMs}ms)`)
  } else if (h.json && 'dispatchReady' in h.json) {
    const dispatchReady = h.json.dispatchReady
    const cliOk = h.json.cliProbe?.ok ?? null
    if (dispatchReady) {
      ok(`dispatchReady: true (cliProbe.ok=${cliOk}, version=${h.json.cliProbe?.version ?? '(n/a)'})`)
    } else {
      fail(`dispatchReady: false (loggedIn=${h.json.loggedIn}, cliProbe.ok=${cliOk})`)
      if (h.json.cliProbe?.error) info(`cliProbe.error: ${h.json.cliProbe.error}`)
    }
  } else {
    warn('/health?deep=1 returned 200 but no dispatchReady field — gateway image predates the deep-probe change. Redeploy codex-gateway and re-run.')
  }
} catch (err) {
  fail(`/health?deep=1 unreachable: ${err.message}`)
}

// ── 5. Optional: --probe-dispatch ────────────────────────────────────────────

if (probeDispatch) {
  section('5. POST /api/sessions/.../messages — real dispatch probe (uses plan window)')

  if (!gwBearer) {
    warn('--probe-dispatch set but CODEX_GATEWAY_BEARER_TOKEN unset — skipping')
  } else {
    try {
      const body = JSON.stringify({
        role:    'user',
        content: 'diagnostic ping — please reply with the single word OK',
        agent:   null,
        env:     {},
      })
      const sig = 'sha256=' + createHmac('sha256', gwBearer).update(body).digest('hex')
      const ts  = Date.now().toString()
      const sessionTag = `diagnostic-${Date.now()}`

      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 60_000)
      const t0 = Date.now()
      const res = await fetch(`${gwUrl}/api/sessions/${encodeURIComponent(sessionTag)}/messages`, {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'Authorization':      `Bearer ${gwBearer}`,
          'X-Nexus-Signature':  sig,
          'X-Nexus-Timestamp':  ts,
          'X-Nexus-User-Id':    process.env.ALLOWED_USER_IDS?.split(',')[0]?.trim() ?? 'diagnostic',
        },
        body,
        signal: ac.signal,
      })
      clearTimeout(timer)
      const text = await res.text()
      const latency = Date.now() - t0
      findings.dispatchProbe = { ok: res.ok, status: res.status, latencyMs: latency, serverHeader: res.headers.get('server'), bodySnippet: text.slice(0, 200) }

      if (res.ok) {
        ok(`dispatch returned ${res.status} (latency ${latency}ms)`)
        dim(`body: ${text.slice(0, 140).replace(/\s+/g, ' ')}`)
      } else {
        fail(`dispatch → ${res.status} (latency ${latency}ms)`)
        info(`server: ${res.headers.get('server') ?? '(unknown)'}`)
        dim(`body: ${text.slice(0, 200).replace(/\s+/g, ' ')}`)
      }
    } catch (err) {
      fail(`dispatch probe failed: ${err.message}`)
    }
  }
} else {
  section('5. POST /api/sessions/.../messages — skipped (pass --probe-dispatch to enable)')
}

// ── Verdict ──────────────────────────────────────────────────────────────────

section('Verdict — most likely root cause')

const verdicts = []

// Order matters — most specific patterns first.
if (findings.hasOomKilled) {
  verdicts.push({
    severity: 'red',
    cause:    'OOM-killed during codex CLI spawn',
    next:     [
      'In Coolify UI → codex-gateway → Resources → raise the memory limit (likely currently 512MB; try 1.5–2GB).',
      'Restart the container after the bump.',
    ],
  })
}
if (findings.hasNotLoggedIn) {
  verdicts.push({
    severity: 'red',
    cause:    'Codex CLI auth.json missing or expired (~30-day refresh-token rotation)',
    next:     [
      'On your dev machine: `codex login` to generate a fresh auth.json.',
      'Paste new value into Doppler as CODEX_AUTH_JSON.',
      'Redeploy codex-gateway in Coolify (env reload + container restart).',
      'See docs/runbooks/codex-gateway-auth-rotation.md.',
    ],
  })
}
if (findings.hasCrashLoop) {
  verdicts.push({
    severity: 'red',
    cause:    'codex-gateway is crash-looping (start markers ≥3 in recent logs)',
    next:     [
      'Inspect the full logs in Coolify UI for the crash reason.',
      'Most common: missing DOPPLER_TOKEN, bad CODEX_AUTH_JSON, repo clone failure (NEXUS_REPO_URL unreachable).',
    ],
  })
}

const basicOk    = findings.healthBasic?.ok    === true
const basicServer = findings.healthBasic?.serverHeader ?? ''
const deepOk     = findings.healthDeep?.ok     === true
const deepReady  = findings.healthDeep?.json?.dispatchReady === true

if (basicOk && deepOk && deepReady && verdicts.length === 0) {
  verdicts.push({
    severity: 'amber',
    cause:    'Gateway looks healthy from inside Cloudflare. Original 502 was likely transient — possibly a brief tunnel disconnect that recovered. Single-retry in lib/chat/codex-direct-dispatch.ts should now mask this class.',
    next:     [
      'Re-test the Codex pill in the chat header.',
      'If you still see 502s, the failure pattern has shifted — re-run this script with --probe-dispatch to exercise the full path under load.',
    ],
  })
}

if (basicOk && !deepOk) {
  verdicts.push({
    severity: 'red',
    cause:    'HTTP server is up but codex CLI subprocess is broken (basic /health OK, deep probe failed)',
    next:     [
      'Most likely: CLI binary missing from PATH, or codex container started before /root/.codex was mounted.',
      'Try: in Coolify, restart the codex-gateway container.',
      'Then re-run this script.',
    ],
  })
}

if (!basicOk && basicServer.toLowerCase().includes('cloudflare')) {
  verdicts.push({
    severity: 'red',
    cause:    'Cloudflare is returning a non-2xx — Cloudflare Tunnel cannot reach the codex-gateway container',
    next:     [
      '`cloudflared` daemon (configured OUTSIDE Coolify) may be down or disconnected.',
      'SSH to the Coolify host: `docker ps | grep cloudflared` (check it is running).',
      '`docker logs <cloudflared-container> --tail 200` — look for "context deadline exceeded" or "no healthy origins".',
      'If cloudflared is up: check that it is on the `coolify` network and codex-gateway is reachable via `docker exec cloudflared wget -qO- http://codex-gateway:3000/health`.',
      'See docs/runbooks/n8n-kvm1-to-coolify.md (the tunnel setup) + docs/runbooks/migrate-to-lean-kvm.md.',
    ],
  })
}

if (!basicOk && findings.coolifyState && !findings.coolifyState.toLowerCase().includes('running')) {
  verdicts.push({
    severity: 'red',
    cause:    `codex-gateway container is NOT running (Coolify state: ${findings.coolifyState})`,
    next:     [
      'In Coolify UI → codex-gateway → Start. Watch the build logs.',
      'If start fails repeatedly, check Doppler for CODEX_GATEWAY_BEARER_TOKEN + CODEX_AUTH_JSON + DOPPLER_TOKEN.',
    ],
  })
}

if (verdicts.length === 0) {
  warn('No specific failure pattern matched. Print findings JSON for manual triage:')
  console.log(JSON.stringify(findings, null, 2))
} else {
  for (const v of verdicts) {
    const tag = v.severity === 'red' ? RED + '✗ ROOT CAUSE' : YEL + '! ROOT CAUSE'
    console.log(`\n${tag}${RST}: ${v.cause}`)
    console.log('  Next steps:')
    for (const n of v.next) console.log(`    - ${n}`)
  }
}

// Exit code: 0 if no red verdicts, 1 if any.
const hasRed = verdicts.some(v => v.severity === 'red')
process.exit(hasRed ? 1 : 0)
