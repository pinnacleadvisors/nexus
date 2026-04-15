'use client'

/**
 * app/(protected)/tools/content/page.tsx
 * Tribe v2 — Neuro-Optimised Content Engine
 */

import { useState, useRef } from 'react'
import {
  Sparkles, FileText, RefreshCw, Copy, Check, ChevronDown,
  BarChart2, Zap, AlertCircle, Layers, Film, Loader2, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FORMAT_TEMPLATES, TONE_PROFILES, NEURO_PRINCIPLES } from '@/lib/neuro-content'
import type { FormatId, ToneId, ContentScore } from '@/lib/neuro-content'

// ── Helpers ───────────────────────────────────────────────────────────────────
function gradeColor(grade: string) {
  switch (grade) {
    case 'A': return 'text-green-400'
    case 'B': return 'text-emerald-400'
    case 'C': return 'text-yellow-400'
    case 'D': return 'text-orange-400'
    default:  return 'text-red-400'
  }
}

function scoreBarColor(score: number) {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-full bg-space-700 rounded-full h-1.5 overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500', scoreBarColor(score))}
        style={{ width: `${score}%` }}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function FormatPicker({ value, onChange }: { value: FormatId; onChange: (v: FormatId) => void }) {
  const [open, setOpen] = useState(false)
  const selected = FORMAT_TEMPLATES.find(t => t.id === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-space-800 border border-space-600 rounded-lg text-sm text-white hover:border-purple transition-colors"
      >
        <span>{selected?.name ?? 'Select format'}</span>
        <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-space-800 border border-space-600 rounded-lg shadow-xl overflow-hidden">
          {FORMAT_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => { onChange(t.id); setOpen(false) }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-space-700 transition-colors',
                t.id === value ? 'text-purple' : 'text-gray-300',
              )}
            >
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-gray-500 truncate">{t.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TonePicker({ value, onChange }: { value: ToneId; onChange: (v: ToneId) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TONE_PROFILES.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
            t.id === value
              ? 'bg-purple/20 border-purple text-purple'
              : 'bg-space-800 border-space-600 text-gray-400 hover:border-gray-400',
          )}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}

