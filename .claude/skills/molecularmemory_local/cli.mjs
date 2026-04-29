#!/usr/bin/env node
// /molecularmemory_local CLI — file-based atomic/entity/MOC notes with wikilink edges.
// All commands print JSON on stdout and exit 0 on success.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), process.env.MOLECULAR_ROOT || 'memory/molecular')
const DIRS = {
  atoms: join(ROOT, 'atoms'),
  entities: join(ROOT, 'entities'),
  mocs: join(ROOT, 'mocs'),
  sources: join(ROOT, 'sources'),
  synthesis: join(ROOT, 'synthesis'),
}
const INDEX = join(ROOT, 'INDEX.md')
const GRAPH = join(ROOT, '.graph.json')
const LOG = join(ROOT, 'log.md')

// Parse all args; use first positional as cmd. This lets flags like
// --backend=github / --scope=... appear before OR after the command verb.
const allArgs = process.argv.slice(2)
const _parsed = parseArgs(allArgs)
const cmd = _parsed.positional.shift()
const positional = _parsed.positional
const flags = _parsed.flags

// Backend dispatch: --backend=github routes to a separate handler that
// writes to pinnacleadvisors/memory-hq via the Contents API. Default
// backend is local fs. See github-commands.mjs for the github handler.
const BACKEND = flags.backend || process.env.MOLECULAR_BACKEND || 'local'
if (BACKEND === 'github') {
  const { dispatch } = await import('./github-commands.mjs')
  try {
    await dispatch(cmd, positional, flags)
    process.exit(0)
  } catch (e) {
    fail(e.message || String(e))
  }
}

try {
  switch (cmd) {
    case 'init':      await initVault(); break
    case 'atom':      await createAtom(positional[0], flags); break
    case 'entity':    await createEntity(positional[0], positional[1], flags); break
    case 'moc':       await createMoc(positional[0], flags); break
    case 'source':    await createSource(positional[0], flags); break
    case 'synthesis': await createSynthesis(positional[0], flags); break
    case 'ingest':    await ingest(positional[0], flags); break
    case 'log':       await appendLog(positional[0], positional.slice(1).join(' '), flags); break
    case 'lint':      await lint(flags); break
    case 'link':      await linkNotes(positional[0], positional[1]); break
    case 'graph':     await buildGraph(flags); break
    case 'query':     await query(positional.join(' ')); break
    case 'reindex':   await reindex(); break
    case 'touch':     await touchAtom(positional[0]); break
    case 'supersede': await supersedeAtom(positional[0], positional[1]); break
    case 'migrate-decay': await migrateAtomDecay(); break
    default:          fail(`unknown command: ${cmd}. See SKILL.md`)
  }
} catch (e) {
  fail(e.message || String(e))
}

// ── commands ──────────────────────────────────────────────────────────────

async function initVault() {
  for (const d of Object.values(DIRS)) await mkdir(d, { recursive: true })
  if (!existsSync(INDEX)) {
    await writeFile(INDEX, seedIndex(), 'utf8')
  }
  if (!existsSync(LOG)) {
    await writeFile(LOG, seedLog(), 'utf8')
  }
  ok({ initialized: ROOT })
}

async function createAtom(title, flags) {
  if (!title || !flags.fact) fail('usage: atom <title> --fact="..." [--source=URL] [--links=a,b]')
  await ensureDirs()
  const slug = slugify(title)
  const path = join(DIRS.atoms, `${slug}.md`)
  if (existsSync(path)) fail(`atom already exists: ${slug}. Use link to add edges, or pick a new title.`, { slug })
  const body = buildNote({
    type: 'atom',
    title,
    slug,
    created: today(),
    sources: flags.source ? [flags.source] : [],
    links: splitList(flags.links),
    fact: flags.fact,
  })
  await writeFile(path, body, 'utf8')
  await reindex()
  ok({ created: relative(process.cwd(), path), slug, type: 'atom' })
}

