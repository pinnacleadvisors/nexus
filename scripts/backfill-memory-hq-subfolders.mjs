#!/usr/bin/env node
/**
 * Subfolder-cache merge: walks memory/<topic>/molecular/{atoms,entities,mocs,sources,synthesis}/
 * for every <topic> in memory/ EXCEPT the canonical top-level memory/molecular/
 * (which scripts/backfill-memory-hq.mjs already covers), and POSTs each file to
 * /api/memory/event so it lands in memory-hq under repo:pinnacleadvisors/nexus.
 *
 * Why a script: memory/integration/molecular, memory/roadmap/molecular, and
 * memory/tasks/molecular were created before MOLECULAR_BACKEND defaulted to
 * github. Their contents (~100 files: pattern atoms, phase atoms, manual atoms,
 * task atoms + topic MOCs) are still local-only.
 *
 * Run:
 *   doppler run -- node scripts/backfill-memory-hq-subfolders.mjs            # actual push
 *   doppler run -- node scripts/backfill-memory-hq-subfolders.mjs --dry-run  # preview
 *
 * Idempotent: receiver upserts by SHA, so re-running becomes a no-op for
 * unchanged files.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT_MEMORY = 'memory'
const SKIP_TOPICS = new Set(['molecular', 'platform', 'roadmap', 'daily', 'tasks'])
// Note: roadmap & tasks contain SUMMARY/PENDING/etc which we DO want, but only
// inside their molecular/ subfolders. We re-allow them below by walking
// memory/<topic>/molecular/ explicitly.
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
      try { fm[k] = JSON.parse(v); continue } catch {}
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

function buildPayload(topic, kindDir, filename, fm, body) {
  const title = (fm.title || filename.replace(/\.md$/, '')).toString()
  const localPath = `${ROOT_MEMORY}/${topic}/molecular/${kindDir}/${filename}`
  return {
    type:   KIND_TO_TYPE[kindDir],
    source: 'merge:nexus-subfolders-2026-05-06',
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
      { kind: 'github', repo: REPO_SCOPE, path: localPath },
    ],
    trace_id: `merge-2026-05-06-${topic}-${kindDir}-${filename.replace(/\.md$/, '')}`,
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function listTopicsWithMolecular() {
  const out = []
  let entries = []
  try { entries = await readdir(ROOT_MEMORY) } catch { return out }
  for (const topic of entries) {
    if (topic === 'molecular') continue
    const candidate = join(ROOT_MEMORY, topic, 'molecular')
    try {
      const s = await stat(candidate)
      if (s.isDirectory()) out.push(topic)
    } catch { /* not a directory */ }
  }
  return out.sort()
}

async function main() {
  const stats  = { processed: 0, ok: 0, failed: 0 }
  const errors = []
  console.log(`Subfolder merge → ${NEXUS_BASE_URL}/api/memory/event`)
  console.log(`Scope:    repo=${REPO_SCOPE}`)
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`Throttle: ${THROTTLE_MS}ms between writes`)

  const topics = await listTopicsWithMolecular()
  console.log(`Topics with molecular/: ${topics.join(', ')}`)

  for (const topic of topics) {
    for (const kindDir of KIND_DIRS) {
      const dirPath = join(ROOT_MEMORY, topic, 'molecular', kindDir)
      let files
      try { files = await readdir(dirPath) }
      catch { continue }
      files = files.filter(f => f.endsWith('.md')).sort()
      if (files.length === 0) continue
      console.log(`\n[${topic}/${kindDir}] ${files.length} file(s)`)

      for (const filename of files) {
        stats.processed++
        const fullPath = join(dirPath, filename)
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

        const payload = buildPayload(topic, kindDir, filename, fm, body)

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
  }

  console.log('\nSummary:', JSON.stringify(stats))
  if (errors.length) {
    console.log('\nErrors:')
    for (const e of errors) console.log(' ', JSON.stringify(e))
  }
  process.exit(stats.failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
