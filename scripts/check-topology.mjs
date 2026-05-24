#!/usr/bin/env node
/**
 * Static-pattern audit for retired-infrastructure references.
 *
 * The 2026-05-24 platform-state cleanup (PR #300) had to retroactively
 * remove KVM2 / Hostinger-n8n / ChatProviderToggle references that
 * lingered weeks after the underlying infrastructure was decommissioned.
 * Root cause: no mechanical check flagged "this doc references infra
 * that no longer exists". This script is that check.
 *
 * Run via:
 *   npm run check:topology
 *   node scripts/check-topology.mjs
 *   node scripts/check-topology.mjs --strict     # exit 1 on findings (default also exits 1)
 *   node scripts/check-topology.mjs --json       # machine-readable output
 *
 * Designed to be cheap (~100ms), idempotent, side-effect-free. Wires into
 * `npm run check:all` alongside check:retry-storm + check:sentry-config.
 *
 * To retire a new piece of infra:
 *   1. Add an entry to RETIRED below
 *   2. Add files where it's OK to mention in past tense to the entry's allowlist
 *   3. Run the check; fix or allowlist remaining references
 *   4. Commit the new entry alongside the retirement PR
 *
 * To bypass a specific line (rare — prefer adding the file to allowlist):
 *   add a trailing comment `// topology-check: ignore` (or `<!-- topology-check: ignore -->` for Markdown)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT   = join(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')
const JSON_OUT = process.argv.includes('--json')

/**
 * Each retired-infra entry. `pattern` is a RegExp matched against each line.
 * `allowlist` is an array of EXACT repo-relative paths (or directory prefixes
 * ending in `/`) where the term may be referenced — typically migration
 * runbooks, ADRs, task plans, and the agent-spec "Topology update" sections
 * that intentionally mention the retired term in past tense.
 */
const RETIRED = [
  {
    name:         'KVM2 (Hostinger codex-gateway host)',
    pattern:      /\b(KVM2|kvm2|COOLIFY_KVM2_)\b/,
    retired_at:   '2026-05-22',
    replacement:  'KVM4',
    rationale:    'Lean-mode pivot (ADR 006). codex-gateway migrated to KVM4 via scripts/migrate-to-lean-kvm.mjs; KVM2 VPS decommissioned.',
    allowlist: [
      'CHANGELOG.md',
      'AGENTS.md',                                              // topology section explains it in past tense
      'docs/adr/',                                              // every ADR is historical
      'docs/runbooks/migrate-to-lean-kvm.md',
      'docs/runbooks/n8n-kvm1-to-coolify.md',
      'docs/runbooks/lean-mode.md',
      'docs/runbooks/operator-commands.md',                     // historical commands section
      'docs/runbooks/coolify-mcp.md',
      'docs/runbooks/codex-gateway-auth-rotation.md',
      'docs/runbooks/codex-playwright-smoke-tests.md',
      'docs/runbooks/pilot-rollout-walkthrough.md',
      'docs/runbooks/chat-phases-rollout.md',                   // historical phase-2c rollout runbook (pre-migration)
      'memory/platform/STACK.md',
      'memory/platform/SECRETS.md',
      'task_plan-lean-mode.md',
      'task_plan-solopreneur-experiment.md',
      '.claude/agents/codex-operator.md',
      '.claude/agents/codex-maintainer.md',
      '.claude/agents/platform-copilot.md',
      '.claude/agents/n8n-strategist.md',
      'scripts/migrate-to-lean-kvm.mjs',
      'scripts/migrate-tunnel-hostname.mjs',                    // documents the KVM2→KVM4 hostname-migration use case
      'scripts/repair-codex-gateway-routing.mjs',               // repairs stale KVM2 tunnel routing post-migration
      'scripts/deploy.sh',                                      // intentional KVM2-legacy-fallback path
      'services/mcp-codex-delegate/',                           // header doc + tool description quotes ADR 002 phrasing
      'scripts/check-topology.mjs',                             // this file
    ],
  },
  {
    name:         'KVM1 (Hostinger n8n VPS)',
    pattern:      /\bKVM1\b/,
    retired_at:   '2026-05-22',
    replacement:  'KVM4 (n8n migrated to Coolify on KVM4)',
    rationale:    'Hostinger KVM1 VPS expired; n8n migrated to KVM4 via docs/runbooks/n8n-kvm1-to-coolify.md.',
    allowlist: [
      'CHANGELOG.md',
      'AGENTS.md',
      'docs/adr/',
      'docs/runbooks/n8n-kvm1-to-coolify.md',
      'docs/runbooks/migrate-to-lean-kvm.md',
      'docs/runbooks/lean-mode.md',
      'docs/runbooks/operator-commands.md',
      'task_plan-lean-mode.md',
      '.claude/agents/n8n-strategist.md',
      'scripts/migrate-to-lean-kvm.mjs',
      'services/n8n/docker-compose.yaml',                       // KVM1 mentions are migration-evidence comments (encryption-key origin)
      'scripts/cloudflare-tunnel-add-hostname.mjs',             // sets a CF DNS comment "n8n migration from KVM1 <date>"
      'scripts/check-topology.mjs',
    ],
  },
  {
    name:         'ChatProviderToggle (legacy claude/codex pill)',
    pattern:      /\bChatProviderToggle\b|readChatProvider/,
    retired_at:   '2026-05-24',
    replacement:  'getModelById(chatModel).provider — see components/platform-chat/ModelSelector.tsx + lib/chat/models.ts',
    rationale:    'Subsumed by the model dropdown — picking "Codex 5.5" routes via codex-direct, any Claude model via claude-gateway. The pill component file remains for backwards compat but no UI surface renders it.',
    allowlist: [
      'CHANGELOG.md',
      'AGENTS.md',
      'components/chat/ChatProviderToggle.tsx',                 // the deprecated component itself
      'components/platform-chat/ModelSelector.tsx',             // comment that references the subsumed component
      'components/platform-chat/TurnTimeoutSelector.tsx',       // same
      'components/platform-chat/PlatformChat.tsx',              // provenance comment explaining why provider derives from model
      'components/business-chat/BusinessChat.tsx',              // same
      'memory/platform/STACK.md',
      'task_plan-collaborative-chat.md',
      'task_plan-model-agnostic-chat.md',
      '.claude/agents/platform-copilot.md',
      'docs/runbooks/operator-commands.md',                     // documents the check itself
      'scripts/check-topology.mjs',
    ],
  },
]