async function createEntity(type, name, flags) {
  const valid = ['person', 'company', 'concept', 'project']
  if (!type || !name || !valid.includes(type)) fail(`usage: entity <${valid.join('|')}> <name> [--description=...] [--aliases=a,b]`)
  await ensureDirs()
  const slug = slugify(name)
  const path = join(DIRS.entities, `${slug}.md`)
  if (existsSync(path)) {
    // Update description/aliases if provided
    const existing = await readFile(path, 'utf8')
    const merged = mergeEntity(existing, { description: flags.description, aliases: splitList(flags.aliases) })
    await writeFile(path, merged, 'utf8')
    ok({ updated: relative(process.cwd(), path), slug, type: 'entity' })
    return
  }
  const body = buildNote({
    type: 'entity',
    subtype: type,
    title: name,
    slug,
    created: today(),
    aliases: splitList(flags.aliases),
    description: flags.description || '',
    links: [],
  })
  await writeFile(path, body, 'utf8')
  await reindex()
  ok({ created: relative(process.cwd(), path), slug, type: 'entity', subtype: type })
}

async function createMoc(title, flags) {
  if (!title) fail('usage: moc <title> [--atoms=a,b] [--entities=x,y] [--description="..."]')
  await ensureDirs()
  const slug = slugify(title)
  const path = join(DIRS.mocs, `${slug}.md`)
  const atoms = splitList(flags.atoms)
  const entities = splitList(flags.entities)
  const body = buildMoc({ title, slug, atoms, entities, description: flags.description || '' })
  await writeFile(path, body, 'utf8')
  await reindex()
  ok({ created: relative(process.cwd(), path), slug, type: 'moc', atoms, entities })
}

async function linkNotes(a, b) {
  if (!a || !b) fail('usage: link <from-slug> <to-slug>')
  const fromPath = await findBySlug(a)
  const toPath = await findBySlug(b)
  if (!fromPath || !toPath) fail(`could not resolve slug(s): from=${fromPath ? 'ok' : a}, to=${toPath ? 'ok' : b}`)
  await appendWikilink(fromPath, b)
  await appendWikilink(toPath, a)
  ok({ linked: [a, b] })
}

async function createSource(title, flags) {
  if (!title || !flags.url) fail('usage: source <title> --url=<url> [--summary="..."] [--body=<path>] [--moc=slug] [--links=a,b]')
  await ensureDirs()
  const slug = slugify(title)
  const path = join(DIRS.sources, `${slug}.md`)
  if (existsSync(path)) fail(`source already exists: ${slug}. Pick a new title or edit the file directly.`, { slug })
  let body = flags.summary || ''
  if (flags.body) {
    if (!existsSync(flags.body)) fail(`--body file not found: ${flags.body}`)
    body = await readFile(flags.body, 'utf8')
  }
  const links = splitList(flags.links)
  const moc = flags.moc ? slugify(flags.moc) : null
  const note = buildSource({ title, slug, url: flags.url, body, links, moc })
  await writeFile(path, note, 'utf8')
  if (moc) await linkSourceToMoc(moc, slug)
  await appendLog('ingest', title, { ref: `sources/${slug}.md`, url: flags.url })
  await reindex()
  ok({ created: relative(process.cwd(), path), slug, type: 'source', moc })
}

async function createSynthesis(title, flags) {
  if (!title || !flags.body) fail('usage: synthesis <title> --body=<path> [--question="..."] [--links=a,b] [--moc=slug]')
  await ensureDirs()
  const slug = slugify(title)
  const path = join(DIRS.synthesis, `${slug}.md`)
  if (existsSync(path)) fail(`synthesis already exists: ${slug}. Pick a new title or edit the file directly.`, { slug })
  if (!existsSync(flags.body)) fail(`--body file not found: ${flags.body}`)
  const body = await readFile(flags.body, 'utf8')
  const links = splitList(flags.links)
  const moc = flags.moc ? slugify(flags.moc) : null
  const note = buildSynthesis({ title, slug, question: flags.question || '', body, links, moc })
  await writeFile(path, note, 'utf8')
  if (moc) await linkSynthesisToMoc(moc, slug)
  await appendLog('synthesis', title, { ref: `synthesis/${slug}.md` })
  await reindex()
  ok({ created: relative(process.cwd(), path), slug, type: 'synthesis', moc })
}

