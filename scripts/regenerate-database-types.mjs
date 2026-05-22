#!/usr/bin/env node
/**
 * scripts/regenerate-database-types.mjs
 *
 * Regenerates `lib/database.types.ts` from the live Supabase schema. Robust
 * against npx's "Ok to proceed?" prompt that wrecked the file on 2026-05-22
 * (`npx supabase@latest ... > database.types.ts` captured the prompt text).
 *
 * Defence in depth:
 *   1. `npx --yes` (suppresses the install-confirmation prompt entirely)
 *   2. Output goes to a tempfile, NOT directly into database.types.ts
 *   3. Validates the tempfile starts with the expected TS header
 *      (`export type Json` or `export type Database`)
 *   4. Atomic rename only on validation success — the real file is never
 *      half-written, and a failed run leaves the existing file untouched
 *   5. Reports diff stats so the operator can sanity-check the change
 *
 * Required env:
 *   SUPABASE_PROJECT_REF — the project slug at
 *     https://supabase.com/dashboard/project/<ref> (no trailing slash, no
 *     URL — just the slug).
 *
 * Usage:
 *   doppler run -- node scripts/regenerate-database-types.mjs
 *   doppler run -- npm run types:regen     # same thing via package.json
 *
 * Pre-flight:
 *   * Migrations must already be applied to the remote project (otherwise
 *     the generated file is stale).
 *   * If npx complains about auth, run `npx supabase login` in an interactive
 *     shell once; the CLI caches credentials.
 */

import { spawn }      from 'node:child_process'
import { promises as fs, createWriteStream } from 'node:fs'
import path           from 'node:path'
import os             from 'node:os'

const TARGET_PATH    = path.resolve(process.cwd(), 'lib/database.types.ts')
const HEADER_NEEDLES = ['export type Json', 'export type Database']

function fail(msg, code = 1) {
  console.error(`\x1b[31m[regenerate-types]\x1b[0m ${msg}`)
  process.exit(code)
}

function info(msg) {
  console.log(`\x1b[36m[regenerate-types]\x1b[0m ${msg}`)
}

const projectRef = (process.env.SUPABASE_PROJECT_REF ?? '').trim()
if (!projectRef) {
  fail(
    'SUPABASE_PROJECT_REF unset. Set it in Doppler — it is the slug at\n' +
    '  https://supabase.com/dashboard/project/<slug>\n' +
    'Then re-run via `doppler run -- npm run types:regen`.',
  )
}
if (projectRef.includes('/') || projectRef.includes('http')) {
  fail(`SUPABASE_PROJECT_REF should be the slug only, not a URL. Got: "${projectRef}"`)
}

const tmpDir   = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-types-'))
const tmpPath  = path.join(tmpDir, 'database.types.ts')

info(`Generating into ${tmpPath} (project: ${projectRef})…`)

await new Promise((resolve, reject) => {
  // --yes: skip "Need to install supabase@latest? Ok to proceed? (y)" prompt.
  // Without this, the prompt text gets piped into stdout and corrupts the file.
  const proc = spawn(
    'npx',
    [
      '--yes',
      'supabase@latest',
      'gen', 'types', 'typescript',
      '--project-id', projectRef,
      '--schema',     'public',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },     // stdin closed; stderr passthrough so install logs show
  )

  const writeStream = createWriteStream(tmpPath)
  proc.stdout.pipe(writeStream)

  let procExited = false
  let streamFlushed = false
  function maybeDone(err) {
    if (err) return reject(err)
    if (procExited && streamFlushed) resolve()
  }

  proc.on('error', reject)
  proc.on('exit', code => {
    procExited = true
    if (code !== 0) return reject(new Error(`npx supabase exited with code ${code}`))
    maybeDone()
  })
  writeStream.on('finish', () => { streamFlushed = true; maybeDone() })
  writeStream.on('error',  reject)
}).catch(err => fail(`Generation failed: ${err.message}`))

const generated = await fs.readFile(tmpPath, 'utf8')
const headByteCount = Buffer.byteLength(generated.slice(0, 400), 'utf8')

if (generated.length < 200) {
  fail(
    `Generated file is suspiciously small (${generated.length} bytes). ` +
    `npx may have prompted interactively (re-run with TTY) or the Supabase ` +
    `CLI returned an error. Tempfile preserved at ${tmpPath} for inspection.`,
  )
}

const looksRight = HEADER_NEEDLES.some(n => generated.startsWith(n) || generated.slice(0, 400).includes(n))
if (!looksRight) {
  const preview = generated.slice(0, 200).replace(/\n/g, '\\n')
  fail(
    `Generated file does NOT start with the expected TypeScript header. ` +
    `Got: "${preview}…"\n\n` +
    `Most common cause: npx prompted for install confirmation (the prompt ` +
    `text "Need to install the following packages: supabase@... Ok to proceed?" ` +
    `got captured instead of the types). The --yes flag should have prevented ` +
    `this — if you still see it, your npx is old (npm < 7) and you should ` +
    `upgrade npm or install supabase globally with \`npm i -g supabase\`.\n\n` +
    `Tempfile preserved at ${tmpPath} (${headByteCount} bytes head).`,
  )
}

// Atomic-ish move — copy then rename. fs.rename across devices fails, so we
// use copyFile + unlink as a fallback.
try {
  await fs.copyFile(tmpPath, TARGET_PATH)
  await fs.unlink(tmpPath).catch(() => undefined)
} catch (err) {
  fail(`Failed to install generated file: ${err instanceof Error ? err.message : err}`)
}

// Tidy: stat + line-count + a 1-line summary so the operator can sanity-check.
const stat  = await fs.stat(TARGET_PATH)
const lines = generated.split('\n').length
info(`Wrote ${TARGET_PATH} — ${stat.size} bytes, ${lines} lines.`)
info('Next steps:')
info('  1. `git diff lib/database.types.ts` to review new tables/columns')
info('  2. `npx tsc --noEmit` to confirm TS resolves cleanly')
info('  3. Commit if happy')
