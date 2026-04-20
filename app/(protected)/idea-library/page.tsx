'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Plus, Lightbulb } from 'lucide-react'
import type { IdeaCard as IdeaCardType } from '@/lib/types'
import IdeaCard from '@/components/idea/IdeaCard'

const IDEAS_KEY = 'nexus:ideas'

function loadLocal(): IdeaCardType[] {
  try {
    const raw = localStorage.getItem(IDEAS_KEY)
    return raw ? (JSON.parse(raw) as IdeaCardType[]) : []
  } catch {
    return []
  }
}

function saveLocal(list: IdeaCardType[]) {
  try {
    localStorage.setItem(IDEAS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export default function IdeaLibraryPage() {
  const [ideas, setIdeas] = useState<IdeaCardType[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [usingServer, setUsingServer] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ideas')
        if (res.ok) {
          const { ideas: serverIdeas } = (await res.json()) as { ideas: IdeaCardType[] }
          if (!cancelled && Array.isArray(serverIdeas) && serverIdeas.length > 0) {
            setIdeas(serverIdeas)
            setUsingServer(true)
            setHydrated(true)
            return
          }
        }
      } catch {
        // fall through to localStorage
      }
      if (!cancelled) {
        setIdeas(loadLocal())
        setHydrated(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function deleteIdea(id: string) {
    const next = ideas.filter(i => i.id !== id)
    setIdeas(next)
    if (usingServer) {
      await fetch(`/api/ideas?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    } else {
      saveLocal(next)
    }
  }

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen size={22} style={{ color: '#6c63ff' }} />
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
                Idea Library
              </h1>
              <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
                Every idea you&apos;ve captured. Hit Execute to turn one into an n8n workflow.
              </p>
            </div>
          </div>
          <Link
            href="/idea"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            <Plus size={14} />
            New idea
          </Link>
        </div>

        {hydrated && ideas.length === 0 && (
          <div
            className="p-8 rounded-xl border text-center"
            style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
          >
            <Lightbulb size={28} className="mx-auto mb-3" style={{ color: '#6c63ff' }} />
            <p className="text-sm mb-4" style={{ color: '#9090b0' }}>
              No ideas yet. Start by capturing one.
            </p>
            <Link
              href="/idea"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              <Plus size={14} />
              Capture an idea
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.map(card => (
            <IdeaCard key={card.id} card={card} onDelete={deleteIdea} />
          ))}
        </div>
      </div>
    </div>
  )
}