async function ingest(target, flags) {
  if (!target) fail('usage: ingest <url|path> --title="..." [--summary="..."] [--body=<path>] [--moc=slug] [--links=a,b]')
  if (!flags.title) fail('ingest requires --title="..." (Claude reads the source first, then names the page)')
  const isUrl = /^https?:\/\//i.test(target)
  const flagsForSource = { ...flags, url: isUrl ? target : `file://${resolve(target)}` }
  if (!flagsForSource.body && !flagsForSource.summary) {
    fail('ingest requires either --summary="..." or --body=<path-to-markdown-from-firecrawl_local>. Run firecrawl_local scrape first, then pass the resulting file as --body.')
  }
  await createSource(flags.title, flagsForSource)
}

async function appendLog(op, title, flags = {}) {
  if (!op || !title) fail('usage: log <op> "<title>" [--ref=path] [--url=...]')
  await ensureDirs()
  // Step 4 — file-per-event: each log entry becomes its own file.
  // Eliminates merge-conflict surface from concurrent writers. The legacy
  // log.md is still appended for back-compat readers.
  const logDir = join(ROOT, 'log')
  await mkdir(logDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = String(title).toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  const eventFile = join(logDir, `${ts}-${op}-${safe}.md`)
  const refs = []
  if (flags.ref) refs.push(`- ref: \`${flags.ref}\``)
  if (flags.url) refs.push(`- url: <${flags.url}>`)
  const eventBody = [
    '---',
    `op: ${op}`,
    `title: ${JSON.stringify(title)}`,
    `ts: ${new Date().toISOString()}`,
    flags.ref ? `ref: ${flags.ref}` : '',
    flags.url ? `url: ${flags.url}` : '',
    '---',
    '',
    `# ${op}: ${title}`,
    '',
    refs.join('\n'),
    '',
  ].filter(Boolean).join('\n')
  await writeFile(eventFile, eventBody, 'utf8')
  // Legacy single-file log (kept for back-compat).
  if (!existsSync(LOG)) await writeFile(LOG, seedLog(), 'utf8')
  const date = today()
  const refsInline = []
  if (flags.ref) refsInline.push(`[\`${flags.ref}\`](${flags.ref})`)
  if (flags.url) refsInline.push(`<${flags.url}>`)
  const suffix = refsInline.length ? ` — ${refsInline.join(' · ')}` : ''
  const line = `## [${date}] ${op} | ${title}${suffix}\n`
  const raw = await readFile(LOG, 'utf8')
  const next = raw.endsWith('\n') ? raw + line : raw + '\n' + line
  await writeFile(LOG, next, 'utf8')
  ok({ logged: relative(process.cwd(), eventFile), legacy: relative(process.cwd(), LOG), op, title, date })
}

async function lint(flags) {
  await ensureDirs()
  if (!existsSync(GRAPH)) await buildGraph({})
  const graph = JSON.parse(await readFile(GRAPH, 'utf8'))
  const slugs = new Set(graph.nodes.map((n) => n.slug))
  const incoming = new Map()
  for (const e of graph.edges) {
    incoming.set(e.to, (incoming.get(e.to) || 0) + 1)
  }
  const dangling = graph.edges.filter((e) => !slugs.has(e.to))
  const orphanAtoms = []
  const sourcelessAtoms = []
  const staleAtoms = []
  const emptyEntities = []
  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  const staleThresholdMs = Number(flags['stale-days'] || 90) * 24 * 60 * 60 * 1000
  const now = Date.now()
  for (const n of graph.nodes) {
    const raw = await readFile(n.path, 'utf8')
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)
    const created = fm && fm[1].match(/\ncreated:\s*([0-9-]+)/)?.[1]
    const hasSource = /\nsources:\s*\n  - /.test(raw) || /\nsources:\s*\[/.test(raw)
    if (n.kind === 'atom') {
      if ((incoming.get(n.slug) || 0) === 0) orphanAtoms.push(n.slug)
      if (!hasSource) sourcelessAtoms.push(n.slug)
      if (created) {
        const age = now - new Date(created).getTime()
        if (age > staleThresholdMs && age < 10 * oneYearMs) staleAtoms.push({ slug: n.slug, created })
      }
    }
    if (n.kind === 'entity') {
      const linkedAtoms = graph.edges.filter((e) => e.to === n.slug && graph.nodes.find((x) => x.slug === e.from)?.kind === 'atom')
      if (linkedAtoms.length === 0) emptyEntities.push(n.slug)
    }
  }
  const report = {
    generated: new Date().toISOString(),
    counts: { nodes: graph.nodes.length, edges: graph.edges.length },
    issues: {
      danglingWikilinks: dangling.map((e) => ({ from: e.from, to: e.to })),
      orphanAtoms,
      sourcelessAtoms,
      staleAtoms,
      emptyEntities,
    },
  }
  const total = dangling.length + orphanAtoms.length + sourcelessAtoms.length + staleAtoms.length + emptyEntities.length
  if (flags.write) {
    await appendLog('lint', `${total} issues`, { ref: 'log.md' })
  }
  ok({ total, ...report })
}

async function linkSourceToMoc(mocSlug, sourceSlug) {
  const mocPath = join(DIRS.mocs, `${mocSlug}.md`)
  if (!existsSync(mocPath)) return
  const raw = await readFile(mocPath, 'utf8')
  const tag = `[[sources/${sourceSlug}]]`
  if (raw.includes(tag)) return
  const sectionRe = /\n## Sources\n([\s\S]*?)(?=\n## |\n*$)/
  let next
  if (sectionRe.test(raw)) {
    next = raw.replace(sectionRe, (m, body) => `\n## Sources\n${body.trimEnd()}\n- ${tag}\n`)
  } else {
    next = (raw.endsWith('\n') ? raw : raw + '\n') + `\n## Sources\n- ${tag}\n`
  }
  await writeFile(mocPath, next, 'utf8')
}

async function linkSynthesisToMoc(mocSlug, synthSlug) {
  const mocPath = join(DIRS.mocs, `${mocSlug}.md`)
  if (!existsSync(mocPath)) return
  const raw = await readFile(mocPath, 'utf8')
  const tag = `[[synthesis/${synthSlug}]]`
  if (raw.includes(tag)) return
  const sectionRe = /\n## Synthesis\n([\s\S]*?)(?=\n## |\n*$)/
  let next
  if (sectionRe.test(raw)) {
    next = raw.replace(sectionRe, (m, body) => `\n## Synthesis\n${body.trimEnd()}\n- ${tag}\n`)
  } else {
    next = (raw.endsWith('\n') ? raw : raw + '\n') + `\n## Synthesis\n- ${tag}\n`
  }
  await writeFile(mocPath, next, 'utf8')
}

async function buildGraph(flags) {
  await ensureDirs()
  const nodes = []
  const edges = []
  const slugToKind = new Map()
  const singular = { atoms: 'atom', entities: 'entity', mocs: 'moc', sources: 'source', synthesis: 'synthesis' }
  for (const [kind, dir] of Object.entries(DIRS)) {
    for (const f of await lsMd(dir)) {
      const p = join(dir, f)
      const raw = await readFile(p, 'utf8')
      const slug = f.replace(/\.md$/, '')
      nodes.push({ slug, kind: singular[kind], path: relative(process.cwd(), p), title: extractTitle(raw) })
      slugToKind.set(slug, singular[kind])
    }
  }
  // Second pass: extract edges
  const edgeSet = new Set()
  for (const n of nodes) {
    const raw = await readFile(n.path, 'utf8')
    for (const m of raw.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const target = slugify(m[1].trim().replace(/^(atoms|entities|mocs|sources|synthesis)\//, ''))
      if (target === n.slug) continue
      const key = `${n.slug}→${target}`
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      edges.push({ from: n.slug, to: target, targetExists: slugToKind.has(target) })
    }
  }
  const degree = new Map(nodes.map((n) => [n.slug, 0]))
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1)
    if (degree.has(e.to)) degree.set(e.to, degree.get(e.to) + 1)
  }
  const orphans = nodes.filter((n) => (degree.get(n.slug) || 0) === 0).map((n) => n.slug)
  const hubs = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([slug, d]) => ({ slug, degree: d }))
  const graph = { generated: new Date().toISOString(), nodeCount: nodes.length, edgeCount: edges.length, nodes, edges, orphans, hubs }
  await writeFile(GRAPH, JSON.stringify(graph, null, 2), 'utf8')
  if (flags.dot) console.log(renderDot(nodes, edges))
  else ok({ nodes: nodes.length, edges: edges.length, orphans: orphans.length, hubs, cached: relative(process.cwd(), GRAPH) })
}

