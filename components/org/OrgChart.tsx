'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, User, ChevronRight, Plus, Sparkles } from 'lucide-react'
import type { RoleNode } from '@/lib/org/roles'

interface Props {
  tree:          RoleNode[]
  businessSlug:  string | null
}

export default function OrgChart({ tree, businessSlug }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError]          = useState<string | null>(null)

  async function seedDefaults() {
    setError(null)
    const res = await fetch('/api/org/seed', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ businessSlug }),
    })
    const j = await res.json() as { ok?: boolean; error?: string }
    if (!j.ok) {
      setError(j.error ?? 'seed failed')
      return
    }
    startTransition(() => router.refresh())
  }

  async function addChild(parentRoleId: string | null) {
    setError(null)
    const title = window.prompt('Role title (e.g. "Email Marketing Lead")')
    if (!title?.trim()) return
    const res = await fetch('/api/org/roles', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        role_title:     title.trim(),
        parent_role_id: parentRoleId,
        business_slug:  businessSlug,
      }),
    })
    const j = await res.json() as { ok?: boolean; error?: string }
    if (!j.ok) {
      setError(j.error ?? 'create failed')
      return
    }
    startTransition(() => router.refresh())
  }

  async function assignAgent(roleId: string, currentSlug: string | null) {
    setError(null)
    const slug = window.prompt(
      'Agent slug to assign (e.g. "platform-copilot", "codex-operator"). Empty to unassign.',
      currentSlug ?? '',
    )
    if (slug === null) return
    const res = await fetch(`/api/org/roles/${encodeURIComponent(roleId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ assigned_agent_slug: slug.trim() || null }),
    })
    const j = await res.json() as { ok?: boolean; error?: string }
    if (!j.ok) {
      setError(j.error ?? 'assignment failed')
      return
    }
    startTransition(() => router.refresh())
  }

  if (tree.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <Sparkles className="mx-auto mb-3 h-7 w-7 text-indigo-400" />
          <h2 className="mb-1 text-lg font-medium text-zinc-100">No roles yet</h2>
          <p className="mb-5 text-sm text-zinc-400">
            Start with a default hierarchy (CEO / CTO / Engineer / Designer), or add your first role manually.
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={seedDefaults}
              disabled={pending}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {pending ? 'Seeding…' : 'Seed default roles'}
            </button>
            <button
              type="button"
              onClick={() => addChild(null)}
              disabled={pending}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-50"
            >
              <Plus className="mr-1 inline h-4 w-4" />Add a role
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="space-y-3">
        {tree.map(node => (
          <RoleNodeView key={node.id} node={node} depth={0} onAddChild={addChild} onAssign={assignAgent} pending={pending} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => addChild(null)}
        disabled={pending}
        className="rounded-md border border-dashed border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800/40 disabled:opacity-50"
      >
        <Plus className="mr-1 inline h-4 w-4" />Add a top-level role
      </button>
    </div>
  )
}

function RoleNodeView({
  node,
  depth,
  onAddChild,
  onAssign,
  pending,
}: {
  node:       RoleNode
  depth:      number
  onAddChild: (parentId: string | null) => void
  onAssign:   (roleId: string, currentSlug: string | null) => void
  pending:    boolean
}) {
  const Icon = node.assigned_agent_slug ? Bot : node.assigned_user_id ? User : null
  const assignee = node.assigned_agent_slug ?? node.assigned_user_id ?? null

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        {depth > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-zinc-100">{node.role_title}</p>
            {node.reports_to_summary && (
              <span className="text-xs text-zinc-500">↳ reports to {node.reports_to_summary}</span>
            )}
          </div>
          {node.responsibilities && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{node.responsibilities}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onAssign(node.id, assignee)}
          disabled={pending}
          className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-50"
          title="Assign an agent or user to this role"
        >
          {Icon ? <Icon className="h-3 w-3" /> : null}
          {assignee ?? 'Unassigned'}
        </button>
        <button
          type="button"
          onClick={() => onAddChild(node.id)}
          disabled={pending}
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-50"
          title="Add a direct report under this role"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map(child => (
            <RoleNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              onAddChild={onAddChild}
              onAssign={onAssign}
              pending={pending}
            />
          ))}
        </div>
      )}
    </div>
  )
}
