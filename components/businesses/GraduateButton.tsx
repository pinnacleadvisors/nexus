'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Zap } from 'lucide-react'

const GraduateModal = dynamic(() => import('./GraduateModal'), { ssr: false })

export default function GraduateButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20"
        title="Flip simulation=false. Enables real Stripe, real Composio money-verbs, real spend tracking."
      >
        <Zap className="h-4 w-4" /> Graduate to production
      </button>
      {open && <GraduateModal slug={slug} onClose={() => setOpen(false)} />}
    </>
  )
}