async function query(text) {
  if (!text) fail('usage: query <text>')
  await ensureDirs()
  // Load graph (build if missing) to get degree for ranking
  if (!existsSync(GRAPH)) await buildGraph({})
  const graph = JSON.parse(await readFile(GRAPH, 'utf8'))
  const degree = new Map()
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1)
    degree.set(e.to, (degree.get(e.to) || 0) + 1)
  }
  const needles = text.toLowerCase().split(/\s+/).filter(Boolean)
  const results = []
  for (const n of graph.nodes) {
    const raw = (await readFile(n.path, 'utf8')).toLowerCase()
    let score = 0
    for (const w of needles) {
      const hits = (raw.match(new RegExp(escapeRegex(w), 'g')) || []).length
      if (hits === 0) { score = 0; break }
      score += hits
    }
    if (score > 0) {
      const d = degree.get(n.slug) || 0
      results.push({ slug: n.slug, title: n.title, kind: n.kind, score, degree: d, rank: score + d * 0.5, path: n.path })
    }
  }
  results.sort((a, b) => b.rank - a.rank)
  ok({ query: text, count: results.length, results: results.slice(0, 25) })
}

async function reindex() {
  await ensureDirs()
  const groups = {}
  const atomDecay = []
  for (const [kind, dir] of Object.entries(DIRS)) {
    groups[kind] = []
    for (const f of await lsMd(dir)) {
      const raw = await readFile(join(dir, f), 'utf8')
      const slug = f.replace(/\.md$/, '')
      const title = extractTitle(raw)
      groups[kind].push({ slug, title })
      if (kind === 'atoms') {
        atomDecay.push({ slug, title, tier: computeDecayTier(raw) })
      }
    }
  }
  const tiers = { hot: [], warm: [], cold: [], superseded: [] }
  for (const a of atomDecay) tiers[a.tier].push(a)
  const tierLine = (a) => `- [[atoms/${a.slug}|${a.title}]]`
  const sliceLine = (arr, n, label) =>
    arr.length > n ? [`\n…and ${arr.length - n} more ${label}.`] : []

  const md = [
    '# Molecular Memory — Index',
    '',
    '> Topic hubs, entities, atomic facts, ingested sources, and synthesis. Start at a MOC, follow [[wikilinks]] from there.',
    '> Generated by `.claude/skills/molecularmemory_local/cli.mjs reindex` — do not edit by hand.',
    '> Atoms are grouped by **decay tier** (Hot / Warm / Cold / Superseded). Hot = accessed recently AND often.',
    '',
    `_Last updated: ${today()}_`,
    '',
    `## Maps of Content (${groups.mocs.length})`,
    ...groups.mocs.map((n) => `- [[mocs/${n.slug}|${n.title}]]`),
    '',
    `## Entities (${groups.entities.length})`,
    ...groups.entities.map((n) => `- [[entities/${n.slug}|${n.title}]]`),
    '',
    `## Atomic notes (${groups.atoms.length})`,
    '',
    `### Hot — recent + frequent (${tiers.hot.length})`,
    ...tiers.hot.slice(0, 60).map(tierLine),
    ...sliceLine(tiers.hot, 60, 'hot atoms'),
    '',
    `### Warm — accessed within 60 days (${tiers.warm.length})`,
    ...tiers.warm.slice(0, 80).map(tierLine),
    ...sliceLine(tiers.warm, 80, 'warm atoms'),
    '',
    `### Cold — stale, candidate for review (${tiers.cold.length})`,
    ...tiers.cold.slice(0, 40).map(tierLine),
    ...sliceLine(tiers.cold, 40, 'cold atoms'),
    '',
    tiers.superseded.length
      ? `### Superseded — kept for history (${tiers.superseded.length})`
      : `### Superseded (0)`,
    ...tiers.superseded.slice(0, 40).map(tierLine),
    ...sliceLine(tiers.superseded, 40, 'superseded atoms'),
    '',
    `## Sources (${groups.sources.length})`,
    ...groups.sources.slice(0, 100).map((n) => `- [[sources/${n.slug}|${n.title}]]`),
    groups.sources.length > 100 ? `\n…and ${groups.sources.length - 100} more.` : '',
    '',
    `## Synthesis (${groups.synthesis.length})`,
    ...groups.synthesis.slice(0, 100).map((n) => `- [[synthesis/${n.slug}|${n.title}]]`),
    '',
    '## Activity log',
    `See [\`log.md\`](log.md) — append-only chronological record of ingest/synthesis/lint events.`,
    '',
  ].join('\n')
  await writeFile(INDEX, md, 'utf8')
  ok({
    indexed: relative(process.cwd(), INDEX),
    counts: {
      mocs: groups.mocs.length,
      entities: groups.entities.length,
      atoms: groups.atoms.length,
      hot: tiers.hot.length,
      warm: tiers.warm.length,
      cold: tiers.cold.length,
      superseded: tiers.superseded.length,
    },
  })
}

