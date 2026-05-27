'use client'

/**
 * NotificationsPanel — R4 of the UX consultation. Operator picks which
 * notification categories fire on which channels.
 *
 * Mounted at /settings → Alerts tab. Reads + writes
 * `notification_settings` via GET/PATCH /api/notifications/settings.
 * Test button fires a real notification via POST /api/notifications/test
 * so the operator can verify the channel before relying on it.
 *
 * Two channels: Slack (DM in operator-chosen channel, default #approvals)
 * and Web Push (browser-native; requires VAPID keys + per-browser opt-in).
 *
 * 5 categories: approval-pending, kill-switch, graduation, security-alert,
 * weekly-digest. Defaults are operator-friendly (most critical-severity
 * categories ship pre-enabled on both channels).
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Bell, MessageSquare, Smartphone, Check, X, Loader2, AlertTriangle } from 'lucide-react'

type Channel = 'slack' | 'webpush'
type Category = 'approval-pending' | 'kill-switch' | 'graduation' | 'security-alert' | 'weekly-digest'

interface SettingsResponse {
  ok:                  boolean
  settings?:           Array<{ channel: Channel; category: Category; enabled: boolean }>
  categories?:         Category[]
  channels?:           Channel[]
  vapid_public_key?:   string | null
  webpush_configured?: boolean
  error?:              string
}

const CATEGORY_LABEL: Record<Category, string> = {
  'approval-pending': 'Approval needed',
  'kill-switch':      'Cost-guard kill',
  'graduation':       'Business graduated',
  'security-alert':   'Security alert',
  'weekly-digest':    'Weekly digest',
}

const CATEGORY_HINT: Record<Category, string> = {
  'approval-pending': 'New approval row lands and is waiting on your decision.',
  'kill-switch':      'Cost-guard fired on a business — spend was about to breach the daily cap.',
  'graduation':       'A simulation business flipped to real-money mode (simulation=false).',
  'security-alert':   'Security-relevant event from `audit_events` or the alerts panel.',
  'weekly-digest':    'Sunday 9 AM operator-local — what every business did this week (R6).',
}

const CATEGORIES_DEFAULT: Category[] = [
  'approval-pending', 'kill-switch', 'graduation', 'security-alert', 'weekly-digest',
]
const CHANNELS_DEFAULT: Channel[] = ['slack', 'webpush']

const DEFAULT_ENABLED: Record<Category, Channel[]> = {
  'approval-pending':  ['slack', 'webpush'],
  'kill-switch':       ['slack', 'webpush'],
  'graduation':        ['slack'],
  'security-alert':    ['slack', 'webpush'],
  'weekly-digest':     ['slack'],
}

export default function NotificationsPanel() {
  const [resp, setResp]       = useState<SettingsResponse | null>(null)
  const [pending, startTx]    = useTransition()
  const [test, setTest]       = useState<{ channel: Channel; status: 'idle' | 'sending' | 'ok' | 'error'; message?: string } | null>(null)

  const load = async () => {
    try {
      const r = await fetch('/api/notifications/settings', { cache: 'no-store' })
      const b = await r.json() as SettingsResponse
      setResp(b)
    } catch (err) {
      setResp({ ok: false, error: err instanceof Error ? err.message : 'load failed' })
    }
  }

  useEffect(() => { void load() }, [])

  // Build the enabled map from DB rows + defaults. Any row in `settings`
  // overrides the default; missing rows fall back to DEFAULT_ENABLED.
  const enabledMap = useMemo(() => {
    const m = new Map<string, boolean>()
    // Seed with defaults
    for (const cat of CATEGORIES_DEFAULT) {
      const defaults = new Set(DEFAULT_ENABLED[cat])
      for (const ch of CHANNELS_DEFAULT) {
        m.set(`${cat}|${ch}`, defaults.has(ch))
      }
    }
    // Apply DB overrides
    for (const row of resp?.settings ?? []) {
      m.set(`${row.category}|${row.channel}`, row.enabled)
    }
    return m
  }, [resp?.settings])

  const toggle = (category: Category, channel: Channel) => {
    const key = `${category}|${channel}`
    const next = !enabledMap.get(key)
    // Optimistic
    enabledMap.set(key, next)
    // Mutate the response shallowly so the render reflects immediately
    setResp(prev => prev ? {
      ...prev,
      settings: [
        ...(prev.settings ?? []).filter(r => !(r.category === category && r.channel === channel)),
        { category, channel, enabled: next },
      ],
    } : prev)
    startTx(async () => {
      try {
        const r = await fetch('/api/notifications/settings', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ category, channel, enabled: next }),
        })
        const b = await r.json() as { ok: boolean; error?: string; hint?: string }
        if (!b.ok) {
          // Revert + show error
          enabledMap.set(key, !next)
          setResp(prev => prev ? { ...prev, error: b.hint ?? b.error ?? 'flip failed' } : prev)
        }
      } catch (err) {
        enabledMap.set(key, !next)
        setResp(prev => prev ? { ...prev, error: err instanceof Error ? err.message : 'flip failed' } : prev)
      }
    })
  }

  const sendTest = async (channel: Channel) => {
    setTest({ channel, status: 'sending' })
    try {
      const r = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ channel }),
      })
      const b = await r.json() as { ok: boolean; results?: Array<{ ok: boolean; error?: string; skipped?: string }> }
      const first = b.results?.[0]
      if (b.ok) {
        setTest({ channel, status: 'ok', message: `${channel} delivered — check your ${channel === 'slack' ? 'Slack channel' : 'browser'}.` })
      } else {
        const reason = first?.skipped ?? first?.error ?? 'unknown'
        setTest({ channel, status: 'error', message: reason })
      }
    } catch (err) {
      setTest({ channel, status: 'error', message: err instanceof Error ? err.message : 'network error' })
    }
  }

  if (!resp) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
        <Loader2 className="inline h-3 w-3 animate-spin" /> Loading notification settings…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Notifications</h3>
      </header>

      <p className="mb-3 text-xs text-zinc-400">
        Pick which categories fire on each channel. Slack DMs the
        operator-chosen channel (default <code className="font-mono text-zinc-300">#approvals</code>); web push lights up
        the browser when the page is in the background.
      </p>

      {!resp.webpush_configured && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>
            <strong>Web push is unconfigured.</strong> Generate VAPID keys via <code className="font-mono">npx web-push generate-vapid-keys</code> and set <code className="font-mono">VAPID_PUBLIC_KEY</code> + <code className="font-mono">VAPID_PRIVATE_KEY</code> + <code className="font-mono">VAPID_CONTACT_EMAIL</code> in Doppler. Slack DMs already work.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          <span>Category</span>
          <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Slack</span>
          <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" /> Push</span>
        </div>
        {CATEGORIES_DEFAULT.map(cat => (
          <div
            key={cat}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-200">{CATEGORY_LABEL[cat]}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">{CATEGORY_HINT[cat]}</div>
            </div>
            <ToggleCheck
              checked={Boolean(enabledMap.get(`${cat}|slack`))}
              onChange={() => toggle(cat, 'slack')}
              disabled={pending}
            />
            <ToggleCheck
              checked={Boolean(enabledMap.get(`${cat}|webpush`))}
              onChange={() => toggle(cat, 'webpush')}
              disabled={pending}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Test the channels:</span>
        <button
          type="button"
          onClick={() => sendTest('slack')}
          disabled={test?.status === 'sending'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800/70 disabled:opacity-50"
        >
          {test?.channel === 'slack' && test?.status === 'sending'
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <MessageSquare className="h-3 w-3" />}
          Slack
        </button>
        <button
          type="button"
          onClick={() => sendTest('webpush')}
          disabled={test?.status === 'sending'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800/70 disabled:opacity-50"
        >
          {test?.channel === 'webpush' && test?.status === 'sending'
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Smartphone className="h-3 w-3" />}
          Browser push
        </button>
      </div>

      {test?.status === 'ok' && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-300">
          <Check className="h-3 w-3" /> {test.message}
        </p>
      )}
      {test?.status === 'error' && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-rose-300">
          <X className="h-3 w-3" /> {test.channel} failed: {test.message}
        </p>
      )}
      {resp.error && (
        <p className="mt-2 text-xs text-rose-300">{resp.error}</p>
      )}
    </div>
  )
}

function ToggleCheck({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      className="inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: checked ? 'rgba(108,99,255,0.40)' : 'rgba(255,255,255,0.06)',
        border:     `1px solid ${checked ? 'rgba(108,99,255,0.60)' : 'rgba(255,255,255,0.12)'}`,
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
        style={{ transform: `translateX(${checked ? 18 : 3}px)` }}
      />
    </button>
  )
}
