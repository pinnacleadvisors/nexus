/**
 * Sentry error tracking — scaffold only.
 *
 * To enable Sentry:
 * 1. npm install @sentry/nextjs
 * 2. Run `npx @sentry/wizard@latest -i nextjs` (generates sentry.*.config.ts files)
 * 3. Add SENTRY_DSN to Doppler
 * 4. Replace the stub below with actual Sentry calls
 *
 * Required env var: SENTRY_DSN
 */

export interface SentryError {
  message: string
  agentId?: string
  extra?: Record<string, unknown>
}

/** Capture an exception — replace with Sentry.captureException() once installed */
export function captureError(error: Error | string, context?: SentryError['extra']): void {
  if (process.env.NODE_ENV === 'production') {
    // TODO: replace with Sentry.captureException(error, { extra: context })
    console.error('[sentry-stub]', typeof error === 'string' ? error : error.message, context)
  }
}

/** Set the active user for Sentry scope — replace with Sentry.setUser() */
export function setUser(userId: string): void {
  // TODO: Sentry.setUser({ id: userId })
  void userId
}