// Files / directories we never walk. node_modules + .next + dist + .git are
// the heavy ones; .claude/worktrees skips recursive worktree clones; the
// `coverage` / `playwright-report` dirs are CI byproducts.
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'coverage',
  'playwright-report', 'test-results', '.cache',
])

// Repo-wide skip pattern — anything inside `.claude/worktrees/` is a nested
// checkout that has its own state.
function shouldSkipPath(absPath) {
  const rel = relative(ROOT, absPath)
  return rel.startsWith('.claude' + sep + 'worktrees' + sep)
}

// Only check text-shaped files. Images / binaries are pointless and slow.
const TEXT_RE = /\.(md|mdx|ts|tsx|mts|cts|js|mjs|cjs|jsx|json|yaml|yml|sh|toml)$/

function listFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    if (shouldSkipPath(cur)) continue
    let entries
    try { entries = readdirSync(cur) } catch { continue }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(cur, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (TEXT_RE.test(name)) out.push(full)
    }
  }
  return out
}

function rel(file) { return relative(ROOT, file).split(sep).join('/') }

function isAllowed(filePath, allowlist) {
  const relPath = rel(filePath)
  for (const entry of allowlist) {
    if (entry.endsWith('/')) {
      if (relPath.startsWith(entry)) return true
    } else {
      if (relPath === entry) return true
    }
  }
  return false
}

// Inline-ignore — line carries `topology-check: ignore` (HTML or //).
const INLINE_IGNORE_RE = /topology-check:\s*ignore/

function checkRetiredInfra(entry) {
  const findings = []
  for (const file of listFiles(ROOT)) {
    if (isAllowed(file, entry.allowlist)) continue
    let lines
    try { lines = readFileSync(file, 'utf8').split('\n') }
    catch { continue }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!entry.pattern.test(line)) continue
      if (INLINE_IGNORE_RE.test(line)) continue
      findings.push({
        file:    rel(file),
        line:    i + 1,
        snippet: line.trim().slice(0, 160),
        hint:    `${entry.name} retired ${entry.retired_at}. Replace with: ${entry.replacement}. Reason: ${entry.rationale}`,
      })
    }
  }
  return { name: `no-references-to-retired:${entry.name}`, findings, entry }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function color(code, s) { return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s }
const red    = s => color('31', s)
const green  = s => color('32', s)
const yellow = s => color('33', s)
const dim    = s => color('2',  s)
const bold   = s => color('1',  s)

const results = RETIRED.map(checkRetiredInfra)

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: results.every(r => r.findings.length === 0), results }, null, 2))
  process.exit(results.some(r => r.findings.length > 0) ? 1 : 0)
}

console.log(`\n🔍  Topology static check\n    Repo: ${ROOT}\n`)

let total = 0
for (const r of results) {
  const passed = r.findings.length === 0
  const label  = passed ? green('PASS') : red('FAIL')
  console.log(`  ${label}  ${r.name}  ${dim(`(${r.findings.length} finding${r.findings.length === 1 ? '' : 's'})`)}`)
  for (const f of r.findings.slice(0, 10)) {
    console.log(`         ${yellow(f.file + ':' + f.line)}  ${dim(f.snippet)}`)
    console.log(`             ${dim('→ ' + f.hint)}`)
  }
  if (r.findings.length > 10) {
    console.log(`         ${dim(`(+${r.findings.length - 10} more — open file to see all)`)}`)
  }
  total += r.findings.length
}

console.log()
if (total === 0) {
  console.log(green(bold('✅  All topology checks passed.')))
  console.log(dim(`   ${RETIRED.length} retired item${RETIRED.length === 1 ? '' : 's'} tracked. To retire new infra, add an entry to scripts/check-topology.mjs.\n`))
  process.exit(0)
} else {
  console.log(red(bold(`❌  ${total} topology finding${total === 1 ? '' : 's'}.`)))
  console.log(dim('   Either update the reference, add the file to the entry\'s allowlist (if it\'s intentionally historical), or add `topology-check: ignore` to the line.\n'))
  process.exit(STRICT ? 1 : 1)
}
