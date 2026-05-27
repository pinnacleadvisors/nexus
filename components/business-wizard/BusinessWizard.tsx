'use client'

/**
 * BusinessWizard — multi-step "spin up a new business" UI.
 *
 * Replaces the redirect-to-chat behaviour of /businesses/new. Operator
 * walks through 4 steps + a review screen:
 *
 *   1. Inspiration & basics  — slug + name + optional inspiration URL
 *      (when set, the analyze-inspiration API pre-fills steps 2-3)
 *   2. Money model           — pricing + targets + audience
 *   3. Brand voice           — voice description + approval gates
 *   4. Review                — pre-flight checklist + Create
 *
 * On Create, posts to /api/businesses/wizard/create which inserts a
 * `simulation=true` business row. Operator graduates to production from
 * /businesses/<slug> once the pre-flight checklist goes green.
 *
 * Why this exists alongside the chat flow:
 *   - The chat flow is great for messy / open-ended inputs but slow.
 *   - For "I know what I want, just spin it up" the wizard is 2 min
 *     vs ~5 min of LLM round-trips.
 *   - Inspiration-URL pre-fill removes most typing — paste a competitor
 *     home page, get sane defaults, confirm.
 *
 * Phase H2 from session 2026-05-27. Companion routes:
 *   - POST /api/businesses/wizard/analyze-inspiration
 *   - POST /api/businesses/wizard/create
 */

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2, ArrowLeft, ArrowRight, Sparkles, Globe, Wand2,
  CheckCircle2, AlertCircle, MessageSquare,
} from 'lucide-react'

type MoneyModelKind = 'subscription' | 'one_off' | 'affiliate' | 'ads' | 'service' | 'unknown'

interface Suggested {
  niche:        string
  brand_voice:  string
  money_model:  MoneyModelKind
  price_hint:   string | null
  audience:     string | null
}

interface InspirationResp {
  ok: boolean
  inspiration?: {
    url:         string
    title:       string | null
    description: string | null
    suggested:   Suggested
    signals:     string[]
    warnings:    string[]
  }
  error?: string
  hint?:  string
}

interface FormState {
  inspiration_url: string
  slug:            string
  name:            string
  niche:           string
  brand_voice:     string
  money_model:     MoneyModelKind
  price_hint:      string
  audience:        string
  kpi_signups:     string
  kpi_mrr:         string
  kpi_content:     string
  approval_gates:  string[]
}

const DEFAULT_FORM: FormState = {
  inspiration_url: '',
  slug:            '',
  name:            '',
  niche:           '',
  brand_voice:     '',
  money_model:     'unknown',
  price_hint:      '',
  audience:        '',
  kpi_signups:     '',
  kpi_mrr:         '',
  kpi_content:     '',
  approval_gates:  ['real_money_movement', 'customer_outreach', 'public_publish', 'destructive_infra'],
}

