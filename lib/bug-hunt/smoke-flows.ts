/**
 * lib/bug-hunt/smoke-flows.ts — pre-defined smoke flows for dynamic-audit
 * iterations. The bug-hunt-loop agent picks one (or several) and builds a
 * `delegate_to_codex` brief that asks codex to run nexus-smoke against
 * each target.
 *
 * Adding a flow is intentionally cheap — the agent doesn't need a code
 * change to invoke a new URL; it just gets a richer menu. Treat this list
 * as a stable starting point, not the canonical catalogue.
 */

export interface SmokeFlow {
  id:          string
  title:       string
  path:        string          // appended to the preview / production URL
  check?:      string          // substring expected in rendered HTML
  timeoutMs?:  number
  notes?:      string
}

export const SMOKE_FLOWS: Record<string, SmokeFlow> = {
  'home': {
    id:    'home',
    title: 'Home / sign-in loads',
    path:  '/',
    check: 'Sign in',
  },
  'dashboard': {
    id:    'dashboard',
    title: 'Mission Control loads',
    path:  '/dashboard',
    check: 'Mission Control',
    notes: 'Requires Clerk-auth session — run only against authenticated preview when available.',
  },
  'businesses-list': {
    id:    'businesses-list',
    title: 'Businesses index loads',
    path:  '/businesses',
    check: 'Businesses',
  },
  'manage-platform': {
    id:    'manage-platform',
    title: 'Dev Console loads',
    path:  '/manage-platform',
    check: 'Dev Console',
  },
  'graph': {
    id:    'graph',
    title: 'Knowledge graph renders',
    path:  '/graph',
    notes: 'No --check — three.js canvas; just confirm 2xx + no console errors.',
  },
}

export function buildCodexBrief(previewUrl: string, flowIds: string[]): string {
  const base = previewUrl.replace(/\/$/, '')
  const flows = flowIds.map(id => SMOKE_FLOWS[id]).filter((f): f is SmokeFlow => !!f)
  if (flows.length === 0) {
    return `No valid smoke flows requested. Available: ${Object.keys(SMOKE_FLOWS).join(', ')}.`
  }
  const lines = [
    `Run the following smoke checks against ${base}. Each is a nexus-smoke command; return ALL the JSON outputs concatenated as one response, plus a one-line summary at the bottom.`,
    '',
  ]
  for (const f of flows) {
    const args = [
      JSON.stringify(`${base}${f.path}`),
      f.check     ? `--check=${JSON.stringify(f.check)}`     : '',
      f.timeoutMs ? `--timeout-ms=${f.timeoutMs}`            : '--timeout-ms=20000',
    ].filter(Boolean).join(' ')
    lines.push(`- ${f.title}: \`nexus-smoke ${args}\``)
  }
  lines.push('')
  lines.push('For any failure, include the page console-error array and the load duration.')
  return lines.join('\n')
}
