/**
 * Milestones CRUD — persists Forge AI milestones to Supabase.
 *
 * GET    /api/milestones?projectId=<id>        — list milestones for a project
 * POST   /api/milestones                       — upsert milestones (from Forge AI extraction)
 *        body: { projectId, milestones: Milestone[] }
 * PATCH  /api/milestones?id=<id>               — update status
 *        body: { status: 'pending' | 'in-progress' | 'done' }
 * DELETE /api/milestones?id=<id>               — delete single milestone
 * DELETE /api/milestones?projectId=<id>        — delete all milestones for project
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { Milestone } from '@/lib/types'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  if (!supabase) {
    return NextResponse.json({ milestones: [] })
  }

  let query = supabase
    .from('milestones')
    .select('*')
    .order('phase', { ascending: true })
    .order('created_at', { ascending: true })

  if (projectId) {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Map DB row → app Milestone type
  const milestones: Milestone[] = (data ?? []).map(row => ({
    id:          row.forge_id ?? row.id,
    title:       row.title,
    description: row.description,
    phase:       row.phase,
    status:      row.status as Milestone['status'],
    targetDate:  row.target_date ?? undefined,
  }))

  return NextResponse.json({ milestones })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const body = await req.json() as { projectId?: string; milestones?: Milestone[] }

  if (!body.milestones?.length) {
    return NextResponse.json({ error: 'milestones array is required' }, { status: 400 })
  }

  const rows = body.milestones.map(m => ({
    project_id:  body.projectId ?? null,
    forge_id:    m.id,
    title:       m.title,
    description: m.description,
    phase:       m.phase,
    status:      m.status,
    target_date: m.targetDate ?? null,
  }))

  // Upsert — conflict on (project_id, forge_id) unique index
  const { data, error } = await supabase
    .from('milestones')
    .upsert(rows, { onConflict: 'project_id,forge_id', ignoreDuplicates: false })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ upserted: data?.length ?? 0 }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const body = await req.json() as { status?: Milestone['status'] }
  if (!body.status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 })
  }

  // Try updating by forge_id first, then by UUID
  const { data, error } = await supabase
    .from('milestones')
    .update({ status: body.status })
    .or(`forge_id.eq.${id},id.eq.${id}`)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data?.length ?? 0 })
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const id        = searchParams.get('id')
  const projectId = searchParams.get('projectId')

  if (projectId) {
    const { error } = await supabase.from('milestones').delete().eq('project_id', projectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deleted: 'all for project' })
  }

  if (!id) return NextResponse.json({ error: 'id or projectId is required' }, { status: 400 })

  const { error } = await supabase
    .from('milestones')
    .delete()
    .or(`forge_id.eq.${id},id.eq.${id}`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