const ALL_GATES: Array<{ id: string; label: string; desc: string }> = [
  { id: 'real_money_movement', label: 'Real money movement',   desc: 'Stripe payouts, refunds, transfers' },
  { id: 'customer_outreach',   label: 'Customer outreach',     desc: 'Outbound emails, DMs, ads to real people' },
  { id: 'public_publish',      label: 'Public publish',        desc: 'Posts to social channels, blog, video platforms' },
  { id: 'destructive_infra',   label: 'Destructive infra',     desc: 'Delete container, drop tables, revoke connector' },
  { id: 'niche_pick',          label: 'Niche pivot',           desc: 'Switching the business niche or audience entirely' },
  { id: 'pricing_change',      label: 'Pricing change',        desc: 'Changing the entry-tier price or model' },
]

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export default function BusinessWizard() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)
  const [inspiration, setInspiration] = useState<InspirationResp['inspiration'] | null>(null)
  const [inspirationBusy, setInspirationBusy] = useState(false)

  const updateField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(prev => ({ ...prev, [k]: v }))
  }, [])

  // When the operator types a name and slug is blank, auto-derive the slug.
  const autoSlugFromName = useCallback((name: string) => {
    setForm(prev => prev.slug ? prev : { ...prev, slug: slugify(name) })
  }, [])

  async function analyzeInspiration() {
    if (!form.inspiration_url.trim()) return
    setInspirationBusy(true)
    setErr(null)
    try {
      const res  = await fetch('/api/businesses/wizard/analyze-inspiration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.inspiration_url.trim() }),
      })
      const body = await res.json() as InspirationResp
      if (!body.ok || !body.inspiration) {
        setErr(body.hint ?? body.error ?? 'analysis failed')
        return
      }
      setInspiration(body.inspiration)
      // Pre-fill fields if they're still empty
      const s = body.inspiration.suggested
      setForm(prev => ({
        ...prev,
        niche:       prev.niche       || s.niche,
        brand_voice: prev.brand_voice || s.brand_voice,
        money_model: prev.money_model === 'unknown' ? s.money_model : prev.money_model,
        price_hint:  prev.price_hint  || (s.price_hint ?? ''),
        audience:    prev.audience    || (s.audience ?? ''),
      }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'analysis failed')
    } finally {
      setInspirationBusy(false)
    }
  }

  async function submitCreate() {
    setBusy(true); setErr(null)
    try {
      const kpi: Record<string, number> = {}
      if (form.kpi_signups) kpi.signups_90d        = Number(form.kpi_signups)
      if (form.kpi_mrr)     kpi.mrr_90d            = Number(form.kpi_mrr)
      if (form.kpi_content) kpi.content_shipped_90d = Number(form.kpi_content)
      const res = await fetch('/api/businesses/wizard/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug:            form.slug,
          name:            form.name,
          niche:           form.niche,
          brand_voice:     form.brand_voice || null,
          money_model:     form.money_model,
          price_hint:      form.price_hint  || null,
          audience:        form.audience    || null,
          inspiration_url: form.inspiration_url || null,
          kpi_targets:     kpi,
          approval_gates:  form.approval_gates,
        }),
      })
      const body = await res.json() as { ok: boolean; slug?: string; redirect?: string; error?: string; hint?: string }
      if (!body.ok) {
        setErr(body.hint ?? body.error ?? 'create failed')
        return
      }
      router.push(body.redirect ?? `/businesses/${body.slug}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed')
    } finally {
      setBusy(false)
    }
  }

  const canAdvanceFrom1 = form.slug.length > 0 && form.name.length > 0
  const canAdvanceFrom2 = form.niche.length > 0
  const canSubmit       = canAdvanceFrom1 && canAdvanceFrom2

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-10">
      <Header step={step} />
      <ErrorBanner err={err} onDismiss={() => setErr(null)} />

      {step === 1 && (
        <Step1 form={form} updateField={updateField} autoSlugFromName={autoSlugFromName}
               inspiration={inspiration} inspirationBusy={inspirationBusy} onAnalyze={analyzeInspiration} />
      )}
      {step === 2 && (
        <Step2 form={form} updateField={updateField} />
      )}
      {step === 3 && (
        <Step3 form={form} updateField={updateField} />
      )}
      {step === 4 && (
        <Step4 form={form} inspiration={inspiration} />
      )}

      <Footer
        step={step} setStep={setStep}
        canAdvance={
          step === 1 ? canAdvanceFrom1 :
          step === 2 ? canAdvanceFrom2 :
          step === 3 ? true : false
        }
        canSubmit={canSubmit}
        busy={busy}
        onSubmit={submitCreate}
      />

      <FallbackChatLink />
    </div>
  )
}

// ── Header + step indicator ────────────────────────────────────────────────

function Header({ step }: { step: number }) {
  const steps = ['Basics', 'Money model', 'Brand voice', 'Review']
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">New business — wizard</h1>
      <p className="mt-1 text-sm text-zinc-400">Lands as a <em>simulated</em> business by default — graduate to production from the business page once pre-flight passes.</p>
      <div className="mt-4 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
        {steps.map((label, i) => {
          const n = i + 1
          const active = n === step
          const done   = n < step
          return (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                active ? 'bg-violet-500/30 text-violet-200 ring-1 ring-violet-400/50'
                       : done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-500'
              }`}>{done ? '✓' : n}</span>
              <span className={active ? 'text-zinc-200' : 'text-zinc-500'}>{label}</span>
              {n < steps.length && <span className="mx-1 text-zinc-700">·</span>}
            </div>
          )
        })}
      </div>
    </header>
  )
}

