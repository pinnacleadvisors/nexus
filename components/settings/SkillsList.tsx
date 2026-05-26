'use client'

/**
 * SkillsList — body for Settings → Skills tab.
 *
 * Lists every skill installed at .claude/skills/<name>/SKILL.md. Each row
 * shows the slug, the operator-friendly name, the description from the
 * frontmatter, and a status pill (verified vs draft).
 *
 * Hand-curated skills land as `verified`; the `skill-trainer` agent's
 * auto-generated outputs land as `draft` and await operator promotion. The
 * Promote button in this list calls POST /api/skills/[slug]/promote which
 * flips `status: draft → verified` in the SKILL.md frontmatter on disk —
 * operator commits + redeploys for the change to persist past container
 * rebuilds (the SKILL.md tree lives in `.claude/skills/` which is built
 * into the image, not mounted).
 *
 * Lean-mode Task 17 follow-up (task_plan-lean-mode.md "Board UI integration
 * for skill promote" remaining item). Lives in the Settings → Skills tab
 * instead of the Board ReviewModal — closer to where draft skills naturally
 * surface and matches the per-skill model-recommend affordance from PR #388.
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Loader2, AlertCircle, CheckCircle2, FileText, Sparkles, Wand2, X, ShieldCheck } from 'lucide-react'

interface SkillRow {
  slug:           string
  name:           string
  description:    string
  status:         'draft' | 'verified'
  hasContent:     boolean
  sizeBytes:      number
  updatedAt:      string | null
  model:          string | null   // resolved (override OR frontmatter default)
  modelDefault:   string | null
  modelOverridden: boolean
  modelRationale: string | null
}

interface SkillsResponse {
  skills:   SkillRow[]
  warning?: string
}

function formatBytes(n: number): string {
  if (n < 1024)        return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const t   = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(0, Math.round((now - t) / 1000))
  if (sec < 60)         return `${sec}s ago`
  if (sec < 3600)       return `${Math.round(sec / 60)}m ago`
  if (sec < 86_400)     return `${Math.round(sec / 3600)}h ago`
  if (sec < 86_400 * 30) return `${Math.round(sec / 86_400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function SkillsList() {
  const [skills,  setSkills]  = useState<SkillRow[]>([])
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)
  const [busyRec, setBusyRec] = useState<Record<string, boolean>>({})
  const [busyPromote, setBusyPromote] = useState<Record<string, boolean>>({})
  const [, startTx]           = useTransition()

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/skills')
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const json = await res.json() as SkillsResponse
      setSkills(json.skills)
      setWarning(json.warning ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const recommend = useCallback((skill: SkillRow) => {
    setErr(null)
    setBusyRec(p => ({ ...p, [skill.slug]: true }))
    startTx(async () => {
      try {
        const res  = await fetch('/api/models/recommend-skill', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            slug:        skill.slug,
            name:        skill.name,
            description: skill.description,
            status:      skill.status,
          }),
        })
        const body = await res.json() as { ok: boolean; recommendation?: { model: string; rationale: string }; error?: string }
        if (!body.ok || !body.recommendation) {
          setErr(body.error ?? 'recommendation failed')
          return
        }
        // Persist as the new default for this skill (Recommend = pick).
        const patch = await fetch(`/api/skills/${encodeURIComponent(skill.slug)}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            model:     body.recommendation.model,
            rationale: body.recommendation.rationale,
          }),
        })
        const patchBody = await patch.json() as { ok: boolean; error?: string }
        if (!patchBody.ok) {
          setErr(patchBody.error ?? 'save failed')
          return
        }
        await load()
      } finally {
        setBusyRec(p => ({ ...p, [skill.slug]: false }))
      }
    })
  }, [load])

  const clearOverride = useCallback((skill: SkillRow) => {
    setErr(null)
    startTx(async () => {
      const res  = await fetch(`/api/skills/${encodeURIComponent(skill.slug)}`, { method: 'DELETE' })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setErr(body.error ?? 'clear failed')
      await load()
    })
  }, [load])

  // Promote a draft skill to `verified`. The route patches SKILL.md
  // frontmatter on disk; the operator must commit + redeploy for the change
  // to outlive the next container rebuild. confirm() makes that contract
  // explicit so a stray click doesn't surprise-promote a half-baked skill.
  const promote = useCallback((skill: SkillRow) => {
    if (typeof window !== 'undefined' && !window.confirm(
      `Promote '${skill.slug}' from draft → verified?\n\nThis edits SKILL.md on disk. Commit + redeploy to persist past the next container rebuild.`,
    )) return
    setErr(null)
    setBusyPromote(p => ({ ...p, [skill.slug]: true }))
    startTx(async () => {
      try {
        const res  = await fetch(`/api/skills/${encodeURIComponent(skill.slug)}/promote`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({}),
        })
        const body = await res.json() as { ok: boolean; status?: string; error?: string }
        if (!body.ok) {
          setErr(body.error ?? 'promote failed')
          return
        }
        await load()
      } finally {
        setBusyPromote(p => ({ ...p, [skill.slug]: false }))
      }
    })
  }, [load])

  const verifiedCount = skills.filter(s => s.status === 'verified').length
  const draftCount    = skills.filter(s => s.status === 'draft').length

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm px-4 py-3"
        style={{
          color:                '#9090b0',
          background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
          backdropFilter:       'blur(20px)',
          border:               '1px solid rgba(255,255,255,0.06)',
          borderRadius:         '14px',
        }}>
        <Loader2 size={14} className="animate-spin" /> Loading skills…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>
        <span className="flex items-center gap-1.5">
          <Sparkles size={12} style={{ color: '#a8a3ff' }} />
          {skills.length} skill{skills.length === 1 ? '' : 's'}
        </span>
        <span style={{ color: '#55556a' }}>·</span>
        <span style={{ color: '#4ade80' }}>{verifiedCount} verified</span>
        {draftCount > 0 && (
          <>
            <span style={{ color: '#55556a' }}>·</span>
            <span style={{ color: '#fbbf24' }}>{draftCount} draft</span>
          </>
        )}
      </div>

      {warning && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
          style={{
            background:           'linear-gradient(135deg, rgba(251,191,36,0.10), rgba(251,191,36,0.02))',
            border:               '1px solid rgba(251,191,36,0.22)',
            borderRadius:         '14px',
            color:                '#e8e8f0',
          }}>
          <AlertCircle size={16} style={{ color: '#fbbf24', marginTop: 1 }} />
          <div className="flex-1 text-[12px]">{warning}</div>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
          style={{
            background:           'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
            border:               '1px solid rgba(239,68,68,0.22)',
            borderRadius:         '14px',
            color:                '#e8e8f0',
          }}>
          <AlertCircle size={16} style={{ color: '#f87171' }} />
          <div className="flex-1">{err}</div>
        </div>
      )}

      {skills.length === 0 && !err && (
        <div className="text-sm px-4 py-6 text-center" style={{ color: '#9090b0' }}>
          No skills found. New skills land at <code className="font-mono" style={{ color: '#a8a3ff' }}>.claude/skills/&lt;name&gt;/SKILL.md</code>.
        </div>
      )}

      {skills.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5">
          {skills.map(s => (
            <SkillCard
              key={s.slug}
              skill={s}
              busyRec={Boolean(busyRec[s.slug])}
              busyPromote={Boolean(busyPromote[s.slug])}
              onRecommend={() => recommend(s)}
              onClearOverride={() => clearOverride(s)}
              onPromote={() => promote(s)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SkillCard({ skill, busyRec, busyPromote, onRecommend, onClearOverride, onPromote }: {
  skill:           SkillRow
  busyRec:         boolean
  busyPromote:     boolean
  onRecommend:     () => void
  onClearOverride: () => void
  onPromote:       () => void
}) {
  const verified = skill.status === 'verified'
  return (
    <div className="p-3.5 flex flex-col gap-2"
      style={{
        background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        backdropFilter:       'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '14px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: verified
                ? 'linear-gradient(135deg, rgba(74,222,128,0.20), rgba(74,222,128,0.04))'
                : 'linear-gradient(135deg, rgba(251,191,36,0.20), rgba(251,191,36,0.04))',
              border: verified
                ? '1px solid rgba(74,222,128,0.20)'
                : '1px solid rgba(251,191,36,0.20)',
            }}>
            <FileText size={12} style={{ color: verified ? '#4ade80' : '#fbbf24' }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>{skill.name}</span>
              <code className="px-1.5 py-0.5 rounded font-mono text-[10px]"
                style={{ background: 'rgba(108,99,255,0.10)', color: '#a8a3ff', border: '1px solid rgba(108,99,255,0.20)' }}>
                /{skill.slug}
              </code>
            </div>
            {skill.description && (
              <p className="text-[12px] mt-1 leading-relaxed" style={{ color: '#9090b0' }}>
                {skill.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {verified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono"
              style={{ background: 'rgba(74,222,128,0.10)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.22)' }}>
              <CheckCircle2 size={10} />
              verified
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono"
                style={{ background: 'rgba(251,191,36,0.10)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.22)' }}>
                draft
              </span>
              <button
                type="button"
                onClick={onPromote}
                disabled={busyPromote}
                title="Flip SKILL.md frontmatter status: draft → verified. The skill becomes invokable by the routing layer. Commit + redeploy to persist."
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono transition"
                style={{
                  background: 'rgba(74,222,128,0.10)',
                  color:      '#86efac',
                  border:     '1px solid rgba(74,222,128,0.25)',
                  opacity:    busyPromote ? 0.5 : 1,
                }}
              >
                {busyPromote ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
                Promote
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-mono pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)', color: '#55556a' }}>
        <span>{formatBytes(skill.sizeBytes)}</span>
        <span>·</span>
        <span>updated {formatRelative(skill.updatedAt)}</span>
        <span>·</span>
        <span title={skill.modelRationale ?? (skill.model ? 'platform default from SKILL.md frontmatter' : 'no model assigned yet')}>
          model: <code style={{ color: skill.model ? '#a8a3ff' : '#55556a' }}>{skill.model ?? '(unset)'}</code>
          {skill.modelOverridden && <span className="ml-1" style={{ color: '#fbbf24' }} title="Operator override active">●</span>}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRecommend}
          disabled={busyRec}
          title="Ask the recommender to pick the best model for this skill + persist as the operator override."
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition"
          style={{
            background: 'rgba(139,92,246,0.10)',
            color:      '#c4b5fd',
            border:     '1px solid rgba(139,92,246,0.25)',
            opacity:    busyRec ? 0.5 : 1,
          }}
        >
          {busyRec ? <Loader2 size={9} className="animate-spin" /> : <Wand2 size={9} />} Recommend
        </button>
        {skill.modelOverridden && (
          <button
            type="button"
            onClick={onClearOverride}
            title="Clear operator override; revert to the frontmatter default."
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color:      '#9090b0',
              border:     '1px solid rgba(255,255,255,0.10)',
            }}
          >
            <X size={9} /> Reset
          </button>
        )}
      </div>
    </div>
  )
}
