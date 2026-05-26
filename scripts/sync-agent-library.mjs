#!/usr/bin/env node
/**
 * Nexus — sync `.claude/agents/*.md` → `agent_library` Supabase table.
 *
 * The markdown files on disk are the source of truth. This script mirrors
 * them into the DB so:
 *   - The /settings/agents UI can join against runtime metadata
 *   - lib/database.types.ts agent_library.hooks (migration 055) +
 *     .inject_platform_brief (migration 069) have rows to opt-in/out on
 *   - Any future feature that queries by slug works (today only the disk
 *     read works)
 *
 * Walks `.claude/agents/*.md`, parses each via the same inline YAML
 * frontmatter shape as lib/agent-registry.ts, then upserts on
 * (user_id, slug). Idempotent — re-running just updates version + body.
 *
 * Usage:
 *   doppler run --config prd -- node scripts/sync-agent-library.mjs
 *
 * Required env (all from Doppler):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALLOWED_USER_IDS              -- first id in the CSV becomes the row owner
 *
 * Optional:
 *   --dry-run                     -- print upserts but don't write
 *   --user-id=user_xxx            -- override owner (skips ALLOWED_USER_IDS read)
 */

import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname     = dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR    = join(__dirname, '..', '.claude', 'agents')
const REST_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ARGV          = process.argv.slice(2)
const DRY_RUN       = ARGV.includes('--dry-run')
const USER_ID_FLAG  = (ARGV.find(a => a.startsWith('--user-id=')) ?? '').slice('--user-id='.length).trim()

if (!REST_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run via `doppler run -- node …`.')
  process.exit(1)
}

const ownerId = USER_ID_FLAG || (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
if (!ownerId) {
  console.error('❌  Cannot resolve owner user_id. Pass --user-id=… or set ALLOWED_USER_IDS in Doppler.')
  process.exit(1)
}

// ── Minimal frontmatter parser (mirrors lib/agent-registry.ts::parseFrontmatter) ──
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function stripComment(line) {
  const hash = line.indexOf('#')
  if (hash === -1) return line
  const before = line.slice(0, hash)
  const quotes = (before.match(/["']/g) ?? []).length
  return quotes % 2 === 0 ? before : line
}
function unquote(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
function parseFrontmatter(src) {
  const out = {}
  const lines = src.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = stripComment(lines[i])
    if (!line.trim()) { i++; continue }
    const scalar = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!scalar) { i++; continue }
    const key = scalar[1]
    const value = scalar[2].trim()
    if (value === '') {
      const items = []
      i++
      while (i < lines.length) {
        const next = stripComment(lines[i])
        const item = next.match(/^\s+-\s+(.*)$/)
        if (!item) break
        items.push(unquote(item[1]))
        i++
      }
      out[key] = items
      continue
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean)
      i++
      continue
    }
    if (value === 'true' || value === 'false') {
      out[key] = value === 'true'
      i++
      continue
    }
    out[key] = unquote(value)
    i++
  }
  if (typeof out.tools === 'string') {
    out.tools = out.tools.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (Array.isArray(out.env)) {
    out.envVars = out.env
    delete out.env
  }
  return out
}

function parseAgentMarkdown(slug, raw, sourcePath) {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error(`Agent spec ${slug} is missing YAML frontmatter`)
  }
  const fm = parseFrontmatter(match[1])
  const body = match[2].trim()
  return {
    slug,
    name:         fm.name         ?? slug,
    description:  fm.description  ?? '',
    tools:        fm.tools        ?? [],
    model:        fm.model        ?? 'claude-sonnet-4-6',
    transferable: fm.transferable ?? true,
    env_vars:     fm.envVars      ?? [],
    system_prompt: body,
    source_path:  sourcePath,
  }
}

// ── Walk + upsert ─────────────────────────────────────────────────────────────
const files = (await readdir(AGENTS_DIR)).filter(f => f.endsWith('.md'))
console.log(`🔍  Scanning ${AGENTS_DIR} — ${files.length} candidate files`)

let inserted = 0
let updated  = 0
let skipped  = 0
const failures = []

for (const file of files) {
  const slug = file.replace(/\.md$/, '')
  const path = join(AGENTS_DIR, file)
  let raw
  try { raw = await readFile(path, 'utf8') }
  catch (e) { failures.push({ slug, error: e.message }); continue }

  // Skip template files marked as such (they're not real agents). Detect via
  // the conventional "TEMPLATE — never invoked directly" marker that the
  // codebase uses for role / department templates.
  if (/TEMPLATE\s*—\s*never\s+invoked\s+directly/i.test(raw)) {
    console.log(`  ↷  ${slug} — TEMPLATE marker, skipped`)
    skipped++
    continue
  }

  let agent
  try { agent = parseAgentMarkdown(slug, raw, `.claude/agents/${file}`) }
  catch (e) { failures.push({ slug, error: e.message }); continue }

  const record = {
    user_id:       ownerId,
    slug:          agent.slug,
    name:          agent.name,
    description:   agent.description,
    tools:         agent.tools,
    model:         agent.model,
    transferable:  agent.transferable,
    env_vars:      agent.env_vars,
    system_prompt: agent.system_prompt,
    source_path:   agent.source_path,
  }

  if (DRY_RUN) {
    console.log(`  ⚪  [dry] ${slug} (${record.tools.length} tools, ${record.system_prompt.length} chars)`)
    continue
  }

  const res = await fetch(
    `${REST_URL}/rest/v1/agent_library?on_conflict=user_id,slug`,
    {
      method:  'POST',
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:        'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(record),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    failures.push({ slug, error: `HTTP ${res.status}: ${text.slice(0, 200)}` })
    continue
  }
  // PostgREST returns the upserted row(s). If `created_at === updated_at`
  // it's a fresh insert; otherwise it's an update. Approximate detection.
  const body = await res.json().catch(() => null)
  const row  = Array.isArray(body) ? body[0] : body
  if (row && row.created_at && row.updated_at && row.created_at === row.updated_at) {
    inserted++
    console.log(`  ✅  ${slug} inserted`)
  } else {
    updated++
    console.log(`  ↻  ${slug} updated`)
  }
}

console.log('')
console.log(`Done. inserted=${inserted}  updated=${updated}  skipped=${skipped}  failures=${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`  ❌  ${f.slug}: ${f.error}`)
  process.exit(1)
}
