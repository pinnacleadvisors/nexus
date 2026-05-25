'use client'

/**
 * /teams "Templates" panel — list saved org-chart templates + a save-as
 * form + a spawn-from-template picker.
 *
 * v4 UX is intentionally compact — one row per template, three icons
 * (info, spawn-to-business, delete-later). Picker for spawn target is
 * an inline select; spawn calls the dedicated route.
 */

import { useEffect, useState } from 'react'
import { Loader2, Bookmark, Save, Sparkles, AlertCircle, X } from 'lucide-react'
import type { BusinessRow } from '@/lib/business/types'

interface TemplateRow {
  id:         string
  name:       string
  niche:      string | null
  blueprint:  { teams: Array<{ department: string }> }
  created_at: string
}

export default function TemplatesPanel({ businesses }: { businesses: BusinessRow[] }) {
  const [open,        setOpen]       = useState(false)
  const [loaded,      setLoaded]     = useState(false)
  const [templates,   setTemplates]  = useState<TemplateRow[]>([])
  const [loading,     setLoading]    = useState(false)
  const [busy,        setBusy]       = useState<string | null>(null)
  const [err,         setErr]        = useState<string | null>(null)
  // Save-form state
  const [saveBiz,     setSaveBiz]    = useState(businesses[0]?.slug ?? '')
  const [saveName,    setSaveName]   = useState('')
  // Spawn-target picker (per template id)
  const [spawnTarget, setSpawnTarget] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/teams/templates')
      const json = (await res.json()) as { ok: boolean; templates?: TemplateRow[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setTemplates(json.templates ?? [])
      setLoaded(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (open && !loaded) void load()
  }, [open, loaded])

  async function saveTemplate() {
    if (!saveBiz || !saveName.trim()) { setErr('Pick a business + give the template a name.'); return }
    setBusy('save'); setErr(null)
    try {
      const res = await fetch('/api/teams/templates', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ businessSlug: saveBiz, name: saveName.trim() }),
      })
      const json = (await res.json()) as { ok: boolean; template?: TemplateRow; error?: string }
      if (!json.ok || !json.template) throw new Error(json.error || 'save failed')
      setTemplates(prev => [json.template!, ...prev])
      setSaveName('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally { setBusy(null) }
  }

  async function spawnFromTemplate(template: TemplateRow) {
    const target = spawnTarget[template.id]
    if (!target) { setErr('Pick a target business first.'); return }
    setBusy(template.id); setErr(null)
    try {
      const res = await fetch('/api/teams/spawn-from-template', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ templateId: template.id, businessSlug: target }),
      })
      const json = (await res.json()) as { ok: boolean; teams?: unknown[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'spawn failed')
      // Hard reload so /teams re-fetches the freshly-spawned teams.
      if (typeof window !== 'undefined') window.location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'spawn failed')
    } finally { setBusy(null) }
  }

  return (
    <section className="p-3.5"
             style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.05), rgba(255,255,255,0.01))',
                      border: '1px solid rgba(245,158,11,0.18)', borderRadius: '14px' }}>
      <header className="flex items-center gap-2">
        <Bookmark size={14} style={{ color: '#fbbf24' }} />
        <span className="text-sm" style={{ color: '#e8e8f0' }}>Org-chart templates</span>
        <button onClick={() => setOpen(o => !o)}
                className="ml-auto text-[11px] px-2 py-0.5 rounded-md"
                style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {open ? 'collapse' : 'expand'}
        </button>
      </header>

      {open && (
        <div className="mt-3 space-y-3">
          {err && (
            <div className="px-2.5 py-1.5 flex items-start gap-2 text-xs rounded-md"
                 style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#e8e8f0' }}>
              <AlertCircle size={12} style={{ color: '#f87171' }} />
              <div className="flex-1">{err}</div>
              <button onClick={() => setErr(null)} style={{ color: '#9090b0' }}><X size={10} /></button>
            </div>
          )}

          {/* Save-as-template form */}
          <div className="flex flex-wrap items-stretch gap-2">
            <select value={saveBiz} onChange={e => setSaveBiz(e.target.value)}
                    className="text-[11px] px-2 py-1 rounded-md font-mono"
                    style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.10)' }}>
              {businesses.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
            </select>
            <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter' && !busy) void saveTemplate() }}
                   placeholder="template name (e.g. SaaS starter)"
                   className="flex-1 min-w-[180px] text-[11px] px-2 py-1 rounded-md"
                   style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.10)' }} />
            <button type="button" onClick={() => void saveTemplate()} disabled={busy === 'save'}
                    className="text-[11px] px-2.5 py-1 rounded-md inline-flex items-center gap-1.5"
                    style={{ color: '#e8e8f0', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.30)' }}>
              {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save current as template
            </button>
          </div>

          {/* Templates list */}
          {loading ? (
            <div className="text-xs flex items-center gap-1.5" style={{ color: '#9090b0' }}>
              <Loader2 size={11} className="animate-spin" /> loading…
            </div>
          ) : templates.length === 0 ? (
            <div className="text-xs" style={{ color: '#9090b0' }}>No templates yet. Save your first one above.</div>
          ) : (
            <ul className="space-y-1.5">
              {templates.map(t => (
                <li key={t.id} className="rounded-md px-2.5 py-1.5 flex items-center flex-wrap gap-2"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs" style={{ color: '#e8e8f0' }}>{t.name}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: '#9090b0' }}>
                      {t.blueprint.teams.length} dept{t.blueprint.teams.length === 1 ? '' : 's'}
                      {t.niche && <> · <span className="font-mono" style={{ color: '#a8a3ff' }}>{t.niche}</span></>}
                    </div>
                  </div>
                  <select value={spawnTarget[t.id] ?? ''} onChange={e => setSpawnTarget(prev => ({ ...prev, [t.id]: e.target.value }))}
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
                          style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.10)' }}>
                    <option value="">— spawn into… —</option>
                    {businesses.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                  </select>
                  <button type="button" onClick={() => void spawnFromTemplate(t)} disabled={busy === t.id || !spawnTarget[t.id]}
                          className="text-[10px] px-2 py-0.5 rounded-md inline-flex items-center gap-1 disabled:opacity-40"
                          style={{ color: '#e8e8f0', background: 'rgba(108,99,255,0.10)', border: '1px solid rgba(108,99,255,0.30)' }}>
                    {busy === t.id ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                    spawn
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
