/**
 * Ideas CRUD — persists captured idea cards for the signed-in Clerk user.
 *
 * GET    /api/ideas              — list current user's ideas (newest first)
 * POST   /api/ideas              — create idea (server-side use only; the
 *                                   /api/idea/analyse route also inserts here
 *                                   after agent response)
 * DELETE /api/ideas?id=<id>      — delete one idea (cascades its automations)
 *
 * When Supabase is not configured this route returns an empty list on GET and
 * 503 on writes; pages fall back to localStorage automatically.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { IdeaCard } from '@/lib/types'
import { rowToIdeaCard, ideaCardToRow, type IdeaRow } from '@/lib/idea-db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ ideas: [] })

  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as IdeaRow[]
  return NextResponse.json({ ideas: rows.map(rowToIdeaCard) })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const card = (await req.json()) as Omit<IdeaCard, 'id' | 'createdAt'>
  const row = ideaCardToRow(card, userId)

  const { data, error } = await supabase
    .from('ideas')
    .insert(row as never)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ idea: rowToIdeaCard(data as unknown as IdeaRow) }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase
    .from('ideas')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
