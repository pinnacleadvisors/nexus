/**
 * GET /api/build/filetree
 * Returns a condensed file tree of the Nexus repo for context injection.
 * Excludes node_modules, .git, .next, build artifacts.
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import type { Dirent } from 'fs'
import { join } from 'path'

const REPO_ROOT = process.cwd()

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.next', 'out', 'dist', 'build',
  '.turbo', '.vercel', 'coverage', '__pycache__', '.cache',
])

const EXCLUDE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db',
])

const INCLUDE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md', '.sql', '.yaml', '.yml', '.env.example',
])

async function buildTree(
  dir: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (depth > maxDepth) return

  let entries: Dirent<string>[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }

  // Sort: dirs first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (EXCLUDE_FILES.has(entry.name)) continue

    const indent = '  '.repeat(depth)

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      lines.push(`${indent}${entry.name}/`)
      await buildTree(join(dir, entry.name), depth + 1, maxDepth, lines)
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'))
      if (!INCLUDE_EXTENSIONS.has(ext)) continue
      lines.push(`${indent}${entry.name}`)
    }
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lines: string[] = []
  await buildTree(REPO_ROOT, 0, 3, lines)

  return NextResponse.json({
    tree:  lines.join('\n'),
    lines: lines.length,
    root:  REPO_ROOT,
  })
}
