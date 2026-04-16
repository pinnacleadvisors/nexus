/**
 * POST /api/webhooks/n8n
 *
 * Receives execution completion events from n8n workflows.
 * - Verifies HMAC-SHA256 signature using N8N_WEBHOOK_SECRET
 * - Updates the matching Supabase board card status
 * - Appends result summary to Notion (if notionPageId present)
 * - Returns 200 immediately so n8n isn't blocked
 *
 * Configure in n8n: add a final HTTP Request node to each workflow that
 * POSTs to this endpoint with the X-N8N-Signature header set.
 *
 * Expected payload:
 *   {
 *     workflowId:    string
 *     workflowName:  string
 *     executionId:   string
 *     status:        'success' | 'error' | 'waiting'
 *     startedAt:     string (ISO)
 *     stoppedAt?:    string (ISO)
 *     errorMessage?: string
 *     taskCardId?:   string   — Supabase task ID to update
 *     summary?:      string   — brief output description
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { appendToPage, isMemoryConfigured } from '@/lib/memory/github'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'

// ── HMAC verification ─────────────────────────────────────────────────────────
async function verifySignature(body: string, header: string, secret: string): Promise<boolean> {
  const expected = header.startsWith('sha256=') ? header : `sha256=${header}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const raw = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const computed = 'sha256=' + Array.from(new Uint8Array(raw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

// ── Payload type ──────────────────────────────────────────────────────────────
interface N8nExecutionEvent {
  workflowId:    string
  workflowName:  string
  executionId:   string
  status:        'success' | 'error' | 'waiting'
  startedAt:     string
  stoppedAt?:    string
  errorMessage?: string
  taskCardId?:   string
  summary?:      string
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const bodyText = await req.text()

  // Signature check (skip if N8N_WEBHOOK_SECRET not set yet)
  const secret = process.env.N8N_WEBHOOK_SECRET
  if (secret) {
    const sigHeader = req.headers.get('x-n8n-signature') ?? ''
    if (!sigHeader) {
      return NextResponse.json({ error: 'Missing X-N8N-Signature header' }, { status: 401 })
    }
    const valid = await verifySignature(bodyText, sigHeader, secret)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let event: N8nExecutionEvent
  try {
    event = JSON.parse(bodyText) as N8nExecutionEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const db = createServerClient()

  // ── Update board card if taskCardId provided ─────────────────────────────
  if (event.taskCardId && db) {
    const newColumn = event.status === 'success' ? 'review' : 'in-progress'
    const suffix    = event.status === 'success'
      ? `\n\n✅ Completed at ${event.stoppedAt ?? new Date().toISOString()}`
      : `\n\n❌ Error: ${event.errorMessage ?? 'Unknown error'}`

    // Get current card to append to description
    const { data: card } = await (db as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (f: string, v: string) => { single: () => Promise<{ data: { description: string } | null }> } }
      }
    }).from('tasks')
      .select('description')
      .eq('id', event.taskCardId)
      .single()

    const currentDesc = (card as { description?: string } | null)?.description ?? ''

    await (db as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => { eq: (f: string, v: string) => Promise<{ error: { message: string } | null }> }
      }
    }).from('tasks')
      .update({
        column_id:   newColumn,
        description: currentDesc + suffix,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', event.taskCardId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[n8n webhook] card update:', error.message)
      })
  } else if (db) {
    // Create a new board card for this execution
    const emoji  = event.status === 'success' ? '✅' : '❌'
    const column = event.status === 'success' ? 'review' : 'in-progress'

    await (db as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
      }
    }).from('tasks')
      .insert({
        title:       `${emoji} [n8n] ${event.workflowName}`,
        description: event.summary
          ? `${event.summary}\n\nExecution: ${event.executionId}\nStatus: ${event.status}`
          : `Workflow execution ${event.status}.\n\nExecution ID: ${event.executionId}`,
        column_id:   column,
        priority:    event.status === 'error' ? 'high' : 'medium',
        position:    0,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[n8n webhook] new card insert:', error.message)
      })
  }

  // ── Append to nexus-memory ───────────────────────────────────────────────
  if (isMemoryConfigured() && event.workflowName) {
    const statusEmoji = event.status === 'success' ? '✅' : '❌'
    const path = `agent-runs/${new Date().toISOString().slice(0, 10)}/n8n-${event.workflowId}-${event.executionId}.md`
    const text = [
      `## ${statusEmoji} n8n: ${event.workflowName}`,
      `_Execution: ${event.executionId} — ${event.status} — ${event.stoppedAt ?? new Date().toISOString()}_`,
      ``,
      event.summary ?? `Execution ${event.executionId} completed with status: ${event.status}`,
      event.errorMessage ? `\n**Error:** ${event.errorMessage}` : '',
    ].filter(Boolean).join('\n')
    appendToPage(path, text, `n8n: ${event.workflowName} ${event.status}`).catch(err => {
      console.error('[n8n webhook] memory append failed:', err)
    })
  }

  audit(req, {
    action:     `n8n.execution.${event.status}`,
    resource:   'workflow',
    resourceId: event.workflowId,
    metadata:   {
      workflowName: event.workflowName,
      executionId:  event.executionId,
      stoppedAt:    event.stoppedAt,
    },
  })

  return NextResponse.json({
    ok:          true,
    received:    event.status,
    workflowId:  event.workflowId,
    executionId: event.executionId,
  })
}
