'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Brain, FileText, FolderOpen, Search, RefreshCw,
  Loader2, ExternalLink, Edit3, Check, X, ChevronRight,
  ChevronDown, AlertCircle, Plus,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface MemoryFile {
  path: string
  name: string
  sha:  string
  size: number
  type: 'file' | 'dir'
  url:  string
}

interface MemoryPage {
  path:    string
  content: string
  sha:     string
  url:     string
  cached?: boolean
}

interface SearchResult {
  path:    string
  url:     string
  excerpt: string
}

// ── Markdown renderer (minimal, no deps) ──────────────────────────────────────
function renderMarkdown(md: string): string {
  return md
    // code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="md-pre"><code>$1</code></pre>')
    // headings
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="md-h1">$1</h1>')
    // bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`(.+?)`/g, '<code class="md-code">$1</code>')
    // horizontal rule
    .replace(/^---$/gm, '<hr class="md-hr" />')
    // unordered list items
    .replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>')
    // ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="md-li md-oli">$1</li>')
    // blockquote
    .replace(/^> (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>')
    // links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-a">$1</a>')
    // paragraph breaks
    .replace(/\n\n/g, '</p><p class="md-p">')
    // wrap in paragraph
    .replace(/^(?!<[h|p|pre|li|hr|block])(.+)$/gm, '$1')
}

// ── Folder tree node ──────────────────────────────────────────────────────────
function FileNode({
  file,
  depth,
  onSelect,
  selected,
}: {
  file:     MemoryFile
  depth:    number
  onSelect: (path: string) => void
  selected: string
}) {
  const [open,     setOpen]     = useState(depth < 1)
  const [children, setChildren] = useState<MemoryFile[]>([])
  const [loaded,   setLoaded]   = useState(false)
  const [loading,  setLoading]  = useState(false)

  async function toggle() {
    if (file.type !== 'dir') { onSelect(file.path); return }
    setOpen(o => !o)
    if (!loaded) {
      setLoading(true)
      try {
        const res  = await fetch(`/api/memory?path=${encodeURIComponent(file.path)}`, { method: 'GET' })
        // For directory listing we need to use the list endpoint — repurpose GET with a trailing slash signal
        const res2 = await fetch(`/api/memory/list?folder=${encodeURIComponent(file.path)}`)
        if (res2.ok) {
          const data = await res2.json() as { files: MemoryFile[] }
          setChildren(data.files ?? [])
        }
      } catch { /* best-effort */ }
      setLoaded(true)
      setLoading(false)
    }
  }

  const isSelected = selected === file.path
  const indent = depth * 16

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-sm"
        style={{
          paddingLeft: `${8 + indent}px`,
          backgroundColor: isSelected ? 'rgba(108,99,255,0.12)' : 'transparent',
          color: isSelected ? '#a78bfa' : '#9090b0',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0' }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.color = '#9090b0' }}
      >
        {file.type === 'dir' ? (
          <>
            {open ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
            <FolderOpen size={13} style={{ flexShrink: 0 }} />
          </>
        ) : (
          <>
            <span style={{ width: 12, flexShrink: 0 }} />
            <FileText size={13} style={{ flexShrink: 0 }} />
          </>
        )}
        <span className="truncate">{file.name}</span>
        {loading && <Loader2 size={11} className="animate-spin ml-auto shrink-0" />}
      </button>
      {file.type === 'dir' && open && loaded && (
        <div>
          {children.length === 0 ? (
            <div style={{ paddingLeft: `${8 + indent + 16}px`, color: '#55556a', fontSize: 11 }} className="py-1">
              empty
            </div>
          ) : (
            children.map(c => (
              <FileNode key={c.path} file={c} depth={depth + 1} onSelect={onSelect} selected={selected} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MemoryPage() {
  const [configured,    setConfigured]    = useState<boolean | null>(null)
  const [rootFiles,     setRootFiles]     = useState<MemoryFile[]>([])
  const [rootLoading,   setRootLoading]   = useState(true)
  const [selectedPath,  setSelectedPath]  = useState<string>('')
  const [page,          setPage]          = useState<MemoryPage | null>(null)
  const [pageLoading,   setPageLoading]   = useState(false)
  const [editing,       setEditing]       = useState(false)
  const [editContent,   setEditContent]   = useState('')
  const [saving,        setSaving]        = useState(false)
  const [saveResult,    setSaveResult]    = useState<{ ok: boolean } | null>(null)

  // Search
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searching,     setSearching]     = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchDone,    setSearchDone]    = useState(false)

  // New page
  const [newPath,       setNewPath]       = useState('')
  const [newContent,    setNewContent]    = useState('')
  const [creating,      setCreating]      = useState(false)
  const [createResult,  setCreateResult]  = useState<{ ok: boolean; url?: string } | null>(null)

  // Load root file tree
  const loadRoot = useCallback(async () => {
    setRootLoading(true)
    try {
      const res = await fetch('/api/memory/list?folder=')
      if (res.status === 503) { setConfigured(false); setRootLoading(false); return }
      if (!res.ok) { setRootLoading(false); return }
      const data = await res.json() as { files: MemoryFile[]; configured: boolean }
      setConfigured(data.configured ?? true)
      setRootFiles(data.files ?? [])
    } catch {
      setConfigured(false)
    } finally {
      setRootLoading(false)
    }
  }, [])

  useEffect(() => { loadRoot() }, [loadRoot])

  // Load a selected page
  async function loadPage(path: string) {
    if (!path.endsWith('.md')) return
    setSelectedPath(path)
    setPageLoading(true)
    setPage(null)
    setEditing(false)
    try {
      const res = await fetch(`/api/memory?path=${encodeURIComponent(path)}`)
      if (!res.ok) { setPageLoading(false); return }
      const data = await res.json() as MemoryPage
      setPage(data)
    } finally {
      setPageLoading(false)
    }
  }

  // Search
  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchDone(false)
    setSearchResults([])
    try {
      const res  = await fetch(`/api/memory/search?q=${encodeURIComponent(searchQuery)}&limit=15`)
      const data = await res.json() as { results: SearchResult[] }
      setSearchResults(data.results ?? [])
    } finally {
      setSearching(false)
      setSearchDone(true)
    }
  }

  // Inline editor save
  async function handleSave() {
    if (!page || !editContent.trim()) return
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch('/api/memory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: page.path, content: editContent, message: `nexus: edit ${page.path}` }),
      })
      if (res.ok) {
        const data = await res.json() as { sha: string; url: string }
        setPage({ ...page, content: editContent, sha: data.sha, url: data.url })
        setEditing(false)
        setSaveResult({ ok: true })
      } else {
        setSaveResult({ ok: false })
      }
    } catch {
      setSaveResult({ ok: false })
    } finally {
      setSaving(false)
    }
  }

  // Create new page
  async function handleCreate() {
    if (!newPath.trim() || !newContent.trim()) return
    setCreating(true)
    setCreateResult(null)
    try {
      const path = newPath.trim().endsWith('.md') ? newPath.trim() : `${newPath.trim()}.md`
      const res  = await fetch('/api/memory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: newContent }),
      })
      if (res.ok) {
        const data = await res.json() as { url: string }
        setCreateResult({ ok: true, url: data.url })
        setNewPath('')
        setNewContent('')
        loadRoot()
      } else {
        setCreateResult({ ok: false })
      }
    } catch {
      setCreateResult({ ok: false })
    } finally {
      setCreating(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      {/* Back */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-xs mb-6 no-underline"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#e8e8f0')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#9090b0')}
      >
        <ArrowLeft size={13} /> Back to Tools
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
        >
          <Brain size={20} style={{ color: '#6c63ff' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>Memory Engine</h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            Version-controlled agent knowledge base — stored in{' '}
            <code style={{ fontSize: 11, color: '#6c63ff' }}>pinnacleadvisors/nexus-memory</code>
          </p>
        </div>
      </div>

      {/* Not configured banner */}
      {configured === false && (
        <div
          className="flex items-start gap-3 rounded-xl p-4 mb-6"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Memory engine not configured</p>
            <p className="text-xs mt-1" style={{ color: '#9090b0' }}>
              Set <code style={{ color: '#a78bfa' }}>GITHUB_MEMORY_TOKEN</code> (PAT with repo scope) and{' '}
              <code style={{ color: '#a78bfa' }}>GITHUB_MEMORY_REPO</code> (e.g.{' '}
              <code style={{ color: '#a78bfa' }}>pinnacleadvisors/nexus-memory</code>) in Doppler to activate.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5" style={{ gridTemplateColumns: '260px 1fr' }}>
        {/* ── Left: file tree + search ──────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Search */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#55556a' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                  placeholder="Search memory…"
                  className="w-full rounded-lg pl-7 pr-3 py-2 text-xs outline-none"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                  onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                  onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-3 py-2 rounded-lg text-xs font-semibold"
                style={
                  searchQuery.trim() && !searching
                    ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                    : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
                }
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              </button>
            </div>

            {/* Search results */}
            {searchDone && (
              <div className="mt-3 space-y-1">
                {searchResults.length === 0 ? (
                  <p className="text-xs" style={{ color: '#55556a' }}>No results.</p>
                ) : (
                  searchResults.map(r => (
                    <button
                      key={r.path}
                      onClick={() => loadPage(r.path)}
                      className="w-full text-left rounded-lg px-2 py-1.5 block"
                      style={{ cursor: 'pointer' }}
                    >
                      <p className="text-xs font-medium truncate" style={{ color: '#a78bfa' }}>{r.path}</p>
                      {r.excerpt && (
                        <p className="text-xs truncate mt-0.5" style={{ color: '#55556a' }}>{r.excerpt}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* File tree */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid #1a1a2e' }}
            >
              <span className="text-xs font-semibold" style={{ color: '#e8e8f0' }}>File Tree</span>
              <button
                onClick={loadRoot}
                disabled={rootLoading}
                className="p-1 rounded"
                style={{ color: '#55556a', cursor: 'pointer' }}
              >
                <RefreshCw size={12} className={rootLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="p-2 max-h-96 overflow-y-auto">
              {rootLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin" style={{ color: '#55556a' }} />
                </div>
              ) : rootFiles.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: '#55556a' }}>
                  {configured === false ? 'Configure memory to see files.' : 'Repository is empty.'}
                </p>
              ) : (
                rootFiles.map(f => (
                  <FileNode
                    key={f.path}
                    file={f}
                    depth={0}
                    onSelect={loadPage}
                    selected={selectedPath}
                  />
                ))
              )}
            </div>
          </div>

          {/* Create new page */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <div className="flex items-center gap-2 mb-3">
              <Plus size={13} style={{ color: '#6c63ff' }} />
              <span className="text-xs font-semibold" style={{ color: '#e8e8f0' }}>New page</span>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                placeholder="path/to/page.md"
                className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
              />
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Markdown content…"
                rows={4}
                className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                onFocus={e => ((e.target as HTMLTextAreaElement).style.borderColor = '#6c63ff')}
                onBlur={e => ((e.target as HTMLTextAreaElement).style.borderColor = '#24243e')}
              />
              <button
                onClick={handleCreate}
                disabled={!newPath.trim() || !newContent.trim() || creating}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold"
                style={
                  newPath.trim() && newContent.trim() && !creating
                    ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                    : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
                }
              >
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {creating ? 'Creating…' : 'Create page'}
              </button>
              {createResult && (
                <p className="text-xs" style={{ color: createResult.ok ? '#22c55e' : '#ef4444' }}>
                  {createResult.ok
                    ? <>Saved!{createResult.url && <> · <a href={createResult.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6c63ff' }}>View on GitHub</a></>}</>
                    : 'Failed to create page.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: page viewer / editor ───────────────────────────────────── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e', minHeight: 400 }}
        >
          {!selectedPath ? (
            <div className="flex flex-col items-center justify-center h-full py-20" style={{ color: '#55556a' }}>
              <FileText size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p className="text-sm">Select a file from the tree to read it</p>
            </div>
          ) : pageLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={20} className="animate-spin" style={{ color: '#55556a' }} />
            </div>
          ) : !page ? (
            <div className="flex flex-col items-center justify-center py-20" style={{ color: '#55556a' }}>
              <AlertCircle size={24} style={{ marginBottom: 8 }} />
              <p className="text-sm">Could not load page</p>
            </div>
          ) : (
            <>
              {/* Page header */}
              <div
                className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: '1px solid #1a1a2e' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>{page.path}</p>
                  {page.cached && (
                    <p className="text-xs" style={{ color: '#55556a' }}>cached · refreshes in 5 min</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-xs no-underline"
                    style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}
                    title="View on GitHub"
                  >
                    <ExternalLink size={13} />
                  </a>
                  {!editing ? (
                    <button
                      onClick={() => { setEditContent(page.content); setEditing(true) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: '#1a1a2e', color: '#9090b0', cursor: 'pointer' }}
                    >
                      <Edit3 size={12} /> Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEditing(false)}
                        className="p-1.5 rounded-lg"
                        style={{ backgroundColor: '#1a1a2e', color: '#ef4444', cursor: 'pointer' }}
                        title="Cancel"
                      >
                        <X size={13} />
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={
                          !saving
                            ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                            : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
                        }
                      >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {saveResult && (
                <div
                  className="px-5 py-2 text-xs flex items-center gap-1.5"
                  style={{ color: saveResult.ok ? '#22c55e' : '#ef4444', borderBottom: '1px solid #1a1a2e' }}
                >
                  {saveResult.ok ? <Check size={12} /> : <X size={12} />}
                  {saveResult.ok ? 'Saved and committed to GitHub.' : 'Save failed — check console.'}
                </div>
              )}

              {/* Editor / viewer */}
              {editing ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full p-5 text-sm font-mono outline-none resize-none"
                  style={{
                    backgroundColor: '#0d0d14',
                    color: '#e8e8f0',
                    minHeight: 480,
                    border: 'none',
                    lineHeight: 1.6,
                  }}
                />
              ) : (
                <div
                  className="p-5 overflow-y-auto"
                  style={{ maxHeight: 680 }}
                >
                  <style>{`
                    .md-h1 { font-size: 1.4rem; font-weight: 700; color: #e8e8f0; margin-bottom: 0.5rem; }
                    .md-h2 { font-size: 1.15rem; font-weight: 600; color: #e8e8f0; margin: 1.2rem 0 0.4rem; }
                    .md-h3 { font-size: 1rem; font-weight: 600; color: #c0c0d8; margin: 1rem 0 0.3rem; }
                    .md-p  { color: #9090b0; line-height: 1.7; margin-bottom: 0.75rem; }
                    .md-code { background: #1a1a2e; color: #a78bfa; padding: 1px 5px; border-radius: 4px; font-size: 0.82em; font-family: monospace; }
                    .md-pre  { background: #0d0d14; border: 1px solid #1a1a2e; border-radius: 8px; padding: 12px; overflow-x: auto; margin: 0.75rem 0; }
                    .md-pre code { color: #c0c0d8; font-family: monospace; font-size: 0.83em; }
                    .md-hr { border: none; border-top: 1px solid #24243e; margin: 1rem 0; }
                    .md-li { color: #9090b0; line-height: 1.6; margin-left: 1.2rem; list-style: disc; }
                    .md-oli { list-style: decimal; }
                    .md-bq { border-left: 3px solid #6c63ff; padding-left: 12px; color: #7070a0; font-style: italic; margin: 0.5rem 0; }
                    .md-a  { color: #6c63ff; text-decoration: underline; }
                  `}</style>
                  <div
                    className="md-p"
                    dangerouslySetInnerHTML={{ __html: `<p class="md-p">${renderMarkdown(page.content)}</p>` }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