function ErrorBanner({ err, onDismiss }: { err: string | null; onDismiss: () => void }) {
  if (!err) return null
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3.5 py-2.5 text-sm text-red-200">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{err}</span>
      <button type="button" onClick={onDismiss} className="text-red-300/70 hover:text-red-200" aria-label="dismiss">×</button>
    </div>
  )
}

// ── Step 1 — Inspiration + basics ─────────────────────────────────────────

function Step1({ form, updateField, autoSlugFromName, inspiration, inspirationBusy, onAnalyze }: {
  form: FormState
  updateField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  autoSlugFromName: (name: string) => void
  inspiration: InspirationResp['inspiration'] | null
  inspirationBusy: boolean
  onAnalyze: () => void
}) {
  return (
    <section className="space-y-5">
      {/* Inspiration URL — optional but the killer feature */}
      <div className="rounded-2xl border border-violet-500/20 bg-violet-950/10 p-4">
        <label className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-violet-300">
          <Sparkles size={14} /> Inspiration link <span className="font-normal normal-case text-zinc-500">(optional, pre-fills the wizard)</span>
        </label>
        <p className="mt-1 text-[11px] text-zinc-400">Paste a competitor home page, pricing page, or any site you want this business to feel like.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 relative">
            <Globe size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="url"
              value={form.inspiration_url}
              onChange={e => updateField('inspiration_url', e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-9 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none"
              disabled={inspirationBusy}
            />
          </div>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={!form.inspiration_url.trim() || inspirationBusy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-100 ring-1 ring-violet-500/30 transition hover:bg-violet-500/30 disabled:opacity-50"
          >
            {inspirationBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Analyze
          </button>
        </div>
        {inspiration && (
          <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-[11px] text-violet-100">
            <div className="font-medium text-violet-200">{inspiration.title ?? '(no title)'}</div>
            {inspiration.description && <div className="mt-1 text-violet-100/80 line-clamp-2">{inspiration.description}</div>}
            <ul className="mt-2 space-y-0.5 text-violet-200/70">
              {inspiration.signals.map((s, i) => <li key={i}>· {s}</li>)}
            </ul>
            {inspiration.warnings.length > 0 && (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/30 p-2 text-amber-200">
                {inspiration.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Name + slug */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name" required>
          <input
            type="text"
            value={form.name}
            onChange={e => { updateField('name', e.target.value); autoSlugFromName(e.target.value) }}
            placeholder="Pinnacle Studios"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none"
          />
        </Field>
        <Field label="Slug" required hint="a-z, 0-9, dash; max 60 chars">
          <input
            type="text"
            value={form.slug}
            onChange={e => updateField('slug', slugify(e.target.value))}
            placeholder="pinnacle-studios"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none"
          />
        </Field>
      </div>
    </section>
  )
}

// ── Step 2 — Money model + targets ────────────────────────────────────────

function Step2({ form, updateField }: {
  form: FormState
  updateField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
}) {
  return (
    <section className="space-y-5">
      <Field label="Niche" required hint="e.g. saas, info-products, e-commerce, service-agency">
        <input
          type="text"
          value={form.niche}
          onChange={e => updateField('niche', e.target.value)}
          placeholder="saas"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none"
        />
      </Field>
      <Field label="Money model">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(['subscription', 'one_off', 'affiliate', 'ads', 'service', 'unknown'] as const).map(m => (
            <button
              key={m} type="button"
              onClick={() => updateField('money_model', m)}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                form.money_model === m
                  ? 'border-violet-500/60 bg-violet-500/20 text-violet-100'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}>
              {m.replace('_', ' ')}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Entry-tier price" hint="e.g. $29/mo, $97 one-off, free">
          <input type="text" value={form.price_hint} onChange={e => updateField('price_hint', e.target.value)} placeholder="$29/mo"
                 className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none" />
        </Field>
        <Field label="Target audience" hint="1-2 sentences">
          <input type="text" value={form.audience} onChange={e => updateField('audience', e.target.value)} placeholder="indie devs shipping their first SaaS"
                 className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none" />
        </Field>
      </div>
      <Field label="90-day KPI targets" hint="leave blank if unsure — agents will propose targets">
        <div className="grid grid-cols-3 gap-2">
          <KpiInput label="Signups"        value={form.kpi_signups} onChange={v => updateField('kpi_signups', v)} />
          <KpiInput label="MRR ($)"        value={form.kpi_mrr}     onChange={v => updateField('kpi_mrr', v)} />
          <KpiInput label="Content posts"  value={form.kpi_content} onChange={v => updateField('kpi_content', v)} />
        </div>
      </Field>
    </section>
  )
}

function KpiInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input type="number" min={0} value={value} onChange={e => onChange(e.target.value)} placeholder="—"
             className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-700 focus:border-violet-500/60 focus:outline-none" />
    </label>
  )
}

// ── Step 3 — Brand voice + approval gates ─────────────────────────────────

function Step3({ form, updateField }: {
  form: FormState
  updateField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
}) {
  const toggleGate = (id: string) => {
    updateField('approval_gates', form.approval_gates.includes(id)
      ? form.approval_gates.filter(g => g !== id)
      : [...form.approval_gates, id])
  }
  return (
    <section className="space-y-5">
      <Field label="Brand voice" hint="2-3 sentences — what tone the agents should use">
        <textarea
          value={form.brand_voice}
          onChange={e => updateField('brand_voice', e.target.value)}
          placeholder="Direct, no-fluff, light technical humour. Avoid corporate-speak."
          rows={3}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500/60 focus:outline-none"
        />
      </Field>
      <Field label="Approval gates" hint="Operator must approve before agents perform these. The 4 defaults always-on cannot be unchecked from this wizard.">
        <div className="space-y-1.5">
          {ALL_GATES.map(g => {
            const isDefault = ['real_money_movement','customer_outreach','public_publish','destructive_infra'].includes(g.id)
            const checked = form.approval_gates.includes(g.id)
            return (
              <label key={g.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
                checked ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-950'
              }`}>
                <input type="checkbox" checked={checked} disabled={isDefault} onChange={() => toggleGate(g.id)}
                       className="mt-0.5 accent-emerald-500 disabled:opacity-50" />
                <div className="flex-1">
                  <div className="text-zinc-100">{g.label}{isDefault && <span className="ml-2 text-[10px] uppercase text-emerald-400">always-on</span>}</div>
                  <div className="text-zinc-500">{g.desc}</div>
                </div>
              </label>
            )
          })}
        </div>
      </Field>
    </section>
  )
}

// ── Step 4 — Review + create ──────────────────────────────────────────────

function Step4({ form, inspiration }: {
  form: FormState
  inspiration: InspirationResp['inspiration'] | null
}) {
  const checks = useMemo(() => [
    { label: 'Slug + name set',           pass: !!(form.slug && form.name) },
    { label: 'Niche set',                  pass: !!form.niche },
    { label: 'Money model picked',         pass: form.money_model !== 'unknown' },
    { label: 'Approval gates ≥ 4',         pass: form.approval_gates.length >= 4 },
    { label: 'Brand voice provided',       pass: !!form.brand_voice },
    { label: 'KPI targets at least one',   pass: !!(form.kpi_signups || form.kpi_mrr || form.kpi_content) },
  ], [form])

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-emerald-300">
          <CheckCircle2 size={14} /> Pre-flight checklist
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">Lands as <strong className="text-emerald-300">simulated</strong> on click. Graduate to production from /businesses/{form.slug || '<slug>'} once you&apos;ve verified agent behaviour under the simulation harness.</p>
        <ul className="mt-3 space-y-1.5">
          {checks.map(c => (
            <li key={c.label} className="flex items-center gap-2 text-[12px]">
              {c.pass
                ? <CheckCircle2 size={12} className="text-emerald-400" />
                : <span className="inline-block h-3 w-3 rounded-full border border-zinc-700" />}
              <span className={c.pass ? 'text-zinc-200' : 'text-zinc-500'}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Summary label="Slug">              <code className="text-violet-200">{form.slug || '—'}</code></Summary>
        <Summary label="Name">               {form.name || '—'}</Summary>
        <Summary label="Niche">              {form.niche || '—'}</Summary>
        <Summary label="Money model">        {form.money_model.replace('_', ' ')}</Summary>
        {form.price_hint && <Summary label="Entry-tier price">{form.price_hint}</Summary>}
        {form.audience   && <Summary label="Audience">{form.audience}</Summary>}
        {form.brand_voice && <Summary label="Brand voice" full>{form.brand_voice}</Summary>}
        {(form.kpi_signups || form.kpi_mrr || form.kpi_content) && (
          <Summary label="KPI 90d" full>
            {[
              form.kpi_signups ? `Signups: ${form.kpi_signups}` : '',
              form.kpi_mrr     ? `MRR: $${form.kpi_mrr}` : '',
              form.kpi_content ? `Content posts: ${form.kpi_content}` : '',
            ].filter(Boolean).join(' · ')}
          </Summary>
        )}
        <Summary label="Approval gates" full>{form.approval_gates.join(' · ')}</Summary>
        {inspiration && <Summary label="Inspiration" full>{inspiration.url}</Summary>}
      </div>
    </section>
  )
}

function Summary({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-[12px] ${full ? 'sm:col-span-2' : ''}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-zinc-100">{children}</div>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-zinc-300">
        {label}{required && <span className="ml-1 text-red-400">*</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[11px] text-zinc-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  )
}

// ── Footer (nav + submit) ─────────────────────────────────────────────────

function Footer({ step, setStep, canAdvance, canSubmit, busy, onSubmit }: {
  step: 1 | 2 | 3 | 4
  setStep: (n: 1 | 2 | 3 | 4) => void
  canAdvance: boolean
  canSubmit:  boolean
  busy: boolean
  onSubmit: () => void
}) {
  const isLast = step === 4
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}
        disabled={step === 1 || busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 disabled:opacity-30"
      >
        <ArrowLeft size={14} /> Back
      </button>
      {isLast ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Create as simulated business
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}
          disabled={!canAdvance || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-100 ring-1 ring-violet-500/30 transition hover:bg-violet-500/30 disabled:opacity-50"
        >
          Next <ArrowRight size={14} />
        </button>
      )}
    </div>
  )
}

function FallbackChatLink() {
  return (
    <p className="mt-10 text-center text-[11px] text-zinc-500">
      Prefer a chat-driven flow?{' '}
      <Link href="/manage-platform?prompt=I%20want%20to%20create%20a%20new%20business.%20Please%20invoke%20the%20create-business%20agent%20and%20walk%20me%20through%20the%20consultation." className="text-violet-400 hover:text-violet-300">
        <MessageSquare size={11} className="inline" /> Start consultation in chat
      </Link>
    </p>
  )
}