// Decay tier: superseded → cold-archive, otherwise based on lastAccessed age + accessCount.
// Hot   = accessed in last 14 days AND accessCount >= 5
// Warm  = accessed in last 60 days
// Cold  = older than 60 days OR no decay metadata yet
function computeDecayTier(raw) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return 'cold'
  const block = fm[1]
  const status = (block.match(/\nstatus:\s*(\w+)/) || block.match(/^status:\s*(\w+)/) || [])[1]
  if (status === 'superseded' || status === 'archived') return 'superseded'
  const lastAccessed = (block.match(/\nlastAccessed:\s*([0-9-]+)/) || [])[1]
  const accessCountRaw = (block.match(/\naccessCount:\s*(\d+)/) || [])[1]
  if (!lastAccessed) return 'cold'
  const ageDays = Math.floor((Date.now() - new Date(lastAccessed).getTime()) / 86400000)
  const accessCount = accessCountRaw ? parseInt(accessCountRaw, 10) : 0
  if (ageDays <= 14 && accessCount >= 5) return 'hot'
  if (ageDays <= 60) return 'warm'
  return 'cold'
}

async function touchAtom(slug) {
  if (!slug) fail('usage: touch <atom-slug>')
  const path = join(DIRS.atoms, `${slugify(slug)}.md`)
  if (!existsSync(path)) fail(`atom not found: ${slug}`)
  const raw = await readFile(path, 'utf8')
  const now = new Date().toISOString().slice(0, 10)
  let next = raw
  next = upsertFrontmatterField(next, 'lastAccessed', now)
  const current = (raw.match(/\naccessCount:\s*(\d+)/) || [, '0'])[1]
  next = upsertFrontmatterField(next, 'accessCount', String(parseInt(current, 10) + 1))
  if (!/\nstatus:\s*\w+/.test(next)) next = upsertFrontmatterField(next, 'status', 'active')
  await writeFile(path, next, 'utf8')
  ok({ touched: relative(process.cwd(), path), slug, lastAccessed: now, accessCount: parseInt(current, 10) + 1 })
}

