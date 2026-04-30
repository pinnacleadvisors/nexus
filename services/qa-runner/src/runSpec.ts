/**
 * Spec runner — spawns `npx playwright test` against a base URL with the
 * supplied bot session ticket URL, captures the JSON report, and returns a
 * structured pass/fail summary the orchestrator can dispatch on.
 *
 * Single worker, headless, no retries — the orchestrator is responsible for
 * deciding what to do on failure (dispatch a fix-attempt or just notify).
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface RunSpecOpts {
  baseUrl:        string
  ticketUrl:      string
  /** Absolute path to the qa-runner working dir (where playwright.config.ts lives). */
  cwd:            string
  /** Override the spec glob — defaults to all e2e specs. */
  testGlob?:      string
  timeoutMs?:     number
}

export interface FailedTest {
  title:        string
  file:         string
  errorMessage: string
  attachments:  string[]    // paths to screenshot / trace / video
}

export interface RunSpecResult {
  ok:        boolean
  passed:    number
  failed:    number
  durationMs: number
  failures:  FailedTest[]
  /** Raw stdout from playwright — tail this in the dispatch brief if needed. */
  stdoutTail: string
  exitCode:  number
}

const REPORT_PATH = 'dist/playwright-report.json'

export async function runSpec(opts: RunSpecOpts): Promise<RunSpecResult> {
  const started = Date.now()
  const args = ['playwright', 'test', '--workers=1', '--reporter=json,list']
  if (opts.testGlob) args.push(opts.testGlob)

  const env = {
    ...process.env,
    BASE_URL:                opts.baseUrl,
    BOT_SESSION_TICKET_URL:  opts.ticketUrl,
    PLAYWRIGHT_HTML_REPORT:  'dist/html-report',
  }

  let stdout = ''
  let stderr = ''

  const child = spawn('npx', args, {
    cwd:   opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('playwright_timeout'))
    }, opts.timeoutMs ?? 5 * 60 * 1000)

    child.on('exit', code => {
      clearTimeout(timeout)
      resolve(code ?? -1)
    })
    child.on('error', err => {
      clearTimeout(timeout)
      reject(err)
    })
  }).catch(err => {
    return -1
  })

  const failures = await parseFailures(path.join(opts.cwd, REPORT_PATH))
  const tail     = (stdout + stderr).split('\n').slice(-80).join('\n')

  return {
    ok:         exitCode === 0,
    passed:     failures.passed,
    failed:     failures.failed.length,
    durationMs: Date.now() - started,
    failures:   failures.failed,
    stdoutTail: tail.slice(0, 8_000),
    exitCode,
  }
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[]
}
interface PlaywrightSuite {
  title?:  string
  file?:   string
  suites?: PlaywrightSuite[]
  specs?:  PlaywrightSpec[]
}
interface PlaywrightSpec {
  title:    string
  tests?:   PlaywrightTest[]
  file?:    string
}
interface PlaywrightTest {
  results?: PlaywrightResult[]
}
interface PlaywrightResult {
  status?:      string
  errors?:      Array<{ message?: string }>
  attachments?: Array<{ name?: string; path?: string }>
}

async function parseFailures(reportPath: string): Promise<{ passed: number; failed: FailedTest[] }> {
  let raw: string
  try { raw = await fs.readFile(reportPath, 'utf8') } catch { return { passed: 0, failed: [] } }

  let report: PlaywrightReport
  try { report = JSON.parse(raw) as PlaywrightReport } catch { return { passed: 0, failed: [] } }

  let passed = 0
  const failed: FailedTest[] = []

  const visit = (suite: PlaywrightSuite, parentFile: string | undefined) => {
    const file = suite.file ?? parentFile
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.[0]?.results?.[0]
      if (!result) continue
      if (result.status === 'passed') { passed += 1; continue }
      if (result.status === 'failed' || result.status === 'timedOut') {
        const errorMessage = (result.errors ?? [])
          .map(e => e.message ?? '')
          .filter(Boolean)
          .join('\n')
          .slice(0, 4_000)
        const attachments = (result.attachments ?? [])
          .map(a => a.path ?? '')
          .filter(Boolean)
        failed.push({
          title:        spec.title,
          file:         spec.file ?? file ?? '<unknown>',
          errorMessage,
          attachments,
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, file)
  }
  for (const suite of report.suites ?? []) visit(suite, suite.file)

  return { passed, failed }
}
