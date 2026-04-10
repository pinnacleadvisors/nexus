'use client'

import { useState, useEffect } from 'react'
import type { ForgeProject } from '@/lib/types'
import ProjectSelectorBar from '@/components/forge/ProjectSelectorBar'
import ForgeSession from '@/components/forge/ForgeSession'

// ── localStorage helpers ──────────────────────────────────────────────────────
const PROJECTS_KEY = 'forge:projects'
const ACTIVE_KEY = 'forge:active'

function loadProjects(): ForgeProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    return raw ? (JSON.parse(raw) as ForgeProject[]) : []
  } catch {
    return []
  }
}

function saveProjects(projects: ForgeProject[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
  } catch {
    // Ignore quota errors
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function saveActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // Ignore quota errors
  }
}

function makeProject(name: string): ForgeProject {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ForgePage() {
  const [projects, setProjects] = useState<ForgeProject[]>([])
  const [activeId, setActiveId] = useState<string>('')

  // Initialise from localStorage once on mount
  useEffect(() => {
    let saved = loadProjects()
    if (saved.length === 0) {
      const defaultProject = makeProject('My First Business')
      saved = [defaultProject]
      saveProjects(saved)
    }
    setProjects(saved)

    const storedActive = loadActiveId()
    const validActive = saved.find(p => p.id === storedActive)
    const id = validActive ? storedActive! : saved[0].id
    setActiveId(id)
    saveActiveId(id)
  }, [])

  function switchProject(id: string) {
    setActiveId(id)
    saveActiveId(id)
  }

  function createProject() {
    const newProject = makeProject(`New Project ${projects.length + 1}`)
    const updated = [...projects, newProject]
    setProjects(updated)
    saveProjects(updated)
    switchProject(newProject.id)
  }

  function renameProject(id: string, name: string) {
    const updated = projects.map(p =>
      p.id === id ? { ...p, name, updatedAt: new Date().toISOString() } : p,
    )
    setProjects(updated)
    saveProjects(updated)
  }

  function deleteProject(id: string) {
    let updated = projects.filter(p => p.id !== id)
    if (updated.length === 0) {
      updated = [makeProject('My First Business')]
    }
    setProjects(updated)
    saveProjects(updated)
    if (id === activeId) {
      switchProject(updated[0].id)
    }
  }

  if (!activeId) return null // waiting for hydration

  const activeProject = projects.find(p => p.id === activeId) ?? projects[0]

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#050508' }}>
      <ProjectSelectorBar
        projects={projects}
        activeProjectId={activeId}
        onSelect={switchProject}
        onNew={createProject}
        onRename={renameProject}
        onDelete={deleteProject}
      />
      {activeProject && (
        <ForgeSession
          key={activeId}
          projectId={activeId}
          projectName={activeProject.name}
        />
      )}
    </div>
  )
}