async function supersedeAtom(oldSlug, newSlug) {
  if (!oldSlug || !newSlug) fail('usage: supersede <old-atom-slug> <new-atom-slug>')
  const oldPath = join(DIRS.atoms, `${slugify(oldSlug)}.md`)
  const newPath = join(DIRS.atoms, `${slugify(newSlug)}.md`)
  if (!existsSync(oldPath)) fail(`old atom not found: ${oldSlug}`)
  if (!existsSync(newPath)) fail(`new atom not found: ${newSlug}`)
  let raw = await readFile(oldPath, 'utf8')
  raw = upsertFrontmatterField(raw, 'status', 'superseded')
  raw = upsertFrontmatterField(raw, 'supersededBy', slugify(newSlug))
  await writeFile(oldPath, raw, 'utf8')
  await appendWikilink(newPath, slugify(oldSlug))
  ok({ superseded: slugify(oldSlug), by: slugify(newSlug) })
}

async function migrateAtomDecay() {
  await ensureDirs()
  const today = new Date().toISOString().slice(0, 10)
  let migrated = 0
  for (const f of await lsMd(DIRS.atoms)) {
    const path = join(DIRS.atoms, f)
    let raw = await readFile(path, 'utf8')
    let changed = false
    if (!/\nstatus:\s*\w+/.test(raw)) { raw = upsertFrontmatterField(raw, 'status', 'active'); changed = true }
    if (!/\nlastAccessed:/.test(raw)) {
      const created = (raw.match(/\ncreated:\s*([0-9-]+)/) || [, today])[1]
      raw = upsertFrontmatterField(raw, 'lastAccessed', created)
      changed = true
    }
    if (!/\naccessCount:/.test(raw)) { raw = upsertFrontmatterField(raw, 'accessCount', '0'); changed = true }
    if (changed) { await writeFile(path, raw, 'utf8'); migrated++ }
  }
  ok({ migrated, scanned: (await lsMd(DIRS.atoms)).length })
}

