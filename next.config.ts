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

const CSP = [
  "default-src 'self'",
  // Scripts: self + Next.js inline bootstrap + Clerk hosted scripts + Cloudflare Turnstile (Clerk bot protection)
  `script-src 'self' 'unsafe-inline'${SCRIPT_DEV_ONLY} https://clerk.nexus.pinnacleadvisors.com https://*.clerk.accounts.dev https://challenges.cloudflare.com`,
  // Styles: self + inline (Tailwind CSS utility classes are inline)
  "style-src 'self' 'unsafe-inline'",
  // Images: self + data URIs + Clerk avatar CDN + common asset CDNs
  "img-src 'self' data: blob: https://img.clerk.com https://*.supabase.co",
  // Fonts: self
  "font-src 'self' data:",
  // API + WebSocket connections
  [
    "connect-src 'self'",
    'https://api.anthropic.com',
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.openai.com',
    'https://*.clerk.com',
    'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
    'https://inngest.com',
    'https://api.us-1.inngest.com',
    'https://*.upstash.io',
    'https://api.notion.com',
    process.env.NEXT_PUBLIC_APP_URL ?? '',
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

 // Upload a larger set of source maps for prettier stack traces (increases build time)
 widenClientFileUpload: true,

 // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
 // This can increase your server load as well as your hosting bill.
 // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
 // side errors will fail.
 tunnelRoute: "/monitoring",

 webpack: {
   // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
   // See the following for more information:
   // https://docs.sentry.io/product/crons/
   // https://vercel.com/docs/cron-jobs
   automaticVercelMonitors: true,

   // Tree-shaking options for reducing bundle size
   treeshake: {
     // Automatically tree-shake Sentry logger statements to reduce bundle size
     removeDebugLogging: true,
   },
 },
});
