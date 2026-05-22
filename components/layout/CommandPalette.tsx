'use client'

/**
 * Ctrl+K / Cmd+K command palette — Phase 2 Task C.
 *
 * Mounted in the protected layout so every route has it. Keyboard-first
 * navigation per Paperclip-aesthetic absorption.
 *
 * Hijack guard — does NOT open when the operator is mid-input in a
 * textarea / input / contenteditable element (so the codex chat doesn't lose
 * Ctrl+K as a future shortcut for something else).
 */

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { ArrowRight } from 'lucide-react'
import { STATIC_COMMANDS, GROUP_LABEL, type CommandGroup, type PaletteCommand } from '@/lib/command-palette/registry'

interface BusinessLite { slug: string; name: string }

interface Props {
  businesses?: BusinessLite[]
}

export default function CommandPalette({ businesses = [] }: Props) {
  const router = useRouter()
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')

  // Inject dynamic per-business shortcuts.
  const commands = useMemo<PaletteCommand[]>(() => {
    const dyn: PaletteCommand[] = businesses.flatMap(b => ([
      { id: `biz:overview:${b.slug}`, group: 'navigate', label: b.name, hint: `/businesses/${b.slug}`, href: `/businesses/${b.slug}` },
      { id: `biz:chat:${b.slug}`,     group: 'dispatch', label: `Chat with ${b.name}`,                 href: `/businesses/${b.slug}/chat` },
    ]))
    return [...STATIC_COMMANDS, ...dyn]
  }, [businesses])

  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true
      if (el.isContentEditable) return true
      return false
    }

    function onKeyDown(e: KeyboardEvent) {
      const isPaletteKey = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (!isPaletteKey) return
      // Allow Ctrl+K inside textareas only when the palette is already open.
      // Otherwise let the host element receive it.
      if (!open && isEditable(e.target)) return
      e.preventDefault()
      setOpen(o => !o)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  function run(cmd: PaletteCommand) {
    setOpen(false)
    setQuery('')
    if (cmd.href) {
      router.push(cmd.href)
    } else if (cmd.run) {
      void cmd.run()
    }
  }

  if (!open) return null

  // Group commands by category for the rendering pass.
  const groups: Record<CommandGroup, PaletteCommand[]> = { navigate: [], dispatch: [], settings: [] }
  for (const c of commands) groups[c.group].push(c)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div onClick={e => e.stopPropagation()} className="w-[640px] max-w-[calc(100vw-2rem)]">
        <Command
          label="Command Menu"
          className="overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-violet-500/10"
        >
          <div className="border-b border-zinc-800 px-4 py-3">
            <Command.Input
              autoFocus
              placeholder="Type a command or search…"
              value={query}
              onValueChange={setQuery}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto px-1 py-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500">No commands match.</Command.Empty>
            {(['navigate', 'dispatch', 'settings'] as const).map(g =>
              groups[g].length === 0 ? null : (
                <Command.Group key={g} heading={GROUP_LABEL[g]} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-zinc-500">
                  {groups[g].map(c => (
                    <Command.Item
                      key={c.id}
                      value={`${c.label} ${c.keywords?.join(' ') ?? ''} ${c.hint ?? ''}`}
                      onSelect={() => run(c)}
                      className="group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 aria-selected:bg-zinc-800 aria-selected:text-white"
                    >
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600 group-aria-selected:text-violet-400" />
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="font-mono text-[10px] text-zinc-600 group-aria-selected:text-zinc-400">{c.hint}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              ),
            )}
          </Command.List>
          <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
            <span>↑↓ navigate · ⏎ select · esc close</span>
            <span className="font-mono">Ctrl+K</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
