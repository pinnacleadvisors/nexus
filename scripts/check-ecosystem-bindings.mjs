#!/usr/bin/env node
/**
 * Static guard: every ecosystem binding resolves to a REGISTERED adapter.
 *
 * The Third-Party Tool Matrix audit found defaults pointing at providers with
 * no adapter (`video:runway`, `voice-agent:vapi`, `doc-parse:docling`, …) — so
 * spawning a team and dispatching that capability returned null. This check
 * makes a dead binding fail CI instead of failing silently at invoke time.
 *
 * It is STATIC (parses files, no TS execution) to match the other check:*
 * scripts and avoid importing the `@/`-aliased, Next-bundled registry.
 *
 * Validates two things:
 *   1. Coverage  — every EcosystemKind has ≥1 registered adapter.
 *   2. Bindings  — every value in DEFAULT_BINDINGS + NICHE_OVERRIDES maps to a
 *                  registered `kind:name`.
 *
 * Run via:
 *   npm run check:ecosystem-bindings
 *   node scripts/check-ecosystem-bindings.mjs --json
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT     = join(import.meta.dirname, '..')
const JSON_OUT = process.argv.includes('--json')

const isTTY = process.stdout.isTTY
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = s => c('32', s)
const red   = s => c('31', s)
const bold  = s => c('1', s)

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// 1. Valid kinds — parse the EcosystemKind union from types.ts.
function parseKinds() {
  const src = read('lib/ecosystems/types.ts')
  const start = src.indexOf('export type EcosystemKind')
  const end = src.indexOf('\n\n', start)
  const block = src.slice(start, end === -1 ? undefined : end)
  return new Set([...block.matchAll(/'([a-z-]+)'/g)].map(m => m[1]))
}

// 2. Registered adapters — for each adapter file imported by registry.ts,
//    extract its (kind, name) literal pair.
function parseRegistered() {
  const reg = read('lib/ecosystems/registry.ts')
  const files = [...reg.matchAll(/from '\.\/adapters\/([a-z0-9-]+)'/g)].map(m => m[1])
  const set = new Set()
  const byKind = {}
  for (const f of files) {
    let src
    try { src = read(`lib/ecosystems/adapters/${f}.ts`) } catch { continue }
    const kind = src.match(/\bkind:\s*'([a-z-]+)'/)?.[1]
    const name = src.match(/\bname:\s*'([a-z0-9-]+)'/)?.[1]
    if (kind && name) {
      set.add(`${kind}:${name}`)
      ;(byKind[kind] ??= []).push(name)
    }
  }
  return { set, byKind }
}

// 3. Bindings — every `kind: 'name'` pair in default-bindings.ts whose key is a
//    valid EcosystemKind (covers DEFAULT_BINDINGS + NICHE_OVERRIDES inner maps).
function parseBindings(validKinds) {
  const src = read('lib/teams/default-bindings.ts')
  const out = []
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/^\s*'?([a-z-]+)'?\s*:\s*'([a-z0-9-]+)'/)
    if (!m) return
    const [, kind, name] = m
    if (validKinds.has(kind)) out.push({ kind, name, line: i + 1 })
  })
  return out
}

const validKinds = parseKinds()
const { set: registered, byKind } = parseRegistered()
const bindings = parseBindings(validKinds)

const findings = []

// Coverage: every kind has an adapter.
for (const kind of validKinds) {
  if (!byKind[kind]?.length) {
    findings.push({ type: 'coverage', kind, hint: `EcosystemKind '${kind}' has no registered adapter` })
  }
}

// Bindings: every binding resolves.
for (const b of bindings) {
  if (!registered.has(`${b.kind}:${b.name}`)) {
    findings.push({
      type: 'binding',
      kind: b.kind,
      name: b.name,
      where: `lib/teams/default-bindings.ts:${b.line}`,
      hint: `binding '${b.kind}:${b.name}' has no registered adapter — build one or repoint the default`,
    })
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ name: 'ecosystem-bindings', findings }, null, 2))
  process.exit(findings.length ? 1 : 0)
}

console.log(`\n🔍  Ecosystem-bindings check`)
console.log(`    ${validKinds.size} kinds · ${registered.size} registered adapters · ${bindings.length} bindings\n`)

if (findings.length === 0) {
  console.log(green('  PASS  every kind has an adapter and every binding resolves'))
  console.log(green('\n✅  Ecosystem-bindings check passed.\n'))
  process.exit(0)
}

for (const f of findings) {
  const loc = f.where ? ` (${f.where})` : ''
  console.log(red(`  FAIL  ${f.hint}${loc}`))
}
console.log(red(`\n❌  ${findings.length} ecosystem-binding finding(s).`))
console.log(`    Fix: add an adapter in lib/ecosystems/adapters/ + register it, or repoint the binding.\n`)
process.exit(1)
