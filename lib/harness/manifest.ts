/**
 * lib/harness/manifest.ts — the HARNESS.md artifact writer/reader.
 *
 * A mode=synthesize Loop (loop-runner, E3) crystallizes its winning strategy
 * into `.claude/sub-harnesses/<slug>/HARNESS.md` — a human-readable artifact
 * (frontmatter + execution steps + test evidence + an Error Remediation log,
 * mirroring skill-trainer's SKILL.md shape, but COMPOSITE). The structured
 * manifest is ALSO embedded as a lossless fenced ```json block so the bundle
 * round-trips without a YAML dependency. The sub_harnesses.manifest jsonb
 * column (migration 097) remains the runtime source of truth; HARNESS.md is
 * the auditable artifact + the human review surface.
 *
 * Borrows Pi.dev's 4-core-tool minimalism: keep the bundle SMALL + auditable.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  emptyManifest, isHarnessSlug,
  type SubHarnessManifest, type SubHarnessStatus, type HarnessReviewModality,
} from './types'

export const HARNESSES_ROOT = path.join(process.cwd(), '.claude', 'sub-harnesses')

/** Validated dir for a harness slug. Throws on an unsafe slug (path-injection guard). */
export function harnessDir(slug: string): string {
  const raw = slug
  if (!isHarnessSlug(slug)) throw new Error(`unsafe harness slug: ${raw.slice(0, 40)}`)
  return path.join(HARNESSES_ROOT, slug)
}
export function harnessFilePath(slug: string): string {
  return path.join(harnessDir(slug), 'HARNESS.md')
}

export interface HarnessDoc {
  slug:              string
  goal:              string
  manifest:          SubHarnessManifest
  status:            SubHarnessStatus
  reviewModality?:   HarnessReviewModality
  /** Markdown body — the winning strategy's exact execution steps. */
  executionSteps:    string
  /** Markdown — what failed during exploration + how it was fixed (Hermes-style). */
  errorRemediation?: string
  trainedBy?:        string
  createdAt?:        string
}

const MANIFEST_FENCE_RE = /```json manifest\s*\n([\s\S]*?)\n```/

function yamlScalar(v: string): string {
  // Quote + escape for a YAML double-quoted scalar.
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

/** Serialize a HarnessDoc to the full HARNESS.md string. */
export function serializeHarnessMd(doc: HarnessDoc): string {
  const m = doc.manifest ?? emptyManifest()
  const fm = [
    '---',
    `slug: ${doc.slug}`,
    `goal: ${yamlScalar(doc.goal || '')}`,
    `status: ${doc.status}`,
    `review_modality: ${doc.reviewModality ?? (m.review_spec?.modality ?? 'code')}`,
    `skills: [${m.skills.join(', ')}]`,
    `agent_refs: [${m.agent_refs.join(', ')}]`,
    `tools: [${m.tools.join(', ')}]`,
    `trained_by: ${doc.trainedBy ?? 'loop-runner'}`,
    `created_at: ${doc.createdAt ?? ''}`,
    '---',
  ].join('\n')

  const testLines = m.tests.length
    ? m.tests.map(t => `- [${t.passed ? 'x' : ' '}] **${t.name}**${t.assert ? ` — ${t.assert}` : ''}${t.command ? `\n  \`${t.command}\`` : ''}`).join('\n')
    : '_(no tests recorded)_'

  const review = m.review_spec
    ? `Reviewed under the **${m.review_spec.modality}** modality against:\n${m.review_spec.criteria.map(c => `- ${c}`).join('\n')}`
    : '_(no review spec)_'

  return [
    fm,
    '',
    `# Sub-harness: ${doc.slug}`,
    '',
    '## Goal',
    doc.goal || '_(none)_',
    '',
    '## Execution Steps',
    doc.executionSteps?.trim() || '_(none recorded)_',
    '',
    '## Tests (evidence)',
    'Explorer-authored tests + their pass evidence from the nexus-sandbox. The',
    'verifier requires these to pass BEFORE it reviews (TDD-evidence-before-review).',
    '',
    testLines,
    '',
    '## Review',
    review,
    '',
    '## Error Remediation',
    'Log of what failed during exploration + how it was fixed (for future debugging).',
    '',
    doc.errorRemediation?.trim() || '_(none)_',
    '',
    '## Manifest (lossless)',
    'Canonical bundle — the runtime source of truth is the `sub_harnesses.manifest`',
    'jsonb column; this block mirrors it for offline round-trip.',
    '',
    '```json manifest',
    JSON.stringify(m, null, 2),
    '```',
    '',
  ].join('\n')
}

export interface ParsedHarness {
  frontmatter: Record<string, string>
  manifest:    SubHarnessManifest | null
  status:      SubHarnessStatus | null
}

/** Parse a HARNESS.md string. Frontmatter scalars + the lossless manifest block. */
export function parseHarnessMd(md: string): ParsedHarness {
  const frontmatter: Record<string, string> = {}
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/)
      if (kv) frontmatter[kv[1]] = kv[2].trim().replace(/^"|"$/g, '')
    }
  }
  let manifest: SubHarnessManifest | null = null
  const mf = md.match(MANIFEST_FENCE_RE)
  if (mf) {
    try { manifest = JSON.parse(mf[1]) as SubHarnessManifest } catch { manifest = null }
  }
  const status = (frontmatter.status === 'draft' || frontmatter.status === 'verified' || frontmatter.status === 'failed')
    ? frontmatter.status : null
  return { frontmatter, manifest, status }
}

/** Write HARNESS.md to disk (creates the slug dir). Returns the path written. */
export async function writeHarnessMd(doc: HarnessDoc): Promise<string> {
  const dir = harnessDir(doc.slug)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'HARNESS.md')
  await fs.writeFile(file, serializeHarnessMd(doc), 'utf8')
  return file
}