function upsertFrontmatterField(raw, key, value) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return raw
  const block = fm[1]
  const re = new RegExp(`(^|\\n)${key}:[^\\n]*`)
  let nextBlock
  if (re.test(block)) {
    nextBlock = block.replace(re, (_, prefix) => `${prefix}${key}: ${value}`)
  } else {
    nextBlock = block + `\n${key}: ${value}`
  }
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${nextBlock}\n---`)
}

// ── helpers ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=')
      flags[k] = v.length === 0 ? true : v.join('=')
    } else positional.push(a)
  }
  return { positional, flags }
}

function splitList(v) {
  if (!v || v === true) return []
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function ensureDirs() {
  for (const d of Object.values(DIRS)) await mkdir(d, { recursive: true })
}

async function lsMd(dir) {
  if (!existsSync(dir)) return []
  return (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
}

async function findBySlug(slug) {
  slug = slugify(slug)
  for (const d of Object.values(DIRS)) {
    const p = join(d, `${slug}.md`)
    if (existsSync(p)) return p
  }
  return null
}

function extractTitle(raw) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    const t = fm[1].match(/\ntitle:\s*(.+)/) || fm[1].match(/^title:\s*(.+)/)
    if (t) return t[1].trim().replace(/^["']|["']$/g, '')
  }
  const h = raw.match(/^#\s+(.+)/m)
  return h ? h[1].trim() : 'untitled'
}

async function appendWikilink(path, slug) {
  const raw = await readFile(path, 'utf8')
  const tag = `[[${slug}]]`
  if (raw.includes(tag)) return
  const hasBacklinks = /\n## Backlinks\n/.test(raw)
  const addition = hasBacklinks ? `- ${tag}\n` : `\n## Backlinks\n- ${tag}\n`
  await writeFile(path, raw + (raw.endsWith('\n') ? '' : '\n') + addition, 'utf8')
}

function buildNote({ type, subtype, title, slug, created, sources = [], links = [], fact, description, aliases = [] }) {
  const fm = ['---', `type: ${type}`]
  if (subtype) fm.push(`subtype: ${subtype}`)
  fm.push(`title: ${JSON.stringify(title)}`, `id: ${slug}`, `created: ${created}`)
  if (aliases.length) fm.push(`aliases: [${aliases.map((a) => JSON.stringify(a)).join(', ')}]`)
  if (sources.length) {
    fm.push('sources:')
    for (const s of sources) fm.push(`  - ${s}`)
  }
  if (links.length) {
    fm.push('links:')
    for (const l of links) fm.push(`  - "[[${l}]]"`)
  }
  if (type === 'atom') {
    fm.push(`status: active`, `lastAccessed: ${created}`, `accessCount: 0`)
  }
  fm.push('---', '')
  const body = []
  body.push(`# ${title}`, '')
  if (type === 'atom' && fact) body.push(fact, '')
  if (type === 'entity' && description) body.push(description, '')
  if (links.length) {
    body.push('## Related', ...links.map((l) => `- [[${l}]]`), '')
  }
  return fm.concat(body).join('\n')
}

function buildMoc({ title, slug, atoms, entities, description }) {
  const lines = [
    '---',
    'type: moc',
    `title: ${JSON.stringify(title)}`,
    `id: ${slug}`,
    `created: ${today()}`,
    '---',
    '',
    `# ${title}`,
    '',
    description || `Map of Content for **${title}** — atoms and entities related to this topic.`,
    '',
  ]
  if (atoms.length) {
    lines.push('## Atoms', ...atoms.map((a) => `- [[atoms/${slugify(a)}]]`), '')
  }
  if (entities.length) {
    lines.push('## Entities', ...entities.map((e) => `- [[entities/${slugify(e)}]]`), '')
  }
  return lines.join('\n')
}

