#!/usr/bin/env node
// Smoke test for lib/tokenjuice (no unit-test runner in this repo).
//   npm run smoke:tokenjuice   (npx tsx lib/tokenjuice/smoke.mjs)
// Asserts: HTML->MD + dedupe + url-shorten shrink the text, savedTokens>0,
// and the transform is idempotent (compress(compress(x)) === compress(x)).
import { compress } from './index.ts'

const FIXTURE = `<html><head><style>.x{color:red}</style></head><body>
<h1>Title</h1>
<p>Hello world. Hello world.</p>
<p>Hello world. Hello world.</p>
<ul><li>one</li><li>two</li></ul>
<a href="https://example.com/very/long/path/that/keeps/going/and/going/forever?q=1&z=2">link text</a>
plain line
plain line
plain line
</body></html>`

let failed = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const r = compress(FIXTURE)
check('output is shorter than input', r.text.length < FIXTURE.length)
check('savedTokens > 0', r.savedTokens > 0)
check('html tags stripped', !/<[a-z]/i.test(r.text))
check('consecutive duplicate line collapsed', (r.text.match(/plain line/g) || []).length === 1)
check('long url shortened', !r.text.includes('that/keeps/going'))

const r2 = compress(r.text)
check('idempotent (second pass equals first)', r2.text === r.text)

const empty = compress('')
check('empty input safe', empty.text === '' && empty.savedTokens === 0)

const plain = compress('just a normal sentence with no html.')
check('plain text passes through largely intact', plain.text === 'just a normal sentence with no html.')

console.log(`\n${failed === 0 ? 'OK — all checks passed' : `FAILED — ${failed} check(s)`}`)
process.exit(failed === 0 ? 0 : 1)
