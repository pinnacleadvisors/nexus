import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next'

/**
 * Content Security Policy — restricts what resources the browser can load.
 * Adjusted for Next.js (requires 'unsafe-inline' for styles and dev HMR).
 *
 * Note: 'unsafe-eval' is only included in dev (Next.js HMR / React Refresh).
 * In production it is stripped — eval()-based code will fail in the browser.
 */
const IS_PROD = process.env.NODE_ENV === 'production'
const SCRIPT_DEV_ONLY = IS_PROD ? '' : " 'unsafe-eval'"

// Clerk custom production-domain allowlist — set in env when you upgrade
// from the dev instance to a Clerk production instance (paid plan +
// verified domain). Leave unset in lean / pre-revenue mode; the dev
// instance lives on `*.clerk.accounts.dev` which is already allowed
// below.
const CLERK_PROD_DOMAIN = process.env.NEXT_PUBLIC_CLERK_FRONTEND_DOMAIN
  ? `https://${process.env.NEXT_PUBLIC_CLERK_FRONTEND_DOMAIN}`
  : ''

const CSP = [
  "default-src 'self'",
  // Scripts: self + Next.js inline bootstrap + Clerk hosted scripts + Cloudflare Turnstile
  // (Clerk bot protection) + Cloudflare Insights (RUM beacon auto-injected by the
  // Cloudflare proxy in front of coolifycloudtunnel.uk; without this entry the
  // beacon spams console errors on every page load).
  [
    `script-src 'self' 'unsafe-inline'${SCRIPT_DEV_ONLY}`,
    'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
    'https://static.cloudflareinsights.com',
    CLERK_PROD_DOMAIN,
  ].filter(Boolean).join(' '),
  // Styles: self + inline (Tailwind CSS utility classes are inline)
  "style-src 'self' 'unsafe-inline'",
  // Images: self + data URIs + Clerk avatar CDN + common asset CDNs
  "img-src 'self' data: blob: https://img.clerk.com https://*.supabase.co",
  // Fonts: self
  "font-src 'self' data:",
  // API + WebSocket connections.
  //
  // Clerk note: when the app is on Clerk's dev instance, the SDK loads from
  // and calls back to `*.clerk.accounts.dev` — covered by the wildcard
  // below. When you upgrade to a Clerk production instance, set
  // NEXT_PUBLIC_CLERK_FRONTEND_DOMAIN (e.g. `clerk.<your-domain>`); both
  // script-src and connect-src pick it up. Without this CSP entry, the
  // SDK's background session refreshes (~60s TTL) fail silently and every
  // protected route 401s after the first minute.
  [
    "connect-src 'self'",
    'https://api.anthropic.com',
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.openai.com',
    'https://*.clerk.com',
    'https://*.clerk.accounts.dev',
    CLERK_PROD_DOMAIN,
    'https://clerk-telemetry.com',
    'https://challenges.cloudflare.com',
    'https://inngest.com',
    'https://api.us-1.inngest.com',
    'https://*.upstash.io',
    'https://api.notion.com',
    process.env.NEXUS_BASE_URL ?? '',
  ]
    .filter(Boolean)
    .join(' '),
  // Frames: Clerk hosted pages + Cloudflare Turnstile CAPTCHA (Clerk bot protection)
  "frame-src 'self' https://accounts.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  // Workers: none
  "worker-src 'self' blob:",
  // Form actions: self only
  "form-action 'self'",
  // Base URI: self only (prevent base-tag injection)
  "base-uri 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy',     value: CSP },
  { key: 'X-Frame-Options',             value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',      value: 'nosniff' },
  { key: 'Referrer-Policy',             value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',          value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security',   value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy',  value: 'same-origin-allow-popups' },
]

const nextConfig: NextConfig = {
  // ── Coolify build optimization ──────────────────────────────────────────
  // `output: 'standalone'` makes `next build` emit a minimal self-contained
  // server at `.next/standalone/` that includes only the route handlers +
  // their resolved deps. Cuts the runtime image from ~400 MB → ~80 MB, which
  // shaves ~60-90s off the image-push step on Coolify's Hostinger bandwidth.
  // It also drops Next.js cold start from ~10-15s to ~3-5s because the bundle
  // doesn't have to walk a full node_modules tree.
  //
  // Important: when this is set, services/lean-deploy/Dockerfile must copy
  // `.next/standalone/` and `.next/static/` (NOT the whole `/app` tree).
  // The Dockerfile in this PR is updated to match.
  output: 'standalone',
  // Some routes shell out at runtime and read repo files Next.js can't trace
  // statically (e.g. /api/skills/[slug]/promote reads .claude/skills/<slug>/
  // SKILL.md). outputFileTracingIncludes copies those trees into the
  // standalone bundle at build time so the runtime container has them.
  // Patterns are glob, rooted at the project dir; key is the route pattern
  // OR `*` for "include everywhere".
  outputFileTracingIncludes: {
    '*': [
      './.claude/skills/**/*',
      './.claude/agents/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
 // For all available options, see:
 // https://www.npmjs.com/package/@sentry/webpack-plugin#options

 org: "dylan-wd",

 project: "nexus",

 // Only print logs for uploading source maps in CI
 silent: !process.env.CI,

 // For all available options, see:
 // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

 // Upload a larger set of source maps for prettier stack traces.
 // Coolify build optimization: turning this OFF drops ~30-60s off cold builds
 // because Sentry skips uploading the heavier source-map set. Stack traces
 // are still readable — they're just less precisely-mapped against the
 // pre-bundle source code. Re-enable if a production error gets reported
 // with unhelpful stack traces.
 widenClientFileUpload: false,

 // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
 // This can increase your server load as well as your hosting bill.
 // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
 // side errors will fail.
 tunnelRoute: "/monitoring",

 webpack: {
   // Vercel cron monitoring is disabled — we use cron-job.org as the
   // scheduler in lean mode (per AGENTS.md topology). Sentry's Vercel-
   // specific instrumentation adds ~5-10s to every build for no signal.
   // If you ever re-introduce Vercel cron jobs, flip back to `true`.
   automaticVercelMonitors: false,

   // Tree-shaking options for reducing bundle size
   treeshake: {
     // Automatically tree-shake Sentry logger statements to reduce bundle size
     removeDebugLogging: true,
   },
 },
});
