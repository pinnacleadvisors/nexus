/**
 * GET /api/memory/list?folder=<folder>
 *
 * List files and directories in a folder of the memory repo.
 * folder="" lists the root.
 * Returns { files: MemoryFile[], configured: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listPages, isMemoryConfigured } from '@/lib/memory/github'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMemoryConfigured()) {
    return NextResponse.json({ files: [], configured: false })
  }

  const folder = req.nextUrl.searchParams.get('folder') ?? ''
  const files  = await listPages(folder)
  return NextResponse.json({ files, configured: true })
}
