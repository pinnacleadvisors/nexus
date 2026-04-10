import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Browser / client-side singleton (uses anon key, respects RLS) */
export const supabase = url && anon ? createClient<Database>(url, anon) : null

/** Server-side client — uses service role key when available, falls back to anon */
export function createServerClient() {
  if (!url || !anon) return null
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anon
  return createClient<Database>(url, key)
}

/** Returns true when Supabase is configured */
export function isSupabaseConfigured() {
  return Boolean(url && anon)
}
