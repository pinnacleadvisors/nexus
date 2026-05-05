#!/usr/bin/env node
/**
 * One-time backfill: walks memory/molecular/{atoms,entities,mocs,sources,synthesis}/
 * and POSTs each file to /api/memory/event so it lands in memory-hq with
 * canonical scope frontmatter.
 *
 * Why a script: the local backend default (cli.mjs MOLECULAR_BACKEND='local')
 * meant every atom written in this repo since 2026-04-29 is local-only. This
 * one-shot pushes those existing files up so memory-hq matches the local tree
 * for repo:pinnacleadvisors/nexus scope.
 *
 * Run:
 *   doppler run -- node scripts/backfill-memory-hq.mjs            # actual push
 *   doppler run -- node scripts/backfill-memory-hq.mjs --dry-run  # preview
 *
 * Required env: NEXUS_BASE_URL, MEMORY_HQ_TOKEN
 * Optional:     MEMORY_REPO_SCOPE (default "pinnacleadvisors/nexus")
 *               BACKFILL_THROTTLE_MS (default 700; stay under 100 req/min limit)
 *
 * Idempotent: the receiver writes via writePage which upserts by SHA, so
 * re-running this script is safe — re-pushed files become no-ops if their
 * canonical content is unchanged.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT       = 'memory/molecular'
const KIND_DIRS  = ['atoms', 'entities', 'mocs', 'sources', 'synthesis']
const KIND_TO_TYPE = {
  atoms:     'atom',
  entities:  'entity',
  mocs:      'moc',
  sources:   'source',
  synthesis: 'synthesis',
}

const NEXUS_BASE_URL  = process.env.NEXUS_BASE_URL
const MEMORY_HQ_TOKEN = process.env.MEMORY_HQ_TOKEN
const REPO_SCOPE      = process.env.MEMORY_REPO_SCOPE || 'pinnacleadvisors/nexus'
const THROTTLE_MS     = Number(process.env.BACKFILL_THROTTLE_MS) || 700
const DRY_RUN         = process.argv.includes('--dry-run')

if (!NEXUS_BASE_URL)  { console.error('NEXUS_BASE_URL is required');  process.exit(2) }
if (!MEMORY_HQ_TOKEN) { console.error('MEMORY_HQ_TOKEN is required'); process.exit(2) }

// ── frontmatter parser (handles quoted strings + indented `-` arrays) ─────────
function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { frontmatter: {}, body: content.trim() }
  const fm = {}
  let arrKey = null
  let arr    = null
  for (const line of m[1].split('\n')) {
    if (arr !== null) {
      const t = line.trim()
      if (t.startsWith('- ')) {
        let v = t.slice(2)
        if (v.startsWith('"') && v.endsWith('"')) {
          try { v = JSON.parse(v) } catch {}
        }
        arr.push(v)
        continue
      }
      fm[arrKey] = arr
      arr = null
      arrKey = null
    }
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (!k) continue
    if (v === '') { arrKey = k; arr = []; continue }
    if (v.startsWith('"') && v.endsWith('"')) {
      try { fm[k] = JSON.parse(v); continue } catch { /* fall through */ }
    }
    fm[k] = v
  }
  if (arr !== null) fm[arrKey] = arr
  return { frontmatter: fm, body: m[2].trim() }
}

async function postEvent(payload) {
  const res = await fetch(`${NEXUS_BASE_URL.replace(/\/$/, '')}/api/memory/event`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${MEMORY_HQ_TOKEN}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { ok: res.ok, status: res.status, json, raw: json ? null : text.slice(0, 200) }
}

function buildPayload(kindDir, filename, fm, body) {
  const title = (fm.title || filename.replace(/\.md$/, '')).toString()
  return {
    type:   KIND_TO_TYPE[kindDir],
    source: 'backfill:nexus-2026-05-04',
    scope:  { repo: REPO_SCOPE },
    payload: {
      title,
      body,
      sources:    Array.isArray(fm.sources) ? fm.sources : [],
      links:      Array.isArray(fm.links)   ? fm.links   : [],
      kind:       fm.kind       || undefined,
      importance: fm.importance || undefined,
    },
    locators: [
      { kind: 'github', repo: REPO_SCOPE, path: `${ROOT}/${kindDir}/${filename}` },
    ],
    trace_id: `backfill-2026-05-04-${kindDir}-${filename.replace(/\.md$/, '')}`,
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const stats  = { processed: 0, ok: 0, failed: 0, skipped: 0 }
  const errors = []
  console.log(`Backfill → ${NEXUS_BASE_URL}/api/memory/event`)
  console.log(`Scope:    repo=${REPO_SCOPE}`)
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`Throttle: ${THROTTLE_MS}ms between writes`)

  for (const kindDir of KIND_DIRS) {
    let files
    try { files = await readdir(join(ROOT, kindDir)) }
    catch { continue }
    files = files.filter(f => f.endsWith('.md')).sort()
    if (files.length === 0) continue
    console.log(`\n[${kindDir}] ${files.length} file(s)`)

    for (const filename of files) {
      stats.processed++
      const fullPath = join(ROOT, kindDir, filename)
      let fm, body
      try {
        const raw = await readFile(fullPath, 'utf8')
        const parsed = parseFrontmatter(raw)
        fm = parsed.frontmatter
        body = parsed.body
      } catch (e) {
        stats.failed++
        errors.push({ file: fullPath, err: `read: ${e.message}` })
        console.log(`  ✗ ${filename} → read error: ${e.message}`)
        continue
      }

      const payload = buildPayload(kindDir, filename, fm, body)

      if (DRY_RUN) {
        stats.ok++
        console.log(`  ⋯ ${filename} → ${payload.type} "${payload.payload.title.slice(0, 70)}"`)
        continue
      }

      try {
        const r = await postEvent(payload)
        if (r.ok) {
          stats.ok++
          console.log(`  ✓ ${filename} → ${r.json?.path || '(unknown path)'}`)
        } else {
          stats.failed++
          const err = r.json?.error || r.raw || `HTTP ${r.status}`
          errors.push({ file: fullPath, status: r.status, err })
          console.log(`  ✗ ${filename} → ${r.status} ${err}`)
        }
      } catch (e) {
        stats.failed++
        errors.push({ file: fullPath, err: e.message })
        console.log(`  ✗ ${filename} → ${e.message}`)
      }
      await sleep(THROTTLE_MS)
    }
  }

  console.log('\nSummary:', JSON.stringify(stats))
  if (errors.length) {
    console.log('\nErrors:')
    for (const e of errors) console.log(' ', JSON.stringify(e))
  }
  process.exit(stats.failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
