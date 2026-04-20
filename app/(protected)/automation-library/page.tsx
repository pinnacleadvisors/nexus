'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Workflow, Download, Trash2, ChevronDown, ChevronRight, AlertTriangle, CheckSquare } from 'lucide-react'
import type { SavedAutomation } from '@/lib/types'

const AUTOMATIONS_KEY = 'nexus:automations'

function loadAutomations(): SavedAutomation[] {
  try {
    const raw = localStorage.getItem(AUTOMATIONS_KEY)
    return raw ? (JSON.parse(raw) as SavedAutomation[]) : []
  } catch {
    return []
  }
}

export default function AutomationLibraryPage() {
  const [items, setItems] = useState<SavedAutomation[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    setItems(loadAutomations())
    setHydrated(true)
  }, [])

  function remove(id: string) {
    const next = items.filter(i => i.id !== id)
    setItems(next)
    try {
      localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
    if (openId === id) setOpenId(null)
  }

  function download(auto: SavedAutomation) {
    const blob = new Blob([auto.workflowJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${auto.name.replace(/[^a-z0-9-_]/gi, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <Workflow size={22} style={{ color: '#6c63ff' }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
              Automation Library
            </h1>
            <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
              n8n workflows generated from your ideas. Copy the JSON into n8n if auto-import didn&apos;t run.
            </p>
          </div>
        </div>

        {hydrated && items.length === 0 && (
          <div
            className="p-8 rounded-xl border text-center"
            style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
          >
            <Workflow size={28} className="mx-auto mb-3" style={{ color: '#6c63ff' }} />
            <p className="text-sm mb-4" style={{ color: '#9090b0' }}>
              No workflows yet. Execute an idea from the Idea Library to generate one.
            </p>
            <Link
              href="/idea-library"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              Open Idea Library
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {items.map(auto => {
            const open = openId === auto.id
            return (
              <div
                key={auto.id}
                className="p-5 rounded-xl border"
                style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate" style={{ color: '#e8e8f0' }}>
                      {auto.name}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
                      {new Date(auto.createdAt).toLocaleString()}
                    </p>
                    {auto.explanation && (
                      <p className="text-sm mt-2" style={{ color: '#c0c0d0' }}>{auto.explanation}</p>
                    )}
                    {auto.importFailed && (
                      <div
                        className="mt-2 p-2 rounded flex items-start gap-2 text-xs"
                        style={{ backgroundColor: '#2a2116', color: '#ffba5c' }}
                      >
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        n8n import URL unavailable. Download the JSON below and paste it into n8n manually.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => download(auto)}
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: '#1a1a2e', color: '#e8e8f0' }}
                      title="Download JSON"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => remove(auto.id)}
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {auto.checklist.length > 0 && (
                  <button
                    onClick={() => setOpenId(open ? null : auto.id)}
                    className="mt-3 flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: '#e8e8f0' }}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Setup checklist ({auto.checklist.length})
                  </button>
                )}

                {open && auto.checklist.length > 0 && (
                  <ul className="mt-2 pl-5 space-y-1.5">
                    {auto.checklist.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm"
                        style={{ color: '#c0c0d0' }}
                      >
                        <CheckSquare size={12} className="shrink-0 mt-1" style={{ color: '#6c63ff' }} />
                        {step}
                      </li>
                    ))}
                  </ul>
                )}

                {open && (
                  <pre
                    className="mt-3 p-3 rounded-lg text-xs overflow-auto max-h-64"
                    style={{ backgroundColor: '#050508', color: '#9090b0', border: '1px solid #24243e' }}
                  >
                    {auto.workflowJson}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
