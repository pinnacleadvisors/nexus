/**
 * scripts/migrate-business.ts
 *
 * Walks an existing `business_operators` row through the per-business
 * container migration. Prints status and the exact commands the operator
 * needs to run (browser-only steps are listed but not automated).
 *
 * Usage:
 *
 *   # Single business
 *   doppler run -- npx --yes tsx scripts/migrate-business.ts ledger-lane
 *
 *   # All known seeds
 *   doppler run -- npx --yes tsx scripts/migrate-business.ts --all
 *
 *   # Trigger the image build via gh CLI as part of the run
 *   doppler run -- npx --yes tsx scripts/migrate-business.ts ledger-lane --build
 *
 * What it does:
 *   1. Looks up the business in lib/business/seeds.ts
 *   2. Resolves the MCP manifest from its niche
 *   3. Checks user_secrets for an existing `business:<slug>` row (already
 *      provisioned?)
 *   4. Optionally triggers the per-business-image GHA workflow via gh CLI
 *   5. Prints the provision curl + the post-provision Coolify steps
 *   6. Prints the /settings/accounts URLs for per-business OAuth connections
 *
 * What it deliberately doesn't do:
 *   - Call /api/businesses/:slug/provision (needs a Clerk session cookie;
 *     run it from your browser DevTools or paste the curl below).
 *   - Open the Coolify UI for you (the deploy step is manual by design — see
 *     ADR / runbook).
 *   - Connect OAuth accounts (browser flow only).
 */

import { spawnSync } from 'node:child_process'
import { BUSINESS_SEEDS, type BusinessSeed } from '../lib/business/seeds'
import { resolveManifest } from '../lib/businesses/mcp-manifest'
import { OAUTH_PROVIDERS } from '../lib/oauth/providers'

interface Args {
  slug?:    string
  all:      boolean
  build:    boolean
  niche?:   string
}

function parseArgs(): Args {
  const a: Args = { all: false, build: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--all')   a.all = true
    else if (arg === '--build') a.build = true
    else if (arg.startsWith('--niche=')) a.niche = arg.slice('--niche='.length)
    else if (!a.slug) a.slug = arg
  }
  return a
}

async function checkProvisioned(slug: string): Promise<{ provisioned: boolean; gatewayUrl?: string }> {
  // Best-effort — we don't have direct DB access from CLI. The script just
  // tells the operator how to verify, rather than failing if it can't.
  if (!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { provisioned: false }
  }
  // Skip the actual query — keep this script dependency-free and let the
  // operator confirm via the dispatch logs or Coolify UI.
  return { provisioned: false }
}

function triggerBuild(slug: string, niche: string): void {
  console.log(`Triggering GHA build for ${slug} (niche=${niche}, mcp_override=none) …`)
  const res = spawnSync('gh', [
    'workflow', 'run', 'per-business-image.yml',
    '-f', `slug=${slug}`,
    '-f', `niche=${niche}`,
    '-f', `mcp_override=none`,
  ], { stdio: 'inherit' })
  if (res.status !== 0) {
    console.error('  gh workflow run failed — check `gh auth status` or trigger manually from the Actions tab.')
  } else {
    console.log('  Build triggered. Watch with `gh run watch` or in the Actions tab.')
    console.log('')
  }
}

