'use client'

/**
 * TasksView — Manual to-do checklist for the chat scope.
 *
 * Two source kinds of tasks:
 *   - source='agent' — added by the assistant emitting a `manual-task` block.
 *                       Shown with an "AI" tag so the operator can tell what
 *                       came from the agent vs what they wrote themselves.
 *   - source='operator' — added via the "+ New task" button in this panel.
 *
 * Done tasks collapse to a "Completed" subgroup beneath the active list.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Sparkles, Calendar as CalendarIcon } from 'lucide-react'
import type { OperatorTaskRow } from '@/lib/views/tasks'

interface Props {
  scope:    string                                       // 'admin' | 'business:<slug>'
  onCountChange?: (openCount: number) => void           // parent badges the Views button
}

interface ListResp { ok: true; tasks: OperatorTaskRow[] }

export default function TasksView({ scope, onCountChange }: Props) {
  const [tasks, setTasks] = useState<OperatorTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc]   = useState('')
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/views/tasks?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
      if (!res.ok) { setErr(`HTTP ${res.status}`); return }
      const j = (await res.json()) as ListResp | { ok: false; error: string }
      if (!j.ok) { setErr(j.error); return }
      setTasks(j.tasks)
      setErr(null)
      onCountChange?.(j.tasks.filter(t => !t.done).length)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load')
    } finally { setLoading(false) }
  }, [scope, onCountChange])

  useEffect(() => { void reload() }, [reload])

  async function toggleDone(t: OperatorTaskRow) {
    // Optimistic toggle
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
    try {
      await fetch(`/api/views/tasks/${t.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ done: !t.done }),
      })
      void reload()
    } catch { void reload() }
  }

  async function deleteTask(t: OperatorTaskRow) {
    if (!confirm(`Delete "${t.title}"? Cannot be undone.`)) return
    setTasks(prev => prev.filter(x => x.id !== t.id))
    try { await fetch(`/api/views/tasks/${t.id}`, { method: 'DELETE' }) } catch { /* refresh below */ }
    void reload()
  }

  async function addTask() {
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/views/tasks', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ scope, title: newTitle.trim(), description: newDesc.trim() || undefined }),
      })
      const j = (await res.json()) as { ok: true; task: OperatorTaskRow } | { ok: false; error: string }
      if (!j.ok) { setErr(j.error); return }
      setNewTitle(''); setNewDesc('')
      void reload()
    } finally { setAdding(false) }
  }

  const open      = tasks.filter(t => !t.done)
  const completed = tasks.filter(t =>  t.done)

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Add a task */}
      <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="New task title…"
          className="w-full bg-transparent text-sm focus:outline-none"
          style={{ color: '#e8e8f0' }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addTask() } }}
        />
        {newTitle.trim().length > 0 && (
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Optional notes…"
            rows={2}
            className="w-full bg-transparent text-xs mt-1 resize-none focus:outline-none"
            style={{ color: '#c8c8d8' }}
          />
        )}
        <div className="flex justify-end mt-1">
          <button
            onClick={() => void addTask()}
            disabled={adding || !newTitle.trim()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgba(108,99,255,0.20)', border: '1px solid rgba(108,99,255,0.30)', color: '#e8e8f0' }}
          >
            {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            <span>Add</span>
          </button>
        </div>
      </div>

      {loading && tasks.length === 0 && (
        <div className="flex items-center gap-2 text-xs py-6 justify-center" style={{ color: '#9090b0' }}>
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}

      {err && (
        <div className="text-xs rounded p-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>{err}</div>
      )}

      {open.length === 0 && completed.length === 0 && !loading && !err && (
        <div className="text-[11px] text-center py-6" style={{ color: '#55556a' }}>
          No tasks yet. Add one above, or ask the copilot what manual work it&apos;s blocked on.
        </div>
      )}

      {open.length > 0 && (
        <div className="space-y-1">
          {open.map(t => <TaskRow key={t.id} task={t} onToggle={() => void toggleDone(t)} onDelete={() => void deleteTask(t)} />)}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-1 pt-2" style={{ borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] uppercase tracking-[0.14em] px-1" style={{ color: '#55556a' }}>Completed</div>
          {completed.map(t => <TaskRow key={t.id} task={t} onToggle={() => void toggleDone(t)} onDelete={() => void deleteTask(t)} />)}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete }: { task: OperatorTaskRow; onToggle: () => void; onDelete: () => void }) {
  return (
    <div
      className="group flex items-start gap-2 px-2 py-1.5 rounded transition-colors"
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={onToggle}
        className="mt-1 shrink-0 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs ${task.done ? 'line-through' : ''}`} style={{ color: task.done ? '#55556a' : '#e8e8f0' }}>{task.title}</span>
          {task.source === 'agent' && (
            <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded" title="Added by the chat agent" style={{ background: 'rgba(168,163,255,0.10)', color: '#a8a3ff' }}>
              <Sparkles size={8} /> AI
            </span>
          )}
        </div>
        {task.description && (
          <div className={`text-[11px] mt-0.5 whitespace-pre-wrap ${task.done ? 'line-through' : ''}`} style={{ color: task.done ? '#3a3a4a' : '#9090b0' }}>{task.description}</div>
        )}
        {task.due_at && (
          <div className="inline-flex items-center gap-1 text-[10px] mt-1" style={{ color: '#a8a3ff' }}>
            <CalendarIcon size={9} /> {new Date(task.due_at).toLocaleString()}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        title="Delete task"
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded"
        style={{ color: '#ef4444' }}
      >
        <Trash2 size={10} />
      </button>
    </div>
  )
}