function ScorePanel({ score }: { score: ContentScore }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-space-800 border border-space-600 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <BarChart2 className="h-5 w-5 text-purple" />
          <span className="font-semibold text-white">Neuro Score</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={cn('text-3xl font-bold', gradeColor(score.grade))}>
              {score.overallScore}
            </div>
            <div className={cn('text-xs font-bold', gradeColor(score.grade))}>
              Grade {score.grade}
            </div>
          </div>
        </div>
      </div>

      {/* Summary bars */}
      <div className="px-4 pb-4 space-y-2">
        {score.principles.slice(0, expanded ? 12 : 4).map(p => (
          <div key={p.principleId}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">{p.principleName}</span>
              <span className={scoreBarColor(p.score).replace('bg-', 'text-')}>{p.score}</span>
            </div>
            <ScoreBar score={p.score} />
          </div>
        ))}
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-purple hover:text-purple/80 mt-1"
        >
          {expanded ? 'Show less' : `Show all 12 principles`}
        </button>
      </div>

      {/* Strengths / Weaknesses */}
      <div className="border-t border-space-600 p-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-green-400 mb-2">Top Strengths</div>
          <ul className="space-y-1">
            {score.topStrengths.map(s => (
              <li key={s} className="text-xs text-gray-300 flex items-start gap-1">
                <span className="text-green-400 mt-0.5">+</span>{s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-red-400 mb-2">Weaknesses</div>
          <ul className="space-y-1">
            {score.topWeaknesses.map(w => (
              <li key={w} className="text-xs text-gray-300 flex items-start gap-1">
                <span className="text-red-400 mt-0.5">−</span>{w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Suggestions */}
      {score.suggestions.length > 0 && (
        <div className="border-t border-space-600 p-4">
          <div className="text-xs font-semibold text-yellow-400 mb-2">Suggestions</div>
          <ol className="space-y-2">
            {score.suggestions.map((s, i) => (
              <li key={i} className="text-xs text-gray-300 flex gap-2">
                <span className="text-yellow-400 shrink-0">{i + 1}.</span>{s}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const [topic, setTopic]             = useState('')
  const [context, setContext]         = useState('')
  const [format, setFormat]           = useState<FormatId>('linkedin-post')
  const [tone, setTone]               = useState<ToneId>('authority')
  const [output, setOutput]           = useState('')
  const [score, setScore]             = useState<ContentScore | null>(null)
  const [status, setStatus]           = useState<'idle' | 'generating' | 'scoring' | 'variants'>('idle')
  const [error, setError]             = useState('')
  const [neuroScore, setNeuroScore]   = useState<number | null>(null)
  const [neuroGrade, setNeuroGrade]   = useState<string | null>(null)
  const [iterations, setIterations]   = useState<number | null>(null)
  const [variants, setVariants]       = useState<Array<{ id: string; triggerFocus: string; content: string }>>([])
  const [activeTab, setActiveTab]     = useState<'output' | 'score' | 'variants'>('output')
  const [copied, setCopied]           = useState<string | null>(null)
  const [targetScore, setTargetScore] = useState(75)

  // ── Video export state ────────────────────────────────────────────────────
  const [videoStatus, setVideoStatus]   = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [videoUrl, setVideoUrl]         = useState<string | null>(null)
  const [videoError, setVideoError]     = useState<string | null>(null)
  const [videoProgress, setVideoProgress] = useState<number | null>(null)
  const [videoCost, setVideoCost]       = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  async function handleGenerate() {
    if (!topic.trim()) return
    setStatus('generating')
    setError('')
    setOutput('')
    setScore(null)
    setVariants([])
    setNeuroScore(null)
    setNeuroGrade(null)
    setIterations(null)
    setActiveTab('output')

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/content/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          topic,
          businessContext: context,
          format,
          tone,
          targetScore,
          maxIterations: 3,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Generation failed')
      }

      // Read headers
      setNeuroScore(Number(res.headers.get('X-Neuro-Score')) || null)
      setNeuroGrade(res.headers.get('X-Neuro-Grade'))
      setIterations(Number(res.headers.get('X-Neuro-Iterations')) || null)

      // Stream body
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let text      = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setOutput(text)
      }

      setStatus('idle')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message ?? 'Generation failed')
      }
      setStatus('idle')
    }
  }

  async function handleScore() {
    if (!output.trim()) return
    setStatus('scoring')
    setError('')

    try {
      const res = await fetch('/api/content/score', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: output }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Scoring failed')
      }

      const data: ContentScore = await res.json()
      setScore(data)
      setNeuroScore(data.overallScore)
      setNeuroGrade(data.grade)
      setActiveTab('score')
    } catch (err) {
      setError((err as Error).message ?? 'Scoring failed')
    } finally {
      setStatus('idle')
    }
  }

  async function handleVariants() {
    if (!output.trim()) return
    setStatus('variants')
    setError('')

    try {
      const res = await fetch('/api/content/variants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: output, format, tone }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Variant generation failed')
      }

      const data = await res.json()
      setVariants(data.variants ?? [])
      setActiveTab('variants')
    } catch (err) {
      setError((err as Error).message ?? 'Variant generation failed')
    } finally {
      setStatus('idle')
    }
  }

  async function handleExportVideo() {
    if (!output.trim() || videoStatus !== 'idle') return
    setVideoStatus('submitting')
    setVideoError(null)
    setVideoUrl(null)
    setVideoProgress(null)

    try {
      // Use the first ~500 chars of the script as the visual prompt
      const prompt = output.slice(0, 500).trim()

      const res = await fetch('/api/video/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, duration: 5, provider: 'auto' }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to submit video job')
      }

      const { jobId, estimatedCostUsd } = await res.json() as {
        jobId: string
        estimatedCostUsd: number
      }
      setVideoCost(estimatedCostUsd)
      setVideoStatus('polling')

      // SSE poll
      const sse = new EventSource(`/api/video/${jobId}`)
      sse.onmessage = (e) => {
        const data = JSON.parse(e.data as string) as {
          status:   string
          progress?: number
          videoUrl?: string
          error?:   string
        }
        if (data.progress != null) setVideoProgress(data.progress)
        if (data.status === 'succeeded') {
          setVideoUrl(data.videoUrl ?? null)
          setVideoStatus('done')
          sse.close()
        } else if (data.status === 'failed') {
          setVideoError(data.error ?? 'Video generation failed')
          setVideoStatus('error')
          sse.close()
        }
      }
      sse.onerror = () => {
        setVideoError('Lost connection to video job stream')
        setVideoStatus('error')
        sse.close()
      }
    } catch (err) {
      setVideoError((err as Error).message)
      setVideoStatus('error')
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const busy = status !== 'idle'

  return (
    <div className="min-h-screen bg-space-950 text-white">
      {/* Header */}
      <div className="border-b border-space-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-purple" />
          <div>
            <h1 className="text-lg font-bold">Tribe v2</h1>
            <p className="text-xs text-gray-400">Neuro-Optimised Content Engine · 12 cognitive engagement principles</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* ── Left Panel: Controls ── */}
        <div className="space-y-5">
          {/* Topic */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Topic / Core Idea
            </label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Why most cold emails fail and the 3-line fix that doubled our reply rate"
              rows={3}
              className="w-full bg-space-800 border border-space-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-purple transition-colors"
            />
          </div>

          {/* Business Context */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Business Context <span className="text-gray-600 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="e.g. B2B SaaS tool for sales teams, targeting startup founders, competitor to Apollo"
              rows={2}
              className="w-full bg-space-800 border border-space-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-purple transition-colors"
            />
          </div>

          {/* Format */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Format
            </label>
            <FormatPicker value={format} onChange={setFormat} />
            <p className="mt-1.5 text-xs text-gray-500">
              {FORMAT_TEMPLATES.find(t => t.id === format)?.description}
            </p>
          </div>

          {/* Tone */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Tone
            </label>
            <TonePicker value={tone} onChange={setTone} />
            <p className="mt-1.5 text-xs text-gray-500">
              {TONE_PROFILES.find(t => t.id === tone)?.tagline}
            </p>
          </div>

          {/* Target Score */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Target Score <span className="text-purple">{targetScore}</span>
            </label>
            <input
              type="range"
              min={50}
              max={90}
              step={5}
              value={targetScore}
              onChange={e => setTargetScore(Number(e.target.value))}
              className="w-full accent-purple"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-0.5">
              <span>50 (fast)</span>
              <span>90 (best)</span>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!topic.trim() || busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple hover:bg-purple/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-all"
          >
            {status === 'generating' ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Generating & Optimising…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Content
              </>
            )}
          </button>

          {/* Principles reference */}
          <div className="bg-space-800 border border-space-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-purple" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">12 Neuro Principles</span>
            </div>
            <div className="space-y-1">
              {NEURO_PRINCIPLES.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-5 shrink-0">{i + 1}.</span>
                  <span className="text-xs text-gray-400 font-medium">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Panel: Output ── */}
        <div className="space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Score badge */}
          {neuroScore !== null && (
            <div className="flex items-center gap-3 p-3 bg-space-800 border border-space-600 rounded-lg">
              <div className={cn('text-2xl font-bold', gradeColor(neuroGrade ?? 'F'))}>
                {neuroScore}
              </div>
              <div>
                <div className={cn('text-sm font-semibold', gradeColor(neuroGrade ?? 'F'))}>
                  Grade {neuroGrade}
                </div>
                <div className="text-xs text-gray-500">
                  {iterations !== null ? `${iterations} iteration${iterations !== 1 ? 's' : ''}` : 'Scored'}
                </div>
              </div>
              <div className="flex-1" />
              {/* Action buttons */}
              {output && (
                <>
                  <button
                    onClick={handleScore}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-space-700 hover:bg-space-600 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    <BarChart2 className="h-3.5 w-3.5" />
                    {status === 'scoring' ? 'Scoring…' : 'Deep Score'}
                  </button>
                  <button
                    onClick={handleVariants}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-space-700 hover:bg-space-600 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {status === 'variants' ? 'Generating…' : 'A/B Variants'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Tab bar */}
          {(output || score || variants.length > 0) && (
            <div className="flex gap-1 bg-space-800 rounded-lg p-1 border border-space-700">
              {[
                { key: 'output',   label: 'Output',   show: !!output },
                { key: 'score',    label: 'Score',    show: !!score },
                { key: 'variants', label: 'Variants', show: variants.length > 0 },
              ].filter(t => t.show).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as typeof activeTab)}
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    activeTab === tab.key
                      ? 'bg-purple text-white'
                      : 'text-gray-400 hover:text-white',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Output tab */}
          {activeTab === 'output' && output && (
            <div className="relative bg-space-800 border border-space-600 rounded-xl">
              <div className="flex items-center justify-between px-4 py-2 border-b border-space-700">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-purple" />
                  <span className="text-xs font-medium text-gray-400">
                    {FORMAT_TEMPLATES.find(t => t.id === format)?.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Export to Video — VSL scripts only */}
                  {format === 'vsl-script' && (
                    <button
                      onClick={handleExportVideo}
                      disabled={videoStatus !== 'idle' && videoStatus !== 'done' && videoStatus !== 'error'}
                      className="flex items-center gap-1 text-xs text-purple hover:text-purple/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {videoStatus === 'submitting' || videoStatus === 'polling'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Film className="h-3.5 w-3.5" />}
                      {videoStatus === 'submitting' ? 'Submitting…'
                        : videoStatus === 'polling'   ? `Generating${videoProgress != null ? ` ${Math.round(videoProgress * 100)}%` : '…'}`
                        : videoStatus === 'done'      ? 'Regenerate Video'
                        : 'Export to Video'}
                    </button>
                  )}
                  <button
                    onClick={() => copyText(output, 'output')}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    {copied === 'output' ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === 'output' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <pre className="p-4 text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                {output}
                {status === 'generating' && <span className="animate-pulse text-purple">|</span>}
              </pre>
              {/* Video result / error strip */}
              {videoStatus === 'done' && videoUrl && (
                <div className="border-t border-space-700 px-4 py-3 flex items-center gap-3">
                  <Film className="h-4 w-4 text-green-400 shrink-0" />
                  <span className="text-xs text-green-400 font-medium">Video ready</span>
                  {videoCost != null && (
                    <span className="text-xs text-gray-500">(~${videoCost.toFixed(2)})</span>
                  )}
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-xs text-purple hover:text-purple/80 transition-colors"
                  >
                    Open video <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {videoStatus === 'error' && videoError && (
                <div className="border-t border-space-700 px-4 py-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                  <span className="text-xs text-red-400">{videoError}</span>
                  <button
                    onClick={() => setVideoStatus('idle')}
                    className="ml-auto text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Score tab */}
          {activeTab === 'score' && score && (
            <ScorePanel score={score} />
          )}

          {/* Variants tab */}
          {activeTab === 'variants' && variants.length > 0 && (
            <div className="space-y-4">
              {variants.map((v) => (
                <div key={v.id} className="bg-space-800 border border-space-600 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-space-700">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-yellow-400" />
                      <span className="text-xs font-semibold text-yellow-400">{v.triggerFocus} focus</span>
                    </div>
                    <button
                      onClick={() => copyText(v.content, v.id)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {copied === v.id ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === v.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="p-4 text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                    {v.content}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!output && !busy && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Sparkles className="h-12 w-12 text-purple/30 mb-4" />
              <div className="text-gray-400 font-medium">Ready to create neuro-optimised content</div>
              <div className="text-sm text-gray-600 mt-1">
                Fill in your topic, choose a format and tone, then click Generate
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
