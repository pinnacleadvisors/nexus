/**
 * lib/audit/layout.ts — serialise a terminal layout to a shareable URL param.
 *
 * A "layout" is just which panes are open + which is active. We base64url-
 * encode the JSON into `?layout=` so an operator can bookmark "my morning
 * triage" or paste the link to a teammate. Decoding is defensive: unknown
 * source ids are dropped and any malformed input returns null (falls back to
 * localStorage / defaults), so a hand-edited or stale param can never break
 * the page. Tab ids are ASCII slugs, so plain btoa/atob is sufficient.
 */

import { getSource } from './sources'

export interface AuditLayout {
  tabs: string[]
  active?: string
}

/** Encode a layout to a URL-safe base64 string (no padding). */
export function encodeLayout(layout: AuditLayout): string {
  const json = JSON.stringify({ tabs: layout.tabs, active: layout.active })
  const b64 = typeof window !== 'undefined'
    ? window.btoa(json)
    : Buffer.from(json, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode a `?layout=` param, validating every id against the registry.
 *  Returns null on anything malformed or empty. */
export function decodeLayout(param: string | null | undefined): AuditLayout | null {
  if (!param) return null
  try {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof window !== 'undefined'
      ? window.atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const rawTabs = (parsed as { tabs?: unknown }).tabs
    if (!Array.isArray(rawTabs)) return null
    const tabs = rawTabs.filter((id): id is string => typeof id === 'string' && Boolean(getSource(id)))
    if (tabs.length === 0) return null
    const rawActive = (parsed as { active?: unknown }).active
    const active = typeof rawActive === 'string' && tabs.includes(rawActive) ? rawActive : tabs[0]
    return { tabs, active }
  } catch {
    return null
  }
}
