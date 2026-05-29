/**
 * /businesses/[slug]/chat — per-business chat (Phase 5a MVP).
 *
 * Server-renders the business name + verifies ownership, then mounts
 * <BusinessChat>. Multi-session UI is deferred (Phase 5b).
 */

import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import BusinessChat from '@/components/business-chat/BusinessChat'

export const dynamic = 'force-dynamic'

interface BusinessRow { slug: string; name: string | null }

interface Chain<T> {
  eq: (c: string, v: unknown) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

async function loadBusiness(userId: string, slug: string): Promise<BusinessRow | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    // Canonical table is `business_operators` (see lib/business/db.ts header).
    // Earlier drafts of this file queried `businesses` which doesn't exist —
    // hence the 404-on-open-chat bug shipped briefly in #170.
    const res = await (db.from('business_operators' as never) as unknown as { select: (c: string) => Chain<BusinessRow> })
      .select('slug, name')
      .eq('slug', slug)
      .eq('user_id', userId)
      .limit(1)
    return res.data?.[0] ?? null
  } catch { return null }
}

export default async function BusinessChatPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/sign-in')

  const biz = await loadBusiness(userId, slug)
  if (!biz) notFound()

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>
            {biz.name ?? biz.slug} — copilot
          </h1>
          <p className="text-sm mt-1" style={{ color: '#9090b0' }}>
            Interactive chat scoped to this business. Uses per-business connected accounts + falls back to your Shared scope. Approval-gated actions surface as inline buttons.
          </p>
        </div>
        <BusinessChat slug={biz.slug} name={biz.name ?? biz.slug} />
      </div>
    </div>
  )
}
