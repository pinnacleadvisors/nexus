/**
 * POST /api/cron/rebuild-graph — C8
 *
 * Nightly (or manual) rebuild of the domain knowledge graph:
 *   1. Re-runs the molecularmemory_local CLI to refresh `.graph.json` + INDEX.md
 *   2. Rebuilds the in-process GraphData via `buildMemoryGraph()`
 *   3. Emits node count / orphan count / avg degree metrics
 *
 * Owner-only. Runs in Node runtime so we can exec the CLI. On Vercel the
 * committed CLI is read-only — the CLI steps are best-effort and the caller
 * can still use the rebuilt in-process graph even when the filesystem write
 * failed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { buildMemoryGraph } from '@/lib/graph/memory-builder'
import { recordSamples } from '@/lib/observability'
import { promisify } from 'node:util'
import { exec as execCb } from 'node:child_process'
import path from 'node:path'

const exec = promisify(execCb)
export const runtime = 'nodejs'
export const maxDuration = 60

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

interface CliStep {
  cmd:    string
  ok:     boolean
  stdout: string
  stderr: string
}

async function runCli(cmd: string, cwd: string): Promise<CliStep> {
  try {
    const { stdout, stderr } = await exec(cmd, { cwd, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })
    return { cmd, ok: true, stdout: stdout.slice(-500), stderr: stderr.slice(-500) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { cmd, ok: false, stdout: (e.stdout ?? '').slice(-500), stderr: (e.stderr ?? e.message ?? '').slice(-500) }
  }
}

interface GraphStats {
  nodeCount:   number
  edgeCount:   number
  orphanCount: number
  avgDegree:   number
}

function computeStats(nodes: Array<{ id: string }>, edges: Array<{ source: string; target: string }>): GraphStats {
  const degree = new Map<string, number>()
  for (const n of nodes) degree.set(n.id, 0)
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  let orphans = 0
  let totalDeg = 0
  for (const d of degree.values()) {
    if (d === 0) orphans += 1
    totalDeg += d
  }
  return {
    nodeCount:   nodes.length,
    edgeCount:   edges.length,
    orphanCount: orphans,
    avgDegree:   nodes.length > 0 ? totalDeg / nodes.length : 0,
  }
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 4, window: '1 h', prefix: 'cron:rebuild-graph' },
  })
  if ('response' in g) return g.response
  if (!isOwner(g.userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const cwd = process.cwd()
  const cliPath = path.join(cwd, '.claude', 'skills', 'molecularmemory_local', 'cli.mjs')

  // Best-effort CLI refresh. If node/cli.mjs is absent (serverless env), skip.
  const steps: CliStep[] = []
  try {
    steps.push(await runCli(`node ${JSON.stringify(cliPath)} graph`,    cwd))
    steps.push(await runCli(`node ${JSON.stringify(cliPath)} reindex`,  cwd))
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[rebuild-graph] CLI step failed:', err)
    }
  }

  const data = await buildMemoryGraph().catch(() => null)
  if (!data) {
    return NextResponse.json({
      ok:    false,
      error: 'memory graph empty — is the memory/ folder present?',
      steps,
    }, { status: 424 })
  }

  const stats = computeStats(data.nodes, data.edges)

  // Record metrics under the synthetic 'graph-builder' agent slug so the
  // dashboard can track drift in the graph itself (node growth, orphan spikes).
  recordSamples([
    { userId: g.userId, agentSlug: 'graph-builder', kind: 'input_tokens',  value: stats.nodeCount   },
    { userId: g.userId, agentSlug: 'graph-builder', kind: 'output_tokens', value: stats.edgeCount   },
    { userId: g.userId, agentSlug: 'graph-builder', kind: 'latency_ms',    value: stats.orphanCount },
    { userId: g.userId, agentSlug: 'graph-builder', kind: 'cost_usd',      value: stats.avgDegree   },
  ])

  return NextResponse.json({ ok: true, stats, steps })
}
