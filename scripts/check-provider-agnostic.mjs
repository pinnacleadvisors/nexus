#!/usr/bin/env node
/**
 * Static-pattern audit: hooks and skills must remain LLM-provider-agnostic.
 *
 * Absorbed from Life-Harness (arxiv 2605.22166) — their headline result is
 * that a harness evolved on Qwen3-4B transferred to 17 other models with
 * 88.5% avg improvement. The property we want: when `LLM_PROVIDER` flips
 * from Claude to Mimo or Ollama, every `.claude/skills/*` + `.claude/agents/*`
 * keeps working without edits.
 *
 * The check: scan agent specs + skill SKILL.md files for hard-coded model
 * identifiers OUTSIDE the explicit `model:` frontmatter field. The agent
 * frontmatter is allowed to pin a model (per-agent preference) — but the
 * prose body, tool budgets, sample commands, etc. must not.
 *
 * Run via:
 *   npm run check:provider-agnostic
 *   node scripts/check-provider-agnostic.mjs
 *   node scripts/check-provider-agnostic.mjs --json
 *
 * Bypass a specific line: trailing `provider-agnostic-check: ignore` comment
 *   (or `<!-- provider-agnostic-check: ignore -->` in Markdown).
 *
 * To add a new banned model identifier:
 *   1. Add a pattern to BANNED below.
 *   2. Run the check; fix or `ignore`-comment remaining references.
 *
 * Cheap (~50ms). Wires into the pre-commit checklist alongside
 * check:topology and check:retry-storm.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT     = join(import.meta.dirname, '..')
const JSON_OUT = process.argv.includes('--json')

/**
 * Each entry is a model identifier that's allowed in a `model: <X>` YAML line
 * (agent frontmatter pins this) and nowhere else in the prose. The patterns
 * are intentionally specific — `claude` alone would match every mention of
 * "Claude Code" and produce noise.
 */
const BANNED = [
  {
    name:    'Claude Sonnet 4.6 (specific version pin)',
    pattern: /\bclaude-sonnet-4-6\b/,
  },
  {
    name:    'Claude Opus 4.7 (specific version pin)',
    pattern: /\bclaude-opus-4-7\b/,
  },
  {
    name:    'Claude Haiku 4 (specific version pin)',
    pattern: /\bclaude-haiku-4\b/,
  },
  {
    name:    'GPT-5.5 (specific OpenAI version pin)',
    // Negative lookahead excludes `gpt-5.5-codex` — that's a documented
    // routing alias in lib/llm/provider.ts (maps to the codex-gateway),
    // not a model-version pin. Bare `gpt-5.5` references still flag.
    pattern: /\bgpt-5\.5(?!-codex)\b/,
  },
  {
    name:    'Gemini 2.5 / 2.6 (specific Google version pin)',
    pattern: /\bgemini-2\.[56]\b/,
  },
  {
    name:    'Qwen3 (specific version pin)',
    pattern: /\bqwen3-[\d.]+\b/,
  },
]

/**
 * Files where the check runs. Anchor on `.claude/agents/*.md` + every SKILL.md
 * under `.claude/skills/`. Repo-wide scanning would produce too much noise
 * (test fixtures, ADRs explicitly comparing models, etc.).
 */
const SCAN_GLOBS = [
  { dir: '.claude/agents',  pattern: /\.md$/  },
  { dir: '.claude/skills',  pattern: /SKILL\.md$/, recursive: true },
]

const IGNORE_MARKER = /provider-agnostic-check:\s*ignore/

function walkDir(dir, pattern, recursive) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const stat = statSync(p)
    if (stat.isDirectory()) {
      if (recursive) out.push(...walkDir(p, pattern, recursive))
    } else if (pattern.test(entry)) {
      out.push(p)
    }
  }
  return out
}

function lineIsFrontmatterModelField(line) {
  // Allow `model: <anything>` (per-agent pin) and `models: [...]`.
  return /^\s*models?:\s*/.test(line)
}

function inFrontmatter(lineIdx, frontmatterEnd) {
  return frontmatterEnd >= 0 && lineIdx < frontmatterEnd
}

function findFrontmatterEnd(lines) {
  if (lines[0] !== '---') return -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i
  }
  return -1
}

function scanFile(file) {
  const findings = []
  const text  = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const fmEnd = findFrontmatterEnd(lines)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (IGNORE_MARKER.test(line)) continue
    // Frontmatter `model:` lines are an explicit pin — allowed.
    if (inFrontmatter(i, fmEnd) && lineIsFrontmatterModelField(line)) continue

    for (const banned of BANNED) {
      if (banned.pattern.test(line)) {
        findings.push({
          file:    relative(ROOT, file),
          line_no: i + 1,
          line:    line.trim(),
          banned:  banned.name,
        })
      }
    }
  }
  return findings
}

function main() {
  const files = []
  for (const glob of SCAN_GLOBS) {
    const dir = join(ROOT, glob.dir)
    files.push(...walkDir(dir, glob.pattern, glob.recursive ?? false))
  }

  const findings = files.flatMap(scanFile)

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2))
    process.exit(findings.length === 0 ? 0 : 1)
  }

  if (findings.length === 0) {
    console.log(`  PASS  provider-agnostic-hooks-and-skills  (0 findings, ${files.length} files scanned)\n`)
    console.log('✅  All provider-agnostic checks passed.')
    console.log(`   ${BANNED.length} banned identifiers tracked. To add: edit BANNED in scripts/check-provider-agnostic.mjs.`)
    process.exit(0)
  }

  console.log(`❌  ${findings.length} provider-agnostic violation(s):\n`)
  for (const f of findings) {
    console.log(`   ${f.file}:${f.line_no}`)
    console.log(`     ${f.banned}`)
    console.log(`     > ${f.line}`)
    console.log('')
  }
  console.log(`Fix options:`)
  console.log(`  1. Reference via 'lib/llm/provider.ts' getLlm() instead of pinning the model name.`)
  console.log(`  2. If the pin is intentional + documented, add a trailing comment:`)
  console.log(`       <!-- provider-agnostic-check: ignore -->   (Markdown)`)
  console.log(`       // provider-agnostic-check: ignore         (TS/JS)`)
  process.exit(1)
}

main()
