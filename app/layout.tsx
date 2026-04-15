import type { Metadata } from 'next'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

  // Render a setup page instead of crashing when Clerk isn't configured.
  // This prevents the "file download" bug caused by a mid-stream server crash.
  if (!publishableKey) {
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
          afterSignInUrl="/dashboard"
          afterSignUpUrl="/dashboard"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