function mergeEntity(existing, { description, aliases }) {
  let out = existing
  if (aliases && aliases.length) {
    const re = /\naliases:\s*\[[^\]]*\]/
    const next = `aliases: [${aliases.map((a) => JSON.stringify(a)).join(', ')}]`
    if (re.test(out)) out = out.replace(re, `\n${next}`)
    else out = out.replace(/\n---\n/, `\n${next}\n---\n`)
  }
  if (description) {
    if (!out.includes(description)) {
      out = out.replace(/\n# [^\n]+\n\n/, (m) => `${m}${description}\n\n`)
    }
  }
  return out
}

function buildSource({ title, slug, url, body, links, moc }) {
  const fm = [
    '---',
    'type: source',
    `title: ${JSON.stringify(title)}`,
    `id: ${slug}`,
    `created: ${today()}`,
    `url: ${JSON.stringify(url)}`,
  ]
  if (moc) fm.push(`moc: ${JSON.stringify(moc)}`)
  if (links.length) {
    fm.push('links:')
    for (const l of links) fm.push(`  - "[[${l}]]"`)
  }
  fm.push('---', '')
  const out = fm.concat([`# ${title}`, '', `> Ingested ${today()} from <${url}>`, ''])
  if (body) {
    out.push('## Summary', '', body.trim(), '')
  }
  if (links.length) {
    out.push('## Related', ...links.map((l) => `- [[${l}]]`), '')
  }
  out.push('## Atoms extracted', '_Add wikilinks to extracted atoms here as you create them (e.g. one bullet per fact)._ ', '')
  return out.join('\n')
}

function buildSynthesis({ title, slug, question, body, links, moc }) {
  const fm = [
    '---',
    'type: synthesis',
    `title: ${JSON.stringify(title)}`,
    `id: ${slug}`,
    `created: ${today()}`,
  ]
  if (question) fm.push(`question: ${JSON.stringify(question)}`)
  if (moc) fm.push(`moc: ${JSON.stringify(moc)}`)
  if (links.length) {
    fm.push('links:')
    for (const l of links) fm.push(`  - "[[${l}]]"`)
  }
  fm.push('---', '')
  const out = fm.concat([`# ${title}`, ''])
  if (question) out.push(`> Question: ${question}`, '')
  if (body) out.push(body.trim(), '')
  if (links.length) out.push('## Related', ...links.map((l) => `- [[${l}]]`), '')
  return out.join('\n')
}

function seedLog() {
  return [
    '# Molecular Memory — Activity Log',
    '',
    '> Append-only chronological record. New entries are added by `cli.mjs ingest`, `synthesis`, `lint --write`, or `log` directly.',
    '> Format: `## [YYYY-MM-DD] <op> | <title>` — parseable with `grep "^## \\["`.',
    '',
    `_Initialized: ${today()}_`,
    '',
  ].join('\n')
}

function seedIndex() {
  return [
    '# Molecular Memory — Index',
    '',
    '> Topic hubs, entities, and atomic facts. Start at a MOC, follow [[wikilinks]] from there.',
    '> Managed by `.claude/skills/molecularmemory_local/cli.mjs`.',
    '',
    `_Initialized: ${today()}_`,
    '',
    '## Maps of Content (0)',
    '',
    '## Entities (0)',
    '',
    '## Atomic notes (0)',
    '',
  ].join('\n')
}

function renderDot(nodes, edges) {
  const lines = ['digraph G {', '  rankdir=LR;', '  node [shape=box,fontsize=10];']
  for (const n of nodes) {
    const color = { atom: 'lightblue', entity: 'lightyellow', moc: 'lightgreen' }[n.kind] || 'white'
    lines.push(`  "${n.slug}" [label="${n.title.replace(/"/g, '\\"')}",fillcolor=${color},style=filled];`)
  }
  for (const e of edges) lines.push(`  "${e.from}" -> "${e.to}"${e.targetExists ? '' : ' [color=red,style=dashed]'};`)
  lines.push('}')
  return lines.join('\n')
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ok(obj) {
  console.log(JSON.stringify({ ok: true, ...obj }))
}
function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }))
  process.exit(1)
}
