/**
 * Unit test for lib/agents/inject-platform-brief.ts.
 *
 * Covers:
 *   - Budget enforcement (assembled brief stays under maxBytes)
 *   - Fail-soft: missing files don't throw, surface as warnings
 *   - Plan matcher finds the most-relevant task_plan-*.md by keyword overlap
 *   - HTTP atoms section is skipped cleanly when memoryQueryUrl is unset
 *   - Empty `task` returns a brief without a matched plan (no crash)
 *   - Token estimate is in a sane range (< 5000 for the default budget)
 *
 * Run with: `npx --yes tsx __tests__/inject-platform-brief.test.ts`
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildPlatformBrief } from '../lib/agents/inject-platform-brief'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

async function withTempRepo(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inject-platform-brief-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content)
    }
    await fn(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  // 1. Happy path — all memory files present, single matching task_plan.
  await withTempRepo({
    'memory/INDEX.md':              '# Index\n- topic map',
    'memory/platform/STACK.md':     '# Stack\n- Next.js 16',
    'memory/roadmap/SUMMARY.md':    '# Roadmap\n- Phase 22',
    'task_plan-openrouter.md':      '# OpenRouter plan\n\nGoal: add openrouter provider\n',
    'task_plan-unrelated.md':       '# Other plan\n\nGoal: refactor billing\n',
  }, async (root) => {
    const result = await buildPlatformBrief({
      task:      'wire OpenRouter provider into the LLM dispatcher',
      agentSlug: 'test-agent',
      repoRoot:  root,
    })

    assert(result.brief.length > 0, 'brief should be non-empty when sources load')
    assert(result.sources.includes('memory/INDEX.md'), 'should load memory/INDEX.md')
    assert(result.sources.includes('memory/platform/STACK.md'), 'should load STACK.md')
    assert(result.sources.includes('memory/roadmap/SUMMARY.md'), 'should load roadmap')
    assert(
      result.sources.includes('task_plan-openrouter.md'),
      `should match openrouter plan, got sources: ${JSON.stringify(result.sources)}`,
    )
    assert(
      !result.sources.includes('task_plan-unrelated.md'),
      'should not include unrelated plan',
    )
    assert(result.brief.includes('test-agent'), 'footer should mention agent slug')
    assert(result.warnings.length === 0, `expected no warnings, got: ${result.warnings.join('; ')}`)
  })

  // 2. Budget enforcement — tiny budget skips lower-priority sections.
  await withTempRepo({
    'memory/INDEX.md':           '# Index\n' + 'x'.repeat(500),
    'memory/platform/STACK.md':  '# Stack\n' + 'y'.repeat(500),
    'memory/roadmap/SUMMARY.md': '# Roadmap\n' + 'z'.repeat(500),
  }, async (root) => {
    const result = await buildPlatformBrief({
      task:      'something',
      agentSlug: 'test-agent',
      repoRoot:  root,
      maxBytes:  900,  // smaller than the combined sources
    })
    // Brief should still emit header + INDEX.md (or fewer), and warn about
    // the skipped sections.
    assert(result.brief.length <= 900 + 500, 'brief should respect maxBytes (approximately)')
    assert(result.warnings.length > 0, 'should warn when sections skipped for budget')
  })

  // 3. Missing files — fail-soft, warnings recorded, dispatch still proceeds.
  await withTempRepo({}, async (root) => {
    const result = await buildPlatformBrief({
      task:      'something',
      agentSlug: 'test-agent',
      repoRoot:  root,
    })
    // No files → sources empty → brief returns ''
    assert(result.brief === '', 'empty brief when no sources load')
    assert(result.warnings.length >= 3, `expected ≥3 warnings (one per missing file), got: ${result.warnings.length}`)
    assert(
      result.warnings.some(w => w.includes('memory/INDEX.md')),
      'should warn about missing INDEX',
    )
  })

  // 4. Empty task — no plan match, but other sources still load.
  await withTempRepo({
    'memory/INDEX.md':         '# Index',
    'task_plan-something.md':  '# A plan',
  }, async (root) => {
    const result = await buildPlatformBrief({
      task:      '',
      agentSlug: 'test-agent',
      repoRoot:  root,
    })
    assert(result.sources.includes('memory/INDEX.md'), 'should still load INDEX for empty task')
    assert(
      !result.sources.includes('task_plan-something.md'),
      'should not match any plan with empty keywords',
    )
  })

  // 5. HTTP atoms — when memoryQueryUrl is unset, no HTTP probe, no failure.
  await withTempRepo({
    'memory/INDEX.md': '# Index',
  }, async (root) => {
    const result = await buildPlatformBrief({
      task:      'feature shipper',
      agentSlug: 'test-agent',
      repoRoot:  root,
      // memoryQueryUrl intentionally unset
    })
    assert(
      !result.sources.some(s => s.startsWith('memory-hq')),
      'no memory-hq section without memoryQueryUrl',
    )
  })

  // 6. Token estimate sane — for a normal brief, under the default 5k budget.
  await withTempRepo({
    'memory/INDEX.md':           '# Index\n' + 'a'.repeat(1000),
    'memory/platform/STACK.md':  '# Stack\n' + 'b'.repeat(1000),
    'memory/roadmap/SUMMARY.md': '# Roadmap\n' + 'c'.repeat(1000),
  }, async (root) => {
    const result = await buildPlatformBrief({
      task:      'test',
      agentSlug: 'test-agent',
      repoRoot:  root,
    })
    assert(
      result.estimatedTokens < 5_000,
      `default brief estimate should fit under 5k tokens, got ${result.estimatedTokens}`,
    )
    assert(
      result.estimatedTokens > 0,
      'token estimate should be positive when sources loaded',
    )
  })

  // 7. Real-repo smoke — use the actual repo's memory/ files. Caps budget so
  // this exercises the truncation path on the real content too.
  const realResult = await buildPlatformBrief({
    task:      'inject platform brief into managed agent dispatch',
    agentSlug: 'test-agent',
    repoRoot:  path.resolve(__dirname, '..'),
    maxBytes:  20_000,
  })
  assert(
    realResult.estimatedTokens < 5_500,
    `real-repo brief should fit budget, got ${realResult.estimatedTokens} tokens`,
  )
  assert(
    realResult.sources.length > 0,
    'real-repo brief should load at least one section',
  )

  console.log('OK — inject-platform-brief tests pass')
}

main().catch(err => {
  console.error('test crashed:', err)
  process.exit(1)
})
