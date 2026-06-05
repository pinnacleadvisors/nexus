/**
 * POST /api/cron/chat-retrospectives — daily cron.
 *
 * R9 of the UX consultation. For every chat_sessions row where:
 *   - last_message_at > 7 days ago
 *   - retrospective_md IS NULL
 *
 * load the last ~50 messages, summarise via getLlm() in one paragraph,
 * persist to chat_sessions.retrospective_md + .retrospective_generated_at.
 *
 * The chat view renders the retrospective at the top of the message
 * pane when present so the operator sees "what we decided last time"
 * the moment they reopen the session.
 *
 * Caps: max 10 sessions per cron tick (avoids burning the LLM budget
 * on a backlog). Cheaper background tasks could route via the NIM
 * provider (J5/R-batch) to drop marginal cost to ~$0.
 *
 * Retry-storm safe: 200 even on partial failure. Each session has its
 * own try/catch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { generateText } from 'ai'
import { getLlmForTask } from '@/lib/llm/task-tier-router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PER_TICK = 10
const RECENT_MESSAGES_COUNT = 50

interface ChatSession {
  id:               string
  user_id:          string
  scope:            string
  title:            string | null
  last_message_at:  string
}

interface ChatMessage {
  role:    string
  content: string
  created_at: string
}

function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const header = req.headers.get('authorization') ?? ''
    if (header === `Bearer ${expected}`) return true
  }
  if (req.headers.get('vercel-cron') === '1') return true
  if (!expected && process.env.NODE_ENV !== 'production') return true
  return false
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Find candidate sessions
  const cutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()
  let candidates: ChatSession[] = []
  try {
    const res = await (db.from('chat_sessions' as never) as unknown as {
      select: (c: string) => { is: (c: string, v: null) => { lt: (c: string, v: string) => { order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ChatSession[] | null; error: { message: string } | null }> } } } }
    }).select('id, user_id, scope, title, last_message_at')
      .is('retrospective_md', null)
      .lt('last_message_at', cutoffIso)
      .order('last_message_at', { ascending: true })
      .limit(MAX_PER_TICK)
    if (res.error) {
      if (/column .*retrospective_md.* does not exist/i.test(res.error.message)) {
        return NextResponse.json({ ok: false, error: 'migration_092_not_applied' })
      }
      return NextResponse.json({ ok: false, error: res.error.message })
    }
    candidates = res.data ?? []
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'query_failed' })
  }

  const results: Array<{ session_id: string; ok: boolean; error?: string }> = []

  for (const session of candidates) {
    try {
      // Load the session's messages
      const msgRes = await (db.from('chat_messages' as never) as unknown as {
        select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ChatMessage[] | null }> } } }
      }).select('role, content, created_at').eq('session_id', session.id).order('created_at', { ascending: true }).limit(RECENT_MESSAGES_COUNT)
      const messages = msgRes.data ?? []
      if (messages.length === 0) {
        // No messages — write a stub retrospective so we don't keep
        // hitting this row every cron.
        await updateRetrospective(db, session.id, '(no messages in this session)')
        results.push({ session_id: session.id, ok: true })
        continue
      }

      // Build the prompt
      const conversation = messages.slice(-RECENT_MESSAGES_COUNT).map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 2000)}`).join('\n\n')
      const prompt = `Summarise this chat session in ONE paragraph (≤ 4 sentences). Cover: what was decided, what was discovered, what's pending. No filler. Direct + factual.

Session title: ${session.title ?? 'Untitled'}
Scope: ${session.scope}
Last activity: ${session.last_message_at}

Messages:
${conversation}`

      const llm = getLlmForTask('background')
      const { text } = await generateText({
        model:       llm,
        prompt,
        temperature: 0.3,
      })
      const summary = (text || '').trim()
      if (summary) {
        await updateRetrospective(db, session.id, summary)
        results.push({ session_id: session.id, ok: true })
      } else {
        results.push({ session_id: session.id, ok: false, error: 'empty_llm_output' })
      }
    } catch (err) {
      results.push({
        session_id: session.id,
        ok:         false,
        error:      err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  return NextResponse.json({
    ok:         true,
    processed:  results.length,
    succeeded:  results.filter(r => r.ok).length,
    failed:     results.filter(r => !r.ok).length,
    results,
  })
}

async function updateRetrospective(db: ReturnType<typeof createServerClient>, sessionId: string, retro: string): Promise<void> {
  if (!db) return
  await (db.from('chat_sessions' as never) as unknown as {
    update: (row: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({
    retrospective_md:           retro,
    retrospective_generated_at: new Date().toISOString(),
  }).eq('id', sessionId)
}
