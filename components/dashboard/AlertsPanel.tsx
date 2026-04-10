'use client'

import { useState, useEffect } from 'react'
import { Bell, Plus, Trash2, Loader2, Mail, MessageSquare } from 'lucide-react'
import type { AlertThreshold } from '@/lib/types'

const METRIC_LABELS: Record<AlertThreshold['metric'], string> = {
  daily_cost:  'Daily agent cost exceeds ($)',
  error_rate:  'Agent error rate exceeds (%)',
  agent_down:  'Agents in error state ≥',
}

export default function AlertsPanel() {
  const [thresholds, setThresholds] = useState<AlertThreshold[]>([])
  const [loading, setLoading]       = useState(true)
  const [adding, setAdding]         = useState(false)
  const [saving, setSaving]         = useState(false)

  const [form, setForm] = useState<{
    metric: AlertThreshold['metric']
    threshold: string
    channel: AlertThreshold['channel']
    destination: string
  }>({
    metric: 'daily_cost',
    threshold: '50',
    channel: 'email',
    destination: '',
  })

  useEffect(() => {
    fetch('/api/alerts')
      .then(r => r.json())
      .then(d => setThresholds(d.thresholds ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!form.destination.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'save', ...form, threshold: Number(form.threshold) }),
      })
      if (res.ok) {
        // Reload list
        const updated = await fetch('/api/alerts').then(r => r.json())
        setThresholds(updated.thresholds ?? [])
        setAdding(false)
        setForm({ metric: 'daily_cost', threshold: '50', channel: 'email', destination: '' })
      }
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch('/api/alerts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) setThresholds(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid #24243e' }}
      >
        <div className="flex items-center gap-2">
          <Bell size={15} style={{ color: '#f59e0b' }} />
          <h2 className="font-semibold" style={{ color: '#e8e8f0' }}>
            Alert Thresholds
          </h2>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#24243e')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e')}
        >
          <Plus size={12} />
          Add alert
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div
          className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3"
          style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          {/* Metric */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#9090b0' }}>Metric</label>
            <select
              value={form.metric}
              onChange={e => setForm(f => ({ ...f, metric: e.target.value as AlertThreshold['metric'] }))}
              className="w-full text-sm rounded-lg px-2.5 py-1.5 outline-none"
              style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
            >
              {Object.entries(METRIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Threshold value */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#9090b0' }}>Threshold</label>
            <input
              type="number"
              value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
              className="w-full text-sm rounded-lg px-2.5 py-1.5 outline-none"
              style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
            />
          </div>

          {/* Channel */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#9090b0' }}>Channel</label>
            <div className="flex gap-2">
              {(['email', 'slack'] as const).map(ch => (
                <button
                  key={ch}
                  onClick={() => setForm(f => ({ ...f, channel: ch }))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 justify-center transition-colors"
                  style={
                    form.channel === ch
                      ? { backgroundColor: '#1a1a2e', color: '#e8e8f0', border: '1px solid #6c63ff' }
                      : { backgroundColor: 'transparent', color: '#55556a', border: '1px solid #24243e' }
                  }
                >
                  {ch === 'email' ? <Mail size={12} /> : <MessageSquare size={12} />}
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#9090b0' }}>
              {form.channel === 'email' ? 'Email address' : 'Slack webhook URL'}
            </label>
            <input
              type={form.channel === 'email' ? 'email' : 'url'}
              value={form.destination}
              onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
              placeholder={form.channel === 'email' ? 'you@example.com' : 'https://hooks.slack.com/...'}
              className="w-full text-sm rounded-lg px-2.5 py-1.5 outline-none"
              style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
            />
          </div>

          {/* Save */}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ color: '#55556a' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.destination.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: form.destination.trim() ? '#6c63ff' : '#1a1a2e',
                color: form.destination.trim() ? '#fff' : '#55556a',
                cursor: form.destination.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              Save alert
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="px-4 py-6 flex justify-center">
          <Loader2 size={18} className="animate-spin" style={{ color: '#55556a' }} />
        </div>
      ) : thresholds.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm" style={{ color: '#55556a' }}>
          No alerts configured. Add one to get notified when costs or errors spike.
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: '#1a1a2e' }}>
          {thresholds.map(t => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#1a1a2e' }}
              >
                {t.channel === 'slack' ? (
                  <MessageSquare size={12} style={{ color: '#f59e0b' }} />
                ) : (
                  <Mail size={12} style={{ color: '#f59e0b' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>
                  {METRIC_LABELS[t.metric]} {t.threshold}
                </p>
                <p className="text-xs truncate" style={{ color: '#55556a' }}>
                  → {t.destination}
                </p>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor: t.enabled ? '#0d2e0d' : '#1a1a2e',
                  color: t.enabled ? '#22c55e' : '#55556a',
                  border: `1px solid ${t.enabled ? '#22c55e33' : '#24243e'}`,
                }}
              >
                {t.enabled ? 'on' : 'off'}
              </span>
              <button
                onClick={() => handleDelete(t.id)}
                className="shrink-0 p-1 rounded transition-colors"
                style={{ color: '#55556a' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#55556a')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
