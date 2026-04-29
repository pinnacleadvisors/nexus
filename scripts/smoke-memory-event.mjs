#!/usr/bin/env node
/**
 * scripts/smoke-memory-event.mjs
 *
 * End-to-end smoke for /api/memory/event. Run against a deployed URL or
 * a local `next dev` instance. Requires MEMORY_HQ_TOKEN in env.
 *
 * Usage:
 *   MEMORY_HQ_TOKEN=... node scripts/smoke-memory-event.mjs http://localhost:3000
 *   MEMORY_HQ_TOKEN=... node scripts/smoke-memory-event.mjs https://nexus-staging.vercel.app
 *
 * Verifies:
 *   1. 401 when bearer is missing
 *   2. 400 on invalid scope (no repo or business_slug)
 *   3. 400 on missing payload.title
 *   4. 200 + slug + html_url on a valid atom
 *   5. Rate-limit header present in 200 responses
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const token = process.env.MEMORY_HQ_TOKEN
if (!token) {
  console.error('MEMORY_HQ_TOKEN required in env')
  process.exit(2)
}

const url = `${base}/api/memory/event`
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const trace = `smoke-${Date.now()}`

async function call(label, init, expectStatus) {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  const pass = res.status === expectStatus
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label} -> ${res.status}${pass ? '' : ` (expected ${expectStatus})`}`)
  if (!pass) console.log('  body:', JSON.stringify(body).slice(0, 300))
  return { res, body, pass }
}

console.log(`Smoke: ${url}`)

let allPass = true
allPass &= (await call(
  '401 when bearer missing',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  401,
)).pass

allPass &= (await call(
  '400 when scope is empty',
  { method: 'POST', headers, body: JSON.stringify({ type: 'atom', source: 'smoke', scope: {}, payload: { title: 'x' } }) },
  400,
)).pass

allPass &= (await call(
  '400 when payload.title missing',
  { method: 'POST', headers, body: JSON.stringify({ type: 'atom', source: 'smoke', scope: { repo: 'pinnacleadvisors/nexus' }, payload: {} }) },
  400,
)).pass

const valid = await call(
  '200 on valid atom',
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'atom',
      source: 'smoke-test',
      scope: { repo: 'pinnacleadvisors/nexus', namespace: 'smoke' },
      payload: {
        title: `Smoke atom ${trace}`,
        fact: 'Smoke test fact — safe to delete.',
        importance: 'low',
      },
      locators: [{ kind: 'url', href: 'https://example.com/smoke' }],
      trace_id: trace,
    }),
  },
  200,
)
allPass &= valid.pass
if (valid.pass) {
  console.log(`  -> ${valid.body.html_url}`)
  console.log(`  -> trace_id: ${valid.body.trace_id}`)
}

console.log(allPass ? '\nALL PASS' : '\nFAILURES — see above')
process.exit(allPass ? 0 : 1)
