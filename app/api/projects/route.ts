/**
 * Projects CRUD — syncs Forge projects to Supabase.
 * Falls back to empty list when Supabase is not configured.
 *
 * GET    /api/projects              — list all projects
 * POST   /api/projects              — create project { name, userId? }
 * PATCH  /api/projects?id=<id>      — rename project { name }
 * DELETE /api/projects?id=<id>      — delete project (cascades milestones + tasks)
 *
 * Note: the canonical column is `title` (regenerated database.types.ts).
 * The wire API still accepts/returns `name` for back-compat with existing
 * callers (Forge UI, board page, knowledge page). Migration 032 ensures
 * the column is named `title` on the live DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerClient()

  if (!supabase) {
    return NextResponse.json({ projects: [] })
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, title, user_id, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-emit `title` as `name` so existing client code keeps working.
  const projects = (data ?? []).map(row => ({
    id:         row.id,
    name:       row.title,
    user_id:    row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
  return NextResponse.json({ projects })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const body = await req.json() as { name?: string; userId?: string }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({ title: body.name.trim(), user_id: body.userId ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ project: data ? { ...data, name: data.title } : null }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const body = await req.json() as { name?: string }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ title: body.name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ project: data ? { ...data, name: data.title } : null })
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