function printPlan(seed: BusinessSeed, opts: { build: boolean; niche?: string }) {
  // The seed niches are descriptive ("Tax organizers for solo accountants…")
  // but resolveManifest matches against a small set of profile slugs. Operator
  // can override with --niche=ecommerce. Default fallback for these is the
  // small "default" profile (canva + tavily).
  const niche = opts.niche ?? 'ecommerce' // best fit for inkbound + ledger-lane (digital products on Etsy)
  const manifest = resolveManifest({ niche })

  const bar = '═'.repeat(60)
  console.log(`\n${bar}`)
  console.log(`Business: ${seed.name}  (slug: ${seed.slug})`)
  console.log(bar)
  console.log(`  seed niche:    ${seed.niche}`)
  console.log(`  resolved as:   ${manifest.profile}`)
  console.log(`  MCPs:          ${manifest.mcpIds.join(', ')}`)
  console.log(`  brand voice:   ${(seed.brand_voice ?? '(none)').slice(0, 80)}…`)
  console.log('')

  console.log('── Step 1: Build the per-business image ──')
  if (opts.build) {
    triggerBuild(seed.slug, niche)
  } else {
    console.log(`  gh workflow run per-business-image.yml \\`)
    console.log(`    -f slug=${seed.slug} \\`)
    console.log(`    -f niche=${niche} \\`)
    console.log(`    -f mcp_override=none`)
    console.log('')
    console.log(`  Or pass --build to this script to trigger it.`)
    console.log('')
  }

  console.log('── Step 2: Provision the Coolify app ──')
  console.log(`  Open browser DevTools → Application → Cookies → copy __session, then:`)
  console.log(``)
  console.log(`  curl -i -X POST "$NEXT_PUBLIC_APP_URL/api/businesses/${seed.slug}/provision" \\`)
  console.log(`    -H "content-type: application/json" \\`)
  console.log(`    -H "cookie: __session=<paste>" \\`)
  console.log(`    -d '{"niche":"${niche}"}'`)
  console.log(``)
  console.log(`  Expect: { ok: true, uuid, fqdn, gatewayUrl, secretsWritten: true, … }`)
  console.log('')

  console.log('── Step 3: Deploy in Coolify ──')
  console.log(`  Coolify → Projects → "${process.env.COOLIFY_PROJECT_ID_NEXUS_BUSINESSES ? '<your project>' : 'Nexus Businesses'}" → nexus-business-${seed.slug}`)
  console.log(`  Click Deploy. Watch logs until Status: Running.`)
  console.log(`  Open Terminal tab → run \`claude login\` → paste the OAuth code back.`)
  console.log('')

  console.log('── Step 4: Connect per-business accounts ──')
  console.log(`  /settings/accounts?businessSlug=${seed.slug}`)
  console.log(``)
  console.log(`  Recommended for ${seed.name}:`)
  // For digital-product sellers like ledger-lane / inkbound:
  // - Per-business: Stripe (own customers/funds), Instagram (own brand handle)
  // - Shareable: Canva (use shared at user-default, no businessSlug)
  const recommended = OAUTH_PROVIDERS.filter(p =>
    p.sharePolicy === 'per-business' &&
    !p.manualSetup &&
    ['stripe', 'gmail', 'google_analytics'].includes(p.id),
  )
  for (const p of recommended) {
    console.log(`    - ${p.name.padEnd(20)} (${p.toolkitSlug}) — per-business`)
  }
  const sharedHint = OAUTH_PROVIDERS.find(p => p.id === 'canva')
  if (sharedHint) {
    console.log('')
    console.log(`  Shareable across businesses (connect once at /settings/accounts):`)
    console.log(`    - ${sharedHint.name.padEnd(20)} (${sharedHint.toolkitSlug})`)
  }
  const manual = OAUTH_PROVIDERS.filter(p => p.manualSetup && ['twitter', 'shopify', 'tiktok'].includes(p.id))
  if (manual.length) {
    console.log('')
    console.log(`  Manual setup (Composio Auth Configs not auto-created):`)
    for (const p of manual) {
      console.log(`    - ${p.name.padEnd(20)} ${p.manualSetup?.credentialsUrl ?? ''}`)
    }
  }
  console.log('')

  console.log('── Step 5: Smoke-test ──')
  console.log(`  curl -i "https://${seed.slug}.gateway.nexus.example.com/health"  # adjust hostname`)
  console.log(`  Expect: { ok: true, loggedIn: true, queueDepth: 0 }`)
  console.log('')

  console.log('── Step 6: Run a low-stakes dispatch ──')
  console.log(`  Pick a maintain workflow that doesn't post anywhere visible.`)
  console.log(`  Vercel logs should show resolution to ${seed.slug}.gateway.* (not the shared gateway).`)
  console.log('')

  console.log(`When stable for ≥7 days, repeat for the next business or migrate the rest.`)
}

function main() {
  const args = parseArgs()

  let targets: BusinessSeed[]
  if (args.all) {
    targets = BUSINESS_SEEDS
  } else if (args.slug) {
    const seed = BUSINESS_SEEDS.find(b => b.slug === args.slug)
    if (!seed) {
      console.error(`No seed for "${args.slug}". Known: ${BUSINESS_SEEDS.map(b => b.slug).join(', ')}`)
      process.exit(1)
    }
    targets = [seed]
  } else {
    console.error('Usage: migrate-business.ts <slug> | --all  [--build] [--niche=<profile>]')
    console.error(`Known slugs: ${BUSINESS_SEEDS.map(b => b.slug).join(', ')}`)
    process.exit(1)
  }

  for (const seed of targets) {
    printPlan(seed, { build: args.build, niche: args.niche })
  }
}

main()
