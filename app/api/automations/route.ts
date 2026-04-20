/**
 * Automations CRUD — persists generated n8n workflows for the signed-in user.
 *
 * GET    /api/automations              — list current user's automations
 * POST   /api/automations              — store one (used by /api/n8n/generate)
 * DELETE /api/automations?id=<id>      — delete one
 *
 * Falls back to an empty list when Supabase isn't configured; pages fall back
 * to localStorage automatically.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { SavedAutomation } from '@/lib/types'
import { rowToAutomation, automationToRow, type AutomationRow } from '@/lib/idea-db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ automations: [] })

  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as AutomationRow[]
  return NextResponse.json({ automations: rows.map(rowToAutomation) })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const auto = (await req.json()) as Omit<SavedAutomation, 'id' | 'createdAt'>
  const row = automationToRow(auto, userId)

  const { data, error } = await supabase
    .from('automations')
    .insert(row as never)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { automation: rowToAutomation(data as unknown as AutomationRow) },
    { status: 201 },
  )
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
