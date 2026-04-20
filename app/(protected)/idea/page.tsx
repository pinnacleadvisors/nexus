'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lightbulb, Link2, FileText, Loader2, ArrowLeft, AlertCircle } from 'lucide-react'
import type { IdeaCard, IdeaMode } from '@/lib/types'

const IDEAS_KEY = 'nexus:ideas'

function saveIdea(card: IdeaCard) {
  try {
    const raw = localStorage.getItem(IDEAS_KEY)
    const list: IdeaCard[] = raw ? JSON.parse(raw) : []
    list.unshift(card)
    localStorage.setItem(IDEAS_KEY, JSON.stringify(list))
  } catch {
    // ignore quota
  }
}

export default function IdeaPage() {
  const router = useRouter()
  const [mode, setMode] = useState<IdeaMode | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Description mode
  const [description, setDescription] = useState('')
  const [setupBudget, setSetupBudget] = useState('')

  // Remodel mode
  const [inspirationUrl, setInspirationUrl] = useState('')
  const [twist, setTwist] = useState('')
  const [remodelBudget, setRemodelBudget] = useState('')

  async function submit() {
    setSubmitting(true)
    setError(null)

    const payload = mode === 'description'
      ? {
          mode,
          description: description.trim(),
          setupBudgetUsd: setupBudget ? Number(setupBudget) : undefined,
        }
      : {
          mode: 'remodel' as const,
          inspirationUrl: inspirationUrl.trim(),
          twist: twist.trim() || undefined,
          setupBudgetUsd: remodelBudget ? Number(remodelBudget) : undefined,
        }

    const res = await fetch('/api/idea/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? `Request failed (${res.status})`)
      setSubmitting(false)
      return
    }

    const { card } = await res.json() as { card: Omit<IdeaCard, 'id' | 'createdAt'> }
    const full: IdeaCard = {
      ...card,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    saveIdea(full)
    router.push('/idea-library')
  }

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <Lightbulb size={22} style={{ color: '#6c63ff' }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
              Idea
            </h1>
            <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
              Capture a new idea. The agent will evaluate profitability, automation potential, and steps needed.
            </p>
          </div>
        </div>

        {!mode && <ModePicker onPick={setMode} />}

        {mode && (
          <div
            className="p-6 rounded-xl border"
            style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
          >
            <button
              onClick={() => { setMode(null); setError(null) }}
              className="flex items-center gap-1.5 mb-4 text-sm"
              style={{ color: '#9090b0' }}
            >
              <ArrowLeft size={14} />
              Back
            </button>

            {mode === 'description' ? (
              <DescriptionForm
                description={description}
                setDescription={setDescription}
                budget={setupBudget}
                setBudget={setSetupBudget}
              />
            ) : (
              <RemodelForm
                url={inspirationUrl}
                setUrl={setInspirationUrl}
                twist={twist}
                setTwist={setTwist}
                budget={remodelBudget}
                setBudget={setRemodelBudget}
              />
            )}

            {error && (
              <div
                className="mt-4 p-3 rounded-lg flex items-start gap-2 text-sm"
                style={{ backgroundColor: '#2a1116', color: '#ff7a90', borderLeft: '2px solid #ff4d6d' }}
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting || !canSubmit(mode, { description, inspirationUrl })}
              className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium disabled:opacity-50"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {submitting ? 'Analysing…' : 'Analyse idea'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function canSubmit(mode: IdeaMode, { description, inspirationUrl }: { description: string; inspirationUrl: string }) {
  if (mode === 'description') return description.trim().length > 0
  return inspirationUrl.trim().length > 0
}

function ModePicker({ onPick }: { onPick: (m: IdeaMode) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ModeCard
        icon={<Link2 size={20} style={{ color: '#6c63ff' }} />}
        title="Remodel idea"
        body="Paste an existing project or business URL. The agent scrapes it, figures out how it makes money, and estimates what it'd cost to rebuild."
        onClick={() => onPick('remodel')}
      />
      <ModeCard
        icon={<FileText size={20} style={{ color: '#6c63ff' }} />}
        title="Idea from description"
        body="Describe your idea in plain English. The agent tells you whether it can be profitable and maps out the build + maintain steps."
        onClick={() => onPick('description')}
      />
    </div>
  )
}

function ModeCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left p-5 rounded-xl border transition-colors"
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6c63ff' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#24243e' }}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-semibold" style={{ color: '#e8e8f0' }}>{title}</span>
      </div>
      <p className="text-sm" style={{ color: '#9090b0' }}>{body}</p>
    </button>
  )
}

function DescriptionForm({
  description, setDescription, budget, setBudget,
}: {
  description: string
  setDescription: (s: string) => void
  budget: string
  setBudget: (s: string) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Description" required>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={6}
          placeholder="e.g. Create a TikTok shop with ultra-realistic UGC videos of a character and their pet, mixing vlogs, trends, and affiliate product showcases."
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
        />
      </Field>
      <Field label="Setup budget (USD)">
        <input
          type="number"
          value={budget}
          onChange={e => setBudget(e.target.value)}
          placeholder="200"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
        />
      </Field>
    </div>
  )
}

function RemodelForm({
  url, setUrl, twist, setTwist, budget, setBudget,
}: {
  url: string
  setUrl: (s: string) => void
  twist: string
  setTwist: (s: string) => void
  budget: string
  setBudget: (s: string) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Link to project / business" required>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/cats_of_instagram/"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
        />
      </Field>
      <Field label="Unique twist (optional)">
        <textarea
          value={twist}
          onChange={e => setTwist(e.target.value)}
          rows={3}
          placeholder="Remodel for a dog page instead."
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
        />
      </Field>
      <Field label="Setup budget (optional, USD)">
        <input
          type="number"
          value={budget}
          onChange={e => setBudget(e.target.value)}
          placeholder="100"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
        />
      </Field>
    </div>
  )
}

function Field({
  label, required, children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: '#9090b0' }}>
        {label}{required && <span style={{ color: '#ff4d6d' }}> *</span>}
      </span>
      {children}
    </label>
  )
}
