'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Activity, RefreshCw, Cpu, CheckCircle2, XCircle,
  Loader2, Clock, Zap, ListTodo, AlertCircle,
} from 'lucide-react'
import type { ClawSession } from '@/lib/types'

// ── Tab nav shared across claw sub-pages ──────────────────────────────────────
const TABS = [
  { label: 'Configure', href: '/tools/claw' },
  { label: 'Status',    href: '/tools/claw/status' },
  { label: 'Skills',    href: '/tools/claw/skills' },
]

// ── Types ─────────────────────────────────────────────────────────────────────
interface StatusData {
  configured:    boolean
  online:        boolean
  sessions:      ClawSession[]
  sessionId?:    string
  sessionStatus?: string
  currentTask?:  string
  error?:        string
}

const SESSION_STATUS_COLOR: Record<string, string> = {
  idle:      '#55556a',
  running:   '#6c63ff',
  completed: '#22c55e',
  error:     '#ef4444',
}

const SESSION_STATUS_BG: Record<string, string> = {
  idle:      'rgba(85,85,106,0.1)',
  running:   'rgba(108,99,255,0.1)',
  completed: 'rgba(34,197,94,0.1)',
  error:     'rgba(239,68,68,0.1)',
}

function StatusBadge({ status }: { status: string }) {
  const color = SESSION_STATUS_COLOR[status] ?? '#55556a'
  const bg    = SESSION_STATUS_BG[status]    ?? 'rgba(85,85,106,0.1)'
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: bg, color, border: `1px solid ${color}33` }}
    >
      {status === 'running' && <Loader2 size={10} className="animate-spin" />}
      {status === 'completed' && <CheckCircle2 size={10} />}
      {status === 'error' && <AlertCircle size={10} />}
      {status === 'idle' && <Clock size={10} />}
      {status}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClawStatusPage() {
  const [data,         setData]         = useState<StatusData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [autoRefresh,  setAutoRefresh]  = useState(true)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/claw/status')
      const json = await res.json() as StatusData
      setData(json)
      setLastRefreshed(new Date())
    } catch {
      setData({ configured: false, online: false, sessions: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchStatus() }, [fetchStatus])

  // Auto-refresh every 8 seconds when auto-refresh is on
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchStatus, 8_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchStatus])

  const runningCount   = data?.sessions.filter(s => s.status === 'running').length   ?? 0
  const completedCount = data?.sessions.filter(s => s.status === 'completed').length ?? 0

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      {/* Back nav */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-xs mb-6 no-underline"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#e8e8f0')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#9090b0')}
      >
        <ArrowLeft size={13} />
        Back to Tools
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
          >
            <Cpu size={20} style={{ color: '#6c63ff' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>OpenClaw</h1>
            <p className="text-sm" style={{ color: '#9090b0' }}>Agent status &amp; activity</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{
              backgroundColor: autoRefresh ? 'rgba(108,99,255,0.1)' : '#1a1a2e',
              color:           autoRefresh ? '#6c63ff' : '#55556a',
              border: `1px solid ${autoRefresh ? 'rgba(108,99,255,0.25)' : '#24243e'}`,
              cursor: 'pointer',
            }}
          >
            <Activity size={11} />
            {autoRefresh ? 'Auto' : 'Paused'}
          </button>
          {/* Manual refresh */}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{
              backgroundColor: '#1a1a2e',
              color: loading ? '#55556a' : '#9090b0',
              border: '1px solid #24243e',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 text-center py-2 text-sm rounded-lg no-underline font-medium transition-all"
            style={
              tab.href === '/tools/claw/status'
                ? { backgroundColor: '#1a1a2e', color: '#e8e8f0' }
                : { color: '#55556a' }
            }
            onMouseEnter={e => {
              if (tab.href !== '/tools/claw/status')
                (e.currentTarget as HTMLAnchorElement).style.color = '#9090b0'
            }}
            onMouseLeave={e => {
              if (tab.href !== '/tools/claw/status')
                (e.currentTarget as HTMLAnchorElement).style.color = '#55556a'
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Connection status */}
      {data && !data.configured && (
        <div
          className="rounded-xl p-4 mb-6 flex items-center gap-3"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <XCircle size={16} style={{ color: '#ef4444' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Not configured</p>
            <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
              Add your gateway URL and token on the{' '}
              <Link href="/tools/claw" className="no-underline" style={{ color: '#6c63ff' }}>Configure tab</Link>.
            </p>
          </div>
        </div>
      )}

      {data?.configured && (
        <div
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full mb-6"
          style={
            data.online
              ? { backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }
              : { backgroundColor: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.25)',  color: '#ef4444' }
          }
        >
          {data.online ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {data.online ? 'Gateway online' : 'Gateway unreachable'}
          {data.error && <span style={{ color: '#9090b0' }}>— {data.error}</span>}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Active agents',     value: runningCount,                     icon: <Zap size={14} />,      color: '#6c63ff' },
          { label: 'Completed sessions',value: completedCount,                   icon: <CheckCircle2 size={14}/>, color: '#22c55e' },
          { label: 'Total sessions',    value: data?.sessions.length ?? 0,       icon: <ListTodo size={14} />, color: '#9090b0' },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="rounded-xl p-4"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <div className="flex items-center gap-2 mb-1" style={{ color: kpi.color }}>
              {kpi.icon}
              <span className="text-xs font-medium" style={{ color: '#9090b0' }}>{kpi.label}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: '#e8e8f0' }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Current activity */}
      {data?.currentTask && (
        <div
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={13} className="animate-spin" style={{ color: '#6c63ff' }} />
            <span className="text-xs font-semibold" style={{ color: '#6c63ff' }}>Currently executing</span>
          </div>
          <p className="text-sm" style={{ color: '#e8e8f0' }}>{data.currentTask}</p>
        </div>
      )}

      {/* Session table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #1a1a2e' }}>
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Agent Sessions</h2>
        </div>

        {(!data || data.sessions.length === 0) ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: '#55556a' }}>
              {loading ? 'Loading sessions…' : 'No sessions found. Dispatch a task from Forge to create one.'}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#1a1a2e' }}>
            {data.sessions.map(session => (
              <div
                key={session.id}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}
                  >
                    <Cpu size={14} style={{ color: '#6c63ff' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
                      {session.name}
                    </p>
                    <p className="text-xs font-mono truncate" style={{ color: '#55556a' }}>
                      {session.id}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {session.currentTask && (
                    <p className="text-xs max-w-[220px] truncate hidden md:block" style={{ color: '#9090b0' }}>
                      {session.currentTask}
                    </p>
                  )}
                  {session.phase !== undefined && (
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}>
                      Phase {session.phase}
                    </span>
                  )}
                  <StatusBadge status={session.status} />
                  {session.lastEventAt && (
                    <span className="text-xs hidden lg:block" style={{ color: '#55556a' }}>
                      {new Date(session.lastEventAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Last refreshed */}
      {lastRefreshed && (
        <p className="mt-3 text-xs text-right" style={{ color: '#55556a' }}>
          Last updated {lastRefreshed.toLocaleTimeString()}
          {autoRefresh && ' · auto-refreshing every 8s'}
        </p>
      )}
    </div>
  )
}
