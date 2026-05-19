/**
 * GET /api/health
 *
 * Liveness probe. Returns 200 + minimal status when the Next.js process is
 * up and can read its config. Used by:
 *   - Coolify container healthcheck (Compose `test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/health')...\""]`)
 *   - External monitors (uptime checks, /api/cron/post-deploy-smoke)
 *
 * Intentionally cheap — no DB calls, no external HTTP, no auth. Deep
 * probes live at /api/health/db, /api/health/summary, etc.
 *
 * Response shape is stable across deploys; consumers can rely on `ok`,
 * `mode`, and `time` being present.
 */

import { NextResponse } from 'next/server'
import { isLeanMode } from '@/lib/lean-mode'

export const runtime  = 'nodejs'
// Bypass any caching layer — every probe should hit the running process.
export const dynamic  = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json({
    ok:    true,
    mode:  isLeanMode() ? 'lean' : 'scale',
    time:  new Date().toISOString(),
    // Build/commit identifier — set by deploy infra. Coolify doesn't auto-
    // populate this; the migrate-to-lean-kvm.mjs script or a future
    // `BUILD_SHA=$(git rev-parse HEAD)` Doppler env can wire it.
    build: process.env.BUILD_SHA?.slice(0, 10) ?? null,
  })
}
