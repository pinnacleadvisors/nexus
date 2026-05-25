#!/usr/bin/env node
/**
 * scripts/hmem-backfill-wikilinks.mjs — populate mol_edge from existing atoms.
 *
 * Reads every row in `mol_atoms`, parses `[[wikilinks]]` from the body, and
 * inserts one `mol_edge` per discovered link with:
 *   - src_id = "<scope_id>:<slug>"  (the atom that holds the link)
 *   - dst_id = "<scope_id>:<slug>"  (the linked atom, scope inherited)
 *   - predicate = 'mentions'
 *   - confidence = 1.0
 *   - source = 'wikilink'
 *
 * Idempotent — re-runs skip edges that already exist.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/hmem-backfill-wikilinks.mjs [--dry-run] [--scope=<scope_id>]
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SET NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.')
  process.exit(2)
}

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const SCOPE_FILTER = (args.find(a => a.startsWith('--scope='))?.split('=')[1]) ?? null

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// Capture every [[link]] OR [[link|alias]] in the body. Reject empty
// brackets and obvious markdown image / link syntax.
const WIKILINK_RE = /\[\[([^\[\]\n|]+)(?:\|[^\]]+)?\]\]/g

function parseWikilinks(body) {
  const out = new Set()
  let m
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1].trim()
    if (target.length === 0) continue
    // Drop common false positives.
    if (target.includes('http://') || target.includes('https://')) continue
    out.add(target)
  }
  return [...out]
}

async function main() {
  console.log(`hmem-backfill-wikilinks ${DRY ? '(DRY RUN) ' : ''}— ${SCOPE_FILTER ? `scope=${SCOPE_FILTER}` : 'all scopes'}`)

  let query = db.from('mol_atoms').select('scope_id, slug, body_md')
  if (SCOPE_FILTER) query = query.eq('scope_id', SCOPE_FILTER)

  const { data: atoms, error } = await query
  if (error) {
    console.error('mol_atoms read failed:', error.message)
    process.exit(3)
  }

  let scanned = 0, linksFound = 0, edgesInserted = 0, edgesSkipped = 0

  for (const atom of atoms ?? []) {
    scanned++
    const links = parseWikilinks(atom.body_md ?? '')
    linksFound += links.length

    for (const target of links) {
      // Wikilinks resolve within the same scope by convention. Cross-scope
      // links would need `<scope>:<slug>` in the wikilink itself — defer
      // to a later pass.
      const srcId = `${atom.scope_id}:${atom.slug}`
      const dstId = `${atom.scope_id}:${target}`

      if (DRY) { edgesInserted++; continue }

      // Insert; rely on a unique index to skip duplicates (we don't have
      // one defined yet — use a manual exists-check on the (src,dst,pred)
      // triple).
      const { data: existing } = await db
        .from('mol_edge')
        .select('id')
        .eq('scope_id',  atom.scope_id)
        .eq('src_id',    srcId)
        .eq('dst_id',    dstId)
        .eq('predicate', 'mentions')
        .eq('source',    'wikilink')
        .limit(1)
        .maybeSingle()

      if (existing) { edgesSkipped++; continue }

      const { error: insErr } = await db.from('mol_edge').insert({
        scope_id:   atom.scope_id,
        src_kind:   'atom',
        src_id:     srcId,
        predicate:  'mentions',
        dst_kind:   'atom',
        dst_id:     dstId,
        confidence: 1.0,
        source:     'wikilink',
      })
      if (insErr) {
        console.warn(`insert failed for ${srcId} -> ${dstId}:`, insErr.message)
      } else {
        edgesInserted++
      }
    }
  }

  console.log(`scanned   ${scanned} atoms`)
  console.log(`links     ${linksFound} wikilinks found`)
  console.log(`inserted  ${edgesInserted}${DRY ? ' (would-have)' : ''}`)
  console.log(`skipped   ${edgesSkipped} (already present)`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
