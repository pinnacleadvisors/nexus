/**
 * Unit test for lib/businesses/mcp-manifest.ts.
 *
 * Asserts that the `pdf-info-products` niche resolves to the `digital-products`
 * profile and that the resolved set includes `cloudflare-mcp` plus every
 * required env var (profile-level `CONVERTKIT_API_KEY` AND MCP-level
 * `CLOUDFLARE_API_TOKEN`).
 *
 * Run directly with: `npx --yes tsx __tests__/businesses/mcp-manifest.test.ts`
 * (no test framework is wired in this repo yet — this is a plain assertion
 * script that exits non-zero on failure).
 */
import { resolveManifest } from '../../lib/businesses/mcp-manifest'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const r = resolveManifest({ niche: 'pdf-info-products' })

assert(r.profile === 'digital-products',
  `expected profile=digital-products, got ${r.profile}`)
assert(r.mcpIds.includes('cloudflare-mcp'),
  `expected mcpIds to include cloudflare-mcp, got ${r.mcpIds.join(',')}`)
assert(r.requiredEnv.includes('CONVERTKIT_API_KEY'),
  `expected requiredEnv to include CONVERTKIT_API_KEY, got ${r.requiredEnv.join(',')}`)
assert(r.requiredEnv.includes('CLOUDFLARE_API_TOKEN'),
  `expected requiredEnv to include CLOUDFLARE_API_TOKEN, got ${r.requiredEnv.join(',')}`)

console.log('PASS: pdf-info-products → digital-products with cloudflare-mcp + CONVERTKIT_API_KEY + CLOUDFLARE_API_TOKEN')
console.log(`  profile=${r.profile}`)
console.log(`  mcpIds=[${r.mcpIds.join(', ')}]`)
console.log(`  requiredEnv=[${r.requiredEnv.join(', ')}]`)
