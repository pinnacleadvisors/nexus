'use client'

/**
 * MobileActionBar — sticky bottom-bar with the 4 most common business
 * actions, visible only at md- viewports.
 *
 * R12 of the UX consultation. Operator manages businesses from their
 * phone; the current header buttons (Tick simulation / Hyperbolic
 * chamber / Graduate / Open chat) stack vertically and require
 * scrolling past the SIM badge + mission paragraph + NextStepsCard
 * before reaching the chat. Sticky bottom-bar matches the iOS/Android
 * pattern operators are already used to.
 *
 * Hidden at md+ (desktop has plenty of vertical real estate). Only
 * surfaces on /businesses/<slug> — caller must mount.
 */

import Link from 'next/link'
import { Play, FlaskConical, Zap, MessageSquare } from 'lucide-react'

interface Props {
  slug:       string
  simulation: boolean
}

export default function MobileActionBar({ slug, simulation }: Props) {
  // Common case order: chat > tick > smoke > graduate.
  // For graduated business, swap graduate→pause (future) / hide entirely;
  // for now we just hide the simulation-only buttons.
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(13,13,20,0.92)',
        borderColor:     '#24243e',
      }}
      aria-label="Business actions"
    >
      <div className="flex items-stretch justify-around gap-1 px-2 py-2 safe-bottom">
        <Link
          href={`/businesses/${slug}/chat`}
          className="flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition active:bg-zinc-800/70"
          style={{ color: '#a8a3ff' }}
        >
          <MessageSquare className="h-5 w-5" />
          Chat
        </Link>
        {simulation && (
          <>
            <Link
              href={`/businesses/${slug}/simulate`}
              className="flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition active:bg-zinc-800/70"
              style={{ color: '#a8a3ff' }}
            >
              <FlaskConical className="h-5 w-5" />
              Smoke
            </Link>
            <Link
              href={`/businesses/${slug}`}
              className="flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition active:bg-zinc-800/70"
              style={{ color: '#fbbf24' }}
            >
              <Play className="h-5 w-5" />
              Tick
            </Link>
            <Link
              href={`/businesses/${slug}#graduate`}
              className="flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition active:bg-zinc-800/70"
              style={{ color: '#4ade80' }}
            >
              <Zap className="h-5 w-5" />
              Graduate
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
