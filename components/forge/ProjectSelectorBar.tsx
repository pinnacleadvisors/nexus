'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, Trash2, Edit2, Check, X, FolderOpen } from 'lucide-react'
import type { ForgeProject } from '@/lib/types'

interface Props {
  projects: ForgeProject[]
  activeProjectId: string
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export default function ProjectSelectorBar({
  projects,
  activeProjectId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const activeProject = projects.find(p => p.id === activeProjectId)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setEditingId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  function startEdit(project: ForgeProject, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(project.id)
    setEditValue(project.name)
  }

  function commitEdit() {
    if (!editingId) return
    const trimmed = editValue.trim()
    if (trimmed) onRename(editingId, trimmed)
    setEditingId(null)
  }

  function handleEditKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditingId(null)
  }

  function handleDelete(project: ForgeProject, e: React.MouseEvent) {
    e.stopPropagation()
    if (projects.length <= 1) return // never delete the last project
    onDelete(project.id)
    setOpen(false)
  }

  function handleSelect(id: string) {
    if (editingId) return
    onSelect(id)
    setOpen(false)
  }

  function handleNew() {
    onNew()
    setOpen(false)
  }

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-4 h-10"
      style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
    >
      <FolderOpen size={14} style={{ color: '#6c63ff' }} />

      {/* Project selector dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-medium transition-colors"
          style={{ color: '#e8e8f0', backgroundColor: open ? '#1a1a2e' : 'transparent' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e' }}
          onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
        >
          <span className="max-w-[200px] truncate">{activeProject?.name ?? 'Select project'}</span>
          <ChevronDown
            size={13}
            style={{
              color: '#9090b0',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
            }}
          />
        </button>

        {open && (
          <div
            className="absolute top-full left-0 mt-1 w-64 rounded-xl py-1 z-50 shadow-xl"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => handleSelect(project.id)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer group"
                style={{
                  backgroundColor: project.id === activeProjectId ? '#1a1a2e' : 'transparent',
                  color: project.id === activeProjectId ? '#e8e8f0' : '#9090b0',
                }}
                onMouseEnter={e => {
                  if (project.id !== activeProjectId)
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = '#1a1a2e'
                }}
                onMouseLeave={e => {
                  if (project.id !== activeProjectId)
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
                }}
              >
                {editingId === project.id ? (
                  <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                    <input
                      ref={editInputRef}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={handleEditKey}
                      className="flex-1 text-sm bg-transparent outline-none"
                      style={{
                        color: '#e8e8f0',
                        borderBottom: '1px solid #6c63ff',
                      }}
                    />
                    <button onClick={commitEdit} style={{ color: '#22c55e' }}>
                      <Check size={12} />
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ color: '#55556a' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-sm truncate">{project.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => startEdit(project, e)}
                        className="p-0.5 rounded"
                        style={{ color: '#9090b0' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
                        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#9090b0')}
                      >
                        <Edit2 size={11} />
                      </button>
                      {projects.length > 1 && (
                        <button
                          onClick={e => handleDelete(project, e)}
                          className="p-0.5 rounded"
                          style={{ color: '#9090b0' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
                          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#9090b0')}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            <div style={{ borderTop: '1px solid #24243e', margin: '4px 0' }} />

            <button
              onClick={handleNew}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: '#6c63ff' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
            >
              <Plus size={13} />
              New project
            </button>
          </div>
        )}
      </div>

      {/* Project count badge */}
      {projects.length > 1 && (
        <span className="text-xs" style={{ color: '#55556a' }}>
          {projects.length} projects
        </span>
      )}
    </div>
  )
}
