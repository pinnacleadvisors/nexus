'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BookOpen, FileText, Plus, ExternalLink, Loader2,
  CheckCircle2, XCircle, Search, RefreshCw, Link2, Link2Off,
  FolderOpen, Upload, BookMarked,
} from 'lucide-react'
import type { ForgeProject } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────
interface NotionPage { id: string; title: string; url: string; editedAt: string }
interface DriveFile  { id: string; name: string; webViewLink: string; mimeType: string }

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadLinkedPage(projectId: string): string {
  try { return localStorage.getItem(`knowledge:notion:${projectId}`) ?? '' } catch { return '' }
}
function saveLinkedPage(projectId: string, pageId: string) {
  try {
    if (pageId) localStorage.setItem(`knowledge:notion:${projectId}`, pageId)
    else localStorage.removeItem(`knowledge:notion:${projectId}`)
  } catch {}
}
function loadLocalProjects(): ForgeProject[] {
  try {
    const raw = localStorage.getItem('forge:projects')
    return raw ? (JSON.parse(raw) as ForgeProject[]) : []
  } catch { return [] }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = 'notion' | 'drive' | 'obsidian'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function KnowledgePage() {
  const [activeTab,       setActiveTab]       = useState<Tab>('notion')
  const [notionPages,     setNotionPages]     = useState<NotionPage[]>([])
  const [notionConnected, setNotionConnected] = useState(false)
  const [notionLoading,   setNotionLoading]   = useState(true)
  const [notionSearch,    setNotionSearch]    = useState('')
  const [driveFiles,      setDriveFiles]      = useState<DriveFile[]>([])
  const [driveConnected,  setDriveConnected]  = useState(false)
  const [driveLoading,    setDriveLoading]    = useState(false)
  const [projects,        setProjects]        = useState<ForgeProject[]>([])
  const [activeProject,   setActiveProject]   = useState<string>('default')
  const [linkedPageId,    setLinkedPageId]    = useState<string>('')
  const [createTitle,     setCreateTitle]     = useState('')
  const [creating,        setCreating]        = useState(false)
  const [createResult,    setCreateResult]    = useState<{ ok: boolean; url?: string } | null>(null)

  // Upload to Drive
  const [uploadName,      setUploadName]      = useState('')
  const [uploadUrl,       setUploadUrl]       = useState('')
  const [uploading,       setUploading]       = useState(false)
  const [uploadResult,    setUploadResult]    = useState<{ ok: boolean; url?: string } | null>(null)

  // Obsidian config
  const [obsidianUrl,     setObsidianUrl]     = useState('')
  const [obsidianKey,     setObsidianKey]     = useState('')
  const [obsidianSaved,   setObsidianSaved]   = useState(false)

  // Load Obsidian config from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('knowledge:obsidian')
      if (saved) {
        const { url, key } = JSON.parse(saved) as { url: string; key: string }
        setObsidianUrl(url ?? '')
        setObsidianKey(key ?? '')
      }
    } catch {}

    const ps = loadLocalProjects()
    setProjects(ps)
    const defaultProject = ps[0]?.id ?? 'default'
    setActiveProject(defaultProject)
    setLinkedPageId(loadLinkedPage(defaultProject))
  }, [])

  // Load Notion pages
  const fetchNotionPages = useCallback(async () => {
    setNotionLoading(true)
    try {
      const res = await fetch('/api/notion?limit=40')
      if (res.status === 401) { setNotionConnected(false); setNotionLoading(false); return }
      const data = await res.json() as { pages: NotionPage[] }
      setNotionPages(data.pages ?? [])
      setNotionConnected(true)
    } catch {
      setNotionConnected(false)
    } finally {
      setNotionLoading(false)
    }
  }, [])

  // Load Drive files
  const fetchDriveFiles = useCallback(async () => {
    setDriveLoading(true)
    try {
      const res = await fetch('/api/gdrive/upload', { method: 'GET' }).catch(() => null)
      // GET not implemented — just check connection via oauth status
      const oauthRes = await fetch('/api/oauth/status')
      const oauthData = await oauthRes.json() as { connections: Array<{ provider: string }> }
      setDriveConnected(oauthData.connections.some(c => c.provider === 'google'))
      setDriveFiles([])
    } catch {
      setDriveConnected(false)
    } finally {
      setDriveLoading(false)
    }
  }, [])

  useEffect(() => { fetchNotionPages() }, [fetchNotionPages])
  useEffect(() => { if (activeTab === 'drive') fetchDriveFiles() }, [activeTab, fetchDriveFiles])

  // Sync linked page when project changes
  useEffect(() => {
    setLinkedPageId(loadLinkedPage(activeProject))
  }, [activeProject])

  function handleLinkPage(pageId: string) {
    setLinkedPageId(pageId)
    saveLinkedPage(activeProject, pageId)
  }

  function handleUnlink() {
    setLinkedPageId('')
    saveLinkedPage(activeProject, '')
  }

  async function handleCreatePage() {
    if (!createTitle.trim()) return
    setCreating(true)
    setCreateResult(null)

    const parentPageId = linkedPageId || undefined
    if (!parentPageId) {
      setCreateResult({ ok: false })
      setCreating(false)
      return
    }

    const res = await fetch('/api/notion', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentPageId,
        title: createTitle.trim(),
        content: [
          { type: 'callout', text: `Created by Nexus on ${new Date().toLocaleDateString()}`, emoji: '📝' },
          { type: 'paragraph', text: '' },
        ],
      }),
    })
    const data = await res.json() as { id?: string; url?: string; error?: string }
    setCreating(false)
    if (res.ok && data.url) {
      setCreateResult({ ok: true, url: data.url })
      setCreateTitle('')
      fetchNotionPages()
    } else {
      setCreateResult({ ok: false })
    }
  }

  async function handleDriveUpload() {
    if (!uploadUrl.trim() || !uploadName.trim()) return
    setUploading(true)
    setUploadResult(null)
    const res = await fetch('/api/gdrive/upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pdf', name: uploadName.trim(), url: uploadUrl.trim() }),
    })
    const data = await res.json() as { webViewLink?: string }
    setUploading(false)
    if (res.ok) {
      setUploadResult({ ok: true, url: data.webViewLink })
      setUploadUrl('')
      setUploadName('')
    } else {
      setUploadResult({ ok: false })
    }
  }

  function saveObsidian() {
    try {
      localStorage.setItem('knowledge:obsidian', JSON.stringify({ url: obsidianUrl, key: obsidianKey }))
      setObsidianSaved(true)
      setTimeout(() => setObsidianSaved(false), 3000)
    } catch {}
  }

  const filteredPages = notionSearch
    ? notionPages.filter(p => p.title.toLowerCase().includes(notionSearch.toLowerCase()))
    : notionPages

  const linkedPage = notionPages.find(p => p.id === linkedPageId)
  const projectName = projects.find(p => p.id === activeProject)?.name ?? 'Default Project'

  const TAB_STYLE = (t: Tab) =>
    activeTab === t
      ? { backgroundColor: '#1a1a2e', color: '#e8e8f0' }
      : { color: '#55556a', cursor: 'pointer' }

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
          <BookOpen size={20} style={{ color: '#6c63ff' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>Knowledge Base</h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            Connect Notion or Google Drive to give agents persistent memory across sessions.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
        {(['notion', 'drive', 'obsidian'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 text-sm rounded-lg font-medium capitalize"
            style={TAB_STYLE(tab)}
          >
            {tab === 'notion' ? 'Notion' : tab === 'drive' ? 'Google Drive' : 'Obsidian'}
          </button>
        ))}
      </div>

      {/* ── NOTION TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'notion' && (
        <div className="space-y-5">
          {/* Connection status */}
          {!notionConnected && !notionLoading && (
            <div className="rounded-xl p-4" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={14} style={{ color: '#ef4444' }} />
                <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Notion not connected</p>
              </div>
              <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
                Connect your Notion workspace to give agents a persistent knowledge base.
                Research notes, milestones, and assets will be stored and retrieved automatically.
              </p>
              <a
                href="/api/oauth/notion"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg no-underline font-medium"
                style={{ background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff' }}
              >
                <FileText size={12} /> Connect Notion
              </a>
            </div>
          )}

          {notionConnected && (
            <>
              {/* Project + linked page */}
              <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Link2 size={14} style={{ color: '#6c63ff' }} />
                  <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
                    Project Knowledge Link
                  </h2>
                </div>
                <p className="text-xs mb-4" style={{ color: '#9090b0' }}>
                  Link a Notion page to a Forge project. The agent will read this page before each reply
                  (RAG), and completed milestones will automatically append to it.
                </p>

                {/* Project selector */}
                {projects.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs font-medium mb-1.5 block" style={{ color: '#9090b0' }}>Project</label>
                    <select
                      value={activeProject}
                      onChange={e => setActiveProject(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                    >
                      <option value="default">Default project</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Linked page display */}
                {linkedPageId && linkedPage ? (
                  <div
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 mb-3"
                    style={{ backgroundColor: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                      <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{linkedPage.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a href={linkedPage.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs no-underline" style={{ color: '#6c63ff' }}>
                        <ExternalLink size={12} />
                      </a>
                      <button onClick={handleUnlink} className="text-xs" style={{ color: '#55556a', cursor: 'pointer' }}
                        title="Unlink">
                        <Link2Off size={12} />
                      </button>
                    </div>
                  </div>
                ) : linkedPageId ? (
                  <div className="text-xs mb-3" style={{ color: '#f59e0b' }}>
                    Page ID set but not found in workspace — pick a page below.
                  </div>
                ) : (
                  <div className="text-xs mb-3" style={{ color: '#55556a' }}>
                    No page linked for <strong style={{ color: '#9090b0' }}>{projectName}</strong>. Select one below.
                  </div>
                )}

                {/* Create new page */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={createTitle}
                    onChange={e => setCreateTitle(e.target.value)}
                    placeholder="New page title (creates under linked page)…"
                    disabled={!linkedPageId || creating}
                    className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                    style={{
                      backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0',
                      opacity: !linkedPageId ? 0.5 : 1,
                    }}
                    onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                    onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreatePage() }}
                  />
                  <button
                    onClick={handleCreatePage}
                    disabled={!createTitle.trim() || !linkedPageId || creating}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                    style={
                      createTitle.trim() && linkedPageId && !creating
                        ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                        : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: 'not-allowed' }
                    }
                  >
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
                {createResult && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: createResult.ok ? '#22c55e' : '#ef4444' }}>
                    {createResult.ok
                      ? <><CheckCircle2 size={12} /> Page created —{' '}
                          <a href={createResult.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6c63ff' }}>open in Notion</a></>
                      : <><XCircle size={12} /> Failed — make sure a page is linked above</>
                    }
                  </div>
                )}
              </div>

              {/* Page list */}
              <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Workspace Pages</h2>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1a1a2e', color: '#55556a' }}>
                    {notionPages.length}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                      <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#55556a' }} />
                      <input
                        type="text"
                        value={notionSearch}
                        onChange={e => setNotionSearch(e.target.value)}
                        placeholder="Filter pages…"
                        className="rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none"
                        style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#e8e8f0', width: 160 }}
                      />
                    </div>
                    <button onClick={fetchNotionPages} disabled={notionLoading}
                      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
                      style={{ backgroundColor: '#0d0d14', color: '#55556a', border: '1px solid #1a1a2e', cursor: 'pointer' }}>
                      <RefreshCw size={11} className={notionLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                {notionLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={18} className="animate-spin" style={{ color: '#55556a' }} />
                  </div>
                ) : filteredPages.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm" style={{ color: '#55556a' }}>
                      {notionSearch ? 'No pages match your filter.' : 'No pages found in workspace.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y max-h-96 overflow-y-auto" style={{ borderColor: '#1a1a2e' }}>
                    {filteredPages.map(page => {
                      const isLinked = page.id === linkedPageId
                      return (
                        <div
                          key={page.id}
                          className="flex items-center justify-between px-5 py-3"
                          style={{ backgroundColor: isLinked ? 'rgba(108,99,255,0.06)' : 'transparent' }}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText size={13} style={{ color: isLinked ? '#6c63ff' : '#55556a', flexShrink: 0 }} />
                            <div className="min-w-0">
                              <p className="text-sm truncate" style={{ color: '#e8e8f0' }}>{page.title}</p>
                              <p className="text-xs" style={{ color: '#55556a' }}>
                                Edited {new Date(page.editedAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a href={page.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs p-1 rounded no-underline" style={{ color: '#55556a' }}
                              title="Open in Notion">
                              <ExternalLink size={12} />
                            </a>
                            {isLinked ? (
                              <button onClick={handleUnlink}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                                style={{ backgroundColor: 'rgba(108,99,255,0.1)', color: '#6c63ff', border: '1px solid rgba(108,99,255,0.25)', cursor: 'pointer' }}>
                                <Link2Off size={11} /> Unlink
                              </button>
                            ) : (
                              <button onClick={() => handleLinkPage(page.id)}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                                style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e', cursor: 'pointer' }}>
                                <Link2 size={11} /> Link
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── GOOGLE DRIVE TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'drive' && (
        <div className="space-y-5">
          {!driveConnected ? (
            <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={14} style={{ color: '#ef4444' }} />
                <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Google Drive not connected</p>
              </div>
              <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
                Connect Google to let agents upload PDFs, create Docs, and store assets directly in your Drive.
              </p>
              <a
                href="/api/oauth/google"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg no-underline font-medium"
                style={{ background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff' }}
              >
                <FolderOpen size={12} /> Connect Google Drive
              </a>
            </div>
          ) : (
            <>
              <div
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}
              >
                <CheckCircle2 size={11} /> Google connected
              </div>

              {/* PDF upload */}
              <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Upload size={14} style={{ color: '#6c63ff' }} />
                  <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Upload PDF to Drive</h2>
                </div>
                <p className="text-xs mb-4" style={{ color: '#9090b0' }}>
                  Paste a URL to a PDF (e.g. exported business plan) and upload it to your Google Drive.
                  Agents will use the Drive link as the asset URL in Kanban cards.
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                    placeholder="File name (e.g. Market Research Q1 2026)"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                    onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                    onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={uploadUrl}
                      onChange={e => setUploadUrl(e.target.value)}
                      placeholder="https://example.com/report.pdf"
                      className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                      onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                      onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                    />
                    <button
                      onClick={handleDriveUpload}
                      disabled={!uploadUrl.trim() || !uploadName.trim() || uploading}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                      style={
                        uploadUrl.trim() && uploadName.trim() && !uploading
                          ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                          : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: 'not-allowed' }
                      }
                    >
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {uploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                </div>
                {uploadResult && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs"
                    style={{ color: uploadResult.ok ? '#22c55e' : '#ef4444' }}>
                    {uploadResult.ok
                      ? <><CheckCircle2 size={12} /> Uploaded —{' '}
                          <a href={uploadResult.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6c63ff' }}>
                            View in Drive
                          </a></>
                      : <><XCircle size={12} /> Upload failed</>
                    }
                  </div>
                )}
              </div>

              {driveFiles.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
                  <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #1a1a2e' }}>
                    <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Recent Files</h2>
                  </div>
                  <div className="divide-y" style={{ borderColor: '#1a1a2e' }}>
                    {driveFiles.map(f => (
                      <div key={f.id} className="flex items-center justify-between px-5 py-3">
                        <p className="text-sm truncate" style={{ color: '#e8e8f0' }}>{f.name}</p>
                        <a href={f.webViewLink} target="_blank" rel="noopener noreferrer"
                          className="text-xs no-underline" style={{ color: '#6c63ff' }}>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── OBSIDIAN TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'obsidian' && (
        <div className="space-y-5">
          {/* What is the Obsidian alternative */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <BookMarked size={14} style={{ color: '#6c63ff' }} />
              <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Self-hosted alternative to Notion</h2>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
              Obsidian stores notes as local Markdown files — nothing in the cloud unless you choose Obsidian Sync.
              To connect Obsidian to Nexus, install the{' '}
              <strong style={{ color: '#e8e8f0' }}>Local REST API</strong> community plugin, which exposes a
              local HTTP server your agents can read and write to.
            </p>
          </div>

          {/* Setup steps */}
          <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: '#e8e8f0' }}>Setup steps</h2>
            <ol className="space-y-3">
              {[
                { n: 1, text: 'Install Obsidian from obsidian.md and create or open a vault.' },
                { n: 2, text: 'Open Settings → Community plugins → Browse → search "Local REST API" → Install & Enable.' },
                { n: 3, text: 'In the Local REST API plugin settings, note your API Key and port (default: 27123).' },
                { n: 4, text: 'If using Obsidian Sync (paid), enable sync in Settings → Sync → your plan.' },
                { n: 5, text: 'Enter your local REST API URL and key below, then save.' },
                { n: 6, text: 'Agents will POST /vault/{filename}.md to create notes, and GET /vault/ to list them.' },
              ].map(step => (
                <li key={step.n} className="flex items-start gap-3">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                    style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
                  >
                    {step.n}
                  </span>
                  <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* Local REST API config */}
          <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: '#e8e8f0' }}>Local REST API config</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: '#9090b0' }}>
                  API URL <span style={{ color: '#55556a' }}>(e.g. http://localhost:27123)</span>
                </label>
                <input
                  type="url"
                  value={obsidianUrl}
                  onChange={e => setObsidianUrl(e.target.value)}
                  placeholder="http://localhost:27123"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                  onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                  onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: '#9090b0' }}>API Key</label>
                <input
                  type="password"
                  value={obsidianKey}
                  onChange={e => setObsidianKey(e.target.value)}
                  placeholder="your-obsidian-rest-api-key"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
                  onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
                  onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
                />
              </div>
              <button
                onClick={saveObsidian}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }}
              >
                {obsidianSaved ? <CheckCircle2 size={14} /> : null}
                {obsidianSaved ? 'Saved!' : 'Save config'}
              </button>
              <p className="text-xs" style={{ color: '#55556a' }}>
                Config stored in browser localStorage — not sent to any server.
                Agents use this URL directly via the OpenClaw gateway.
              </p>
            </div>
          </div>

          {/* Obsidian Sync note */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: '#e8e8f0' }}>Obsidian Sync (optional)</p>
            <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
              With Obsidian Sync enabled, your vault is encrypted and synced across devices at rest.
              Agents write to your local machine via the REST API; Sync handles propagation.
              Note: Obsidian Sync has no public API — agents can only access the vault through the local REST API plugin.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
