'use client'

/**
 * BusinessSwitcher — liquid-glass dropdown that toggles `?businessSlug=<slug>`
 * on the /settings/accounts URL.
 *
 * Replaces the manual URL-edit workflow: the operator picks "Default" (no
 * scope) or one of their businesses, and the page reloads with the right
 * connected_accounts rows. Other query params (notably `?connected=<platform>`
 * from the OAuth callback) are preserved across the swap.
 *
 * Server-rendered businesses come from `listBusinessesForUser(userId)` and
 * are passed in as a plain prop — no client-side data fetching, no provider.
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ChevronsUpDown, Check, Briefcase, Globe2, ShieldCheck } from 'lucide-react'
import type { BusinessRow } from '@/lib/business/types'
import { ADMIN_SCOPE } from '@/lib/claw/business-client'

interface Props {
  businesses:   BusinessRow[]
  selectedSlug: string | null
  /** When true, the Admin scope option is rendered. Pass true only for the
   *  platform owner (gated by ALLOWED_USER_IDS in the parent server component). */
  showAdmin?:   boolean
}

const SHARED_LABEL = 'Shared'
const SHARED_HINT  = 'Shared across businesses (fallback chain)'
const ADMIN_LABEL  = 'Admin'
const ADMIN_HINT   = 'Nexus platform — distinct tokens from Shared'

export default function BusinessSwitcher({ businesses, selectedSlug, showAdmin = false }: Props) {
  const router    = useRouter()
  const pathname  = usePathname() ?? '/settings/accounts'
  const params    = useSearchParams()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = useMemo(() => {
    if (!selectedSlug || selectedSlug === ADMIN_SCOPE) return null
    return businesses.find(b => b.slug === selectedSlug) ?? null
  }, [businesses, selectedSlug])

  const isAdminSelected = selectedSlug === ADMIN_SCOPE

  function pick(slug: string | null) {
    setOpen(false)
    // Preserve all existing search params except businessSlug — important for
    // the post-OAuth `?connected=<platform>` success banner flow.
    const next = new URLSearchParams()
    if (params) {
      params.forEach((value: string, key: string) => {
        if (key === 'businessSlug') return
        next.append(key, value)
      })
    }
    if (slug) next.set('businessSlug', slug)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const empty = businesses.length === 0

  return (
    <div ref={wrapperRef} className="relative w-full sm:w-80">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-all"
        style={{
          background:        'linear-gradient(135deg, rgba(108,99,255,0.08), rgba(255,255,255,0.025))',
          backdropFilter:    'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border:            '1px solid rgba(255,255,255,0.10)',
          borderRadius:      '14px',
          boxShadow:
            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 16px 36px -20px rgba(0,0,0,0.5)',
          color:             '#e8e8f0',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: selected || isAdminSelected
                ? 'linear-gradient(135deg, rgba(108,99,255,0.35), rgba(108,99,255,0.10))'
                : 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))',
              border:     '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {selected
              ? <Briefcase  size={13} style={{ color: '#a8a3ff' }} />
              : isAdminSelected
                ? <ShieldCheck size={13} style={{ color: '#a8a3ff' }} />
                : <Globe2   size={13} style={{ color: '#9090b0' }} />}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: '#55556a' }}>
              {selected ? 'BUSINESS' : 'SCOPE'}
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
                {selected ? selected.name : isAdminSelected ? ADMIN_LABEL : SHARED_LABEL}
              </span>
              <span className="text-[11px] font-mono truncate hidden sm:inline" style={{ color: '#6a6a86' }}>
                {selected ? selected.slug : isAdminSelected ? '_admin' : 'shared'}
              </span>
            </div>
          </div>
        </div>
        <ChevronsUpDown size={14} style={{ color: '#9090b0' }} className="shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-2 w-full overflow-hidden"
          style={{
            background:        'linear-gradient(135deg, rgba(20,20,32,0.92), rgba(12,12,22,0.94))',
            backdropFilter:    'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border:            '1px solid rgba(255,255,255,0.10)',
            borderRadius:      '14px',
            boxShadow:
              '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(108,99,255,0.10)',
          }}
        >
          {showAdmin && (
            <Option
              kind="admin"
              active={isAdminSelected}
              onClick={() => pick(ADMIN_SCOPE)}
            />
          )}
          <Option
            kind="default"
            active={!selectedSlug && !isAdminSelected}
            onClick={() => pick(null)}
            divider={showAdmin}
          />
          {empty ? (
            <div
              className="px-3.5 py-3 text-[11px] leading-snug"
              style={{ color: '#9090b0', borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              No businesses yet. Seed one in <span className="font-mono" style={{ color: '#a8a3ff' }}>/settings/businesses</span> to scope accounts per workspace.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {businesses.map((b, i) => (
                <li key={b.slug}>
                  <Option
                    kind="business"
                    business={b}
                    active={selectedSlug === b.slug}
                    onClick={() => pick(b.slug)}
                    divider={i === 0}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Option({
  kind, business, active, onClick, divider,
}: {
  kind:      'default' | 'business' | 'admin'
  business?: BusinessRow
  active:    boolean
  onClick:   () => void
  divider?:  boolean
}) {
  const isDefault = kind === 'default'
  const isAdmin   = kind === 'admin'
  const name = isAdmin   ? ADMIN_LABEL  : isDefault ? SHARED_LABEL : (business?.name ?? '')
  const slug = isAdmin   ? '_admin'     : isDefault ? 'shared'     : (business?.slug ?? '')
  const hint = isAdmin   ? ADMIN_HINT   : isDefault ? SHARED_HINT  : (business?.niche ?? '')
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
      style={{
        borderTop: divider ? '1px solid rgba(255,255,255,0.06)' : undefined,
        background: active ? 'rgba(108,99,255,0.10)' : 'transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{
          background: active
            ? 'linear-gradient(135deg, rgba(108,99,255,0.35), rgba(108,99,255,0.10))'
            : 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {isAdmin
          ? <ShieldCheck size={13} style={{ color: active ? '#a8a3ff' : '#9090b0' }} />
          : isDefault
            ? <Globe2 size={13} style={{ color: active ? '#a8a3ff' : '#9090b0' }} />
            : <Briefcase size={13} style={{ color: active ? '#a8a3ff' : '#9090b0' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{name}</span>
          <span className="text-[11px] font-mono truncate" style={{ color: '#6a6a86' }}>{slug}</span>
        </div>
        {hint && (
          <div className="text-[11px] truncate" style={{ color: '#9090b0' }}>{hint}</div>
        )}
      </div>
      {active && <Check size={14} style={{ color: '#a8a3ff' }} className="shrink-0" />}
    </button>
  )
}
