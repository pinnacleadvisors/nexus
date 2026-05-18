'use client'

/**
 * BusinessCard — one liquid-glass card per business on /settings/businesses.
 * Status select, Slack channel + webhook (with test button), JSON config
 * preview, and a link to the per-business board. Split from the page file to
 * stay under the 300-line write-size cap.
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2, Loader2, ChevronDown, ChevronRight, ExternalLink, Send, AlertCircle,
} from 'lucide-react'
import type { BusinessRow, BusinessStatus } from '@/lib/business/types'

interface BusinessCardProps {
  row: BusinessRow
  slackWarning?: string
  slackVerified?: boolean
  verifying?: boolean
  onPatch: (patch: Partial<BusinessRow>, opts?: { forceSlackVerify?: boolean }) => void
}

const STATUS_STYLES: Record<BusinessStatus, { fg: string; bg: string; bd: string }> = {
  active:   { fg: '#4ade80', bg: 'rgba(34,197,94,0.10)',  bd: 'rgba(34,197,94,0.22)'  },
  paused:   { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)', bd: 'rgba(251,191,36,0.22)' },
  archived: { fg: '#9090b0', bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.08)' },
}

export function BusinessCard({ row, slackWarning, slackVerified, verifying, onPatch }: BusinessCardProps) {
  const [showJson, setShowJson] = useState(false)
  const stStyle = STATUS_STYLES[row.status]
  return (
    <div className="p-4 flex flex-col gap-3"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '16px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
      }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold" style={{ color: '#e8e8f0' }}>{row.name}</h3>
            <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] font-mono tracking-[0.12em]"
              style={{ background: stStyle.bg, border: `1px solid ${stStyle.bd}`, borderRadius: '999px', color: stStyle.fg }}>
              <span className="w-1 h-1 rounded-full" style={{ background: stStyle.fg }} />
              {row.status.toUpperCase()}
            </span>
          </div>
          <p className="text-[11px] mt-0.5 font-mono" style={{ color: '#9090b0' }}>
            <span style={{ color: '#a8a3ff' }}>{row.slug}</span>
            <span style={{ color: '#55556a' }}> · </span>
            <span>{row.niche}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={row.status}
            onChange={e => onPatch({ status: e.target.value as BusinessStatus })}
            className="text-[11px] px-2 py-1.5 rounded-md font-mono"
            style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
          <Link href={`/board?business=${encodeURIComponent(row.slug)}`}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1.5 rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}>
            Board <ExternalLink size={10} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <FormField label="Slack channel">
          <input type="text" defaultValue={row.slack_channel ?? ''}
            placeholder="#nexus-channel"
            onBlur={e => {
              const v = e.target.value.trim() || null
              if (v !== row.slack_channel) onPatch({ slack_channel: v })
            }}
            className="w-full rounded-md px-2 py-1.5 text-xs"
            style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0', outline: 'none' }} />
        </FormField>
        <FormField label="Slack webhook URL">
          <input type="password" defaultValue={row.slack_webhook_url ?? ''}
            placeholder="https://hooks.slack.com/services/..."
            onBlur={e => {
              const v = e.target.value.trim() || null
              if (v !== row.slack_webhook_url) onPatch({ slack_webhook_url: v })
            }}
            className="w-full rounded-md px-2 py-1.5 text-xs font-mono"
            style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0', outline: 'none' }} />
        </FormField>
      </div>

      {slackWarning && (
        <div className="text-[11px] flex items-start gap-1.5"
          style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)', borderRadius: '8px', padding: '6px 8px' }}>
          <AlertCircle size={11} style={{ marginTop: 2 }} />
          <span className="flex-1">{slackWarning}{' '}
            <button type="button"
              onClick={() => onPatch({ slack_webhook_url: row.slack_webhook_url }, { forceSlackVerify: true })}
              className="underline">Retry</button>
          </span>
        </div>
      )}

      {!slackWarning && row.slack_webhook_url && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          {slackVerified
            ? <span style={{ color: '#4ade80' }} className="inline-flex items-center gap-1"><CheckCircle2 size={11} /> Verification message sent to Slack</span>
            : <span style={{ color: '#9090b0' }}>Webhook saved — send a test to confirm</span>}
          <button type="button" disabled={verifying}
            onClick={() => onPatch({ slack_webhook_url: row.slack_webhook_url }, { forceSlackVerify: true })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md disabled:opacity-50"
            style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {verifying ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
            {verifying ? 'Sending…' : 'Send test'}
          </button>
        </div>
      )}

      <button type="button" onClick={() => setShowJson(s => !s)}
        className="flex items-center gap-1.5 text-[11px] self-start" style={{ color: '#a8a3ff' }}>
        {showJson ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{showJson ? 'Hide JSON config' : 'JSON config (read-only)'}</span>
      </button>
      {showJson && <JsonPreview row={row} />}

      <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-wider pt-2 border-t" style={{ color: '#55556a', borderColor: 'rgba(255,255,255,0.06)' }}>
        <span>tz {row.timezone}</span>
        <span style={{ color: '#55556a' }}>·</span>
        <span>cron {row.daily_cron_local_hour}:00</span>
        <span style={{ color: '#55556a' }}>·</span>
        <span>gates <span style={{ color: '#a8a3ff' }}>{row.approval_gates.length}</span></span>
        <span style={{ color: '#55556a' }}>·</span>
        <span>last run <span style={{ color: '#9090b0' }}>{row.last_operator_at ? new Date(row.last_operator_at).toLocaleString() : 'never'}</span></span>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: '#9090b0' }}>{label}</span>
      {children}
    </label>
  )
}

function JsonPreview({ row }: { row: BusinessRow }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <pre className="overflow-x-auto rounded-lg p-2 text-[10px] leading-relaxed font-mono"
        style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.06)', color: '#9090b0' }}>
        money_model:{'\n'}{JSON.stringify(row.money_model, null, 2)}
      </pre>
      <pre className="overflow-x-auto rounded-lg p-2 text-[10px] leading-relaxed font-mono"
        style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.06)', color: '#9090b0' }}>
        kpi_targets:{'\n'}{JSON.stringify(row.kpi_targets, null, 2)}
      </pre>
    </div>
  )
}
