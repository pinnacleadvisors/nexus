/**
 * Audit log — records every significant agent/user action to the `audit_log` table.
 * Writes fire-and-forget (never blocks the response).
 *
 * When Supabase is not configured, logs are written to the console only.
 *
 * Usage:
 *   import { audit } from '@/lib/audit'
 *   audit(req, { action: 'board.approve', resource: 'task', resourceId: card.id, metadata: { title } })
 */

import { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

export interface AuditEntry {
  action: string
  resource: string
  resourceId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

/** Hash an IP address (last octet replaced with 0 for privacy) */
function anonymiseIp(ip: string): string {
  // IPv4 — zero out last octet
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return ip.replace(/\.\d+$/, '.0')
  }
  // IPv6 — keep first 4 groups only
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':') + '::/64'
  }
  return ip
}

function getIp(req: NextRequest): string {
  const raw =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  return anonymiseIp(raw)
}

/** Write an audit entry. Fire-and-forget — never throws. */
export function audit(req: NextRequest, entry: AuditEntry): void {
  const ip = getIp(req)
  const row = {
    user_id:     entry.userId ?? null,
    action:      entry.action,
    resource:    entry.resource,
    resource_id: entry.resourceId ?? null,
    metadata:    (entry.metadata ?? null) as Json | null,
    ip,
  }

  // Non-blocking write
  Promise.resolve().then(async () => {
    const supabase = createServerClient()
    if (!supabase) {
      // Fallback: console log in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('[audit]', row)
      }
      return
    }
    try {
      await supabase.from('audit_log').insert(row)
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[audit] failed to write:', err)
      }
    }
  })
}

/** Read recent audit log entries (server-side only). */
export async function getAuditLog(options: {
  limit?: number
  resource?: string
  action?: string
  userId?: string
}) {
  const supabase = createServerClient()
  if (!supabase) return []

  let query = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.resource) query = query.eq('resource', options.resource)
  if (options.action)   query = query.eq('action', options.action)
  if (options.userId)   query = query.eq('user_id', options.userId)

  const { data } = await query
  return data ?? []
}

/** Convenience: row count of pinned entries. Used by the Audit panel. */
export async function getPinnedCount(): Promise<number> {
  const supabase = createServerClient()
  if (!supabase) return 0
  // `pinned` column added in migration 030; database.types.ts not yet regen'd.
  type LooseSelect = {
    select: (cols: string, opts: { count: 'exact'; head: boolean }) => LooseSelect
    eq:     (k: string, v: unknown) => Promise<{ count: number | null }>
  }
  const { count } = await (supabase.from('audit_log' as never) as unknown as LooseSelect)
    .select('id', { count: 'exact', head: true })
    .eq('pinned', true)
  return count ?? 0
}
