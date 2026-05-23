import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Nexus',
  description: 'Business management and agent automation platform',
}

/**
 * Viewport meta — Next.js 16 emits <meta name="viewport"> from this export.
 *
 * Without it, mobile browsers assume a ~980px desktop viewport, Tailwind
 * sm:/md:/lg: breakpoints never trigger on phones, and the desktop layout
 * renders at scale on the device — the "squashed and unusable" symptom on
 * 2026-05-24 was caused by this missing export.
 *
 * The mobile-copilot Playwright projects (PR #290) didn't catch the
 * regression because Playwright sets its own viewport via device config,
 * bypassing the meta tag entirely. Real-device traffic was the only path
 * that exposed it.
 *
 * `userScalable: true` + `maximumScale: 5` lets the operator pinch-zoom
 * dense tables / kanban boards on a small screen — locking it disabled
 * would be an accessibility regression.
 */
export const viewport: Viewport = {
  width:         'device-width',
  initialScale:  1,
  maximumScale:  5,
  userScalable:  true,
  themeColor:    '#050508',
}

// Opt out of static prerender. The setup-gate below reads runtime env
// (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY) which Doppler
// injects at container start via `doppler run --`. Without this, Next.js
// prerenders every protected route's HTML shell at build time — when those
// env vars are NOT yet available — and bakes the "Setup Required" branch
// into dashboard.html, board.html, etc. Forcing dynamic rendering makes
// the gate evaluate per-request, where doppler-injected env is visible.
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secretKey = process.env.CLERK_SECRET_KEY

  // Render a setup page instead of crashing when Clerk isn't fully configured.
  // Both keys are required: publishable for the client-side SDK, secret for
  // session validation in clerkMiddleware. A half-configured deployment
  // (one key set, the other missing) silently crashes auth() in page.tsx
  // because clerkMiddleware throws and proxy.ts catches it — see proxy.ts.
  if (!publishableKey || !secretKey) {
    return (
      <html lang="en">
        <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#050508', color: '#e8e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ maxWidth: 480, padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: '1rem' }}>⚙️</div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Nexus — Setup Required</h1>
            <p style={{ color: '#9090b0', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Add the following environment variables in your Vercel project settings
              (or Doppler) to get started:
            </p>
            <div style={{ background: '#0d0d14', border: '1px solid #24243e', borderRadius: 8, padding: '1rem', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.85rem', color: '#c0c0d8', marginBottom: '1.5rem' }}>
              <div style={{ marginBottom: '0.25rem' }}>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</div>
              <div style={{ marginBottom: '0.25rem' }}>CLERK_SECRET_KEY</div>
              <div style={{ color: '#6c6c88', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                # Optional — app works without these:<br />
                NEXT_PUBLIC_SUPABASE_URL<br />
                NEXT_PUBLIC_SUPABASE_ANON_KEY<br />
                ANTHROPIC_API_KEY
              </div>
            </div>
            <p style={{ color: '#6c6c88', fontSize: '0.8rem' }}>
              Get your Clerk keys at clerk.com → your app → API Keys
            </p>
          </div>
        </body>
      </html>
    )
  }

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
