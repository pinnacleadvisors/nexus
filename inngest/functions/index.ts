/**
 * Inngest background functions — registered with the Inngest serve handler.
 *
 * Functions:
 *  1. onMilestoneCompleted  — appends to Notion, optionally dispatches next milestone
 *  2. onAssetCreated        — uploads asset to R2/Storage, creates Kanban card
 *  3. dailyCostCheck        — checks token cost totals and fires alerts
 *  4. onAgentStatusChanged  — fires alert when an agent enters error state
 */

import { inngest } from '@/inngest/client'
import { createServerClient } from '@/lib/supabase'
import { isR2Configured, uploadUrlToR2 } from '@/lib/r2'

// ── 1. Milestone completed ─────────────────────────────────────────────────────
export const onMilestoneCompleted = inngest.createFunction(
  {
    id: 'milestone-completed',
    name: 'Milestone Completed Handler',
    triggers: [{ event: 'milestone/completed' }],
  },
  async ({ event, step }: { event: { data: Record<string, string | undefined> }; step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const { milestoneId, milestoneTitle, projectId, projectName, assetUrl, notionPageId } =
      event.data

    // Step 1: Append milestone completion to Notion
    if (notionPageId) {
      await step['run']('append-to-notion', async () => {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
        const response = await fetch(`${baseUrl}/api/notion/append`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId: notionPageId,
            heading: `✅ ${milestoneTitle}`,
            text: `Milestone completed for project "${projectName}". Approved at ${new Date().toISOString()}.`,
            blocks: assetUrl
              ? [{ type: 'bookmark', bookmark: { url: assetUrl } }]
              : [],
          }),
        })
        return response.ok ? 'appended' : `failed: ${response.status}`
      })
    }

    // Step 2: Update milestone status in DB
    await step['run']('update-milestone-status', async () => {
      const supabase = createServerClient()
      if (!supabase || !milestoneId) return 'skipped'
      await supabase
        .from('milestones')
        .update({ status: 'done' })
        .or(`forge_id.eq.${milestoneId},id.eq.${milestoneId}`)
      return 'updated'
    })

    // Step 3: Dispatch next milestone to OpenClaw
    await step['run']('dispatch-next-milestone', async () => {
      if (!projectId) return 'skipped'
      const supabase = createServerClient()
      if (!supabase) return 'skipped'

      const { data } = await supabase
        .from('milestones')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'pending')
        .order('phase', { ascending: true })
        .limit(1)

      if (!data?.length) return 'no pending milestones'

      const next = data[0]
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      await fetch(`${baseUrl}/api/claw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'agent',
          task: `${next.title}: ${next.description}`,
          projectId,
          milestoneId: next.forge_id ?? next.id,
        }),
      })
      return `dispatched: ${next.title}`
    })

    return { milestoneId, status: 'handled' }
  },
)

// ── 2. Asset created ───────────────────────────────────────────────────────────
export const onAssetCreated = inngest.createFunction(
  {
    id: 'asset-created',
    name: 'Asset Created Handler',
    triggers: [{ event: 'asset/created' }],
  },
  async ({ event, step }: { event: { data: Record<string, string | undefined> }; step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const { assetUrl, assetType, title, projectId, milestoneId } = event.data
    if (!assetUrl || !title) return { skipped: true }

    // Step 1: Mirror to R2 if configured
    const r2Key: unknown = await step['run']('mirror-to-r2', async () => {
      if (!isR2Configured()) return null
      const ext = assetType === 'pdf' ? '.pdf' : assetType === 'doc' ? '.docx' : ''
      const key = `assets/${projectId ?? 'global'}/${Date.now()}${ext}`
      try {
        const result = await uploadUrlToR2({ url: assetUrl, key })
        return result.key
      } catch {
        return null
      }
    })

    // Step 2: Create Kanban card in Review column
    await step['run']('create-kanban-card', async () => {
      const supabase = createServerClient()
      if (!supabase) return 'skipped'
      await supabase.from('tasks').insert({
        title,
        description: `Agent-generated ${assetType ?? 'asset'}.${r2Key ? ` R2: ${r2Key}` : ''}`,
        column_id: 'review',
        priority: 'medium',
        project_id: projectId ?? null,
        milestone_id: milestoneId ?? null,
        asset_url: assetUrl,
        position: 0,
      })
      return 'created'
    })

    return { assetUrl, r2Key, status: 'handled' }
  },
)

// ── 3. Daily cost check (cron) ─────────────────────────────────────────────────
export const dailyCostCheck = inngest.createFunction(
  {
    id: 'daily-cost-check',
    name: 'Daily Cost Alert Check',
    triggers: [{ cron: '0 8 * * *' }],
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const summary = await step['run']('check-cost', async () => {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const res = await fetch(`${baseUrl}/api/alerts`, { method: 'POST' })
      return res.ok ? 'alerts evaluated' : `failed: ${res.status}`
    })
    return { summary }
  },
)

// ── 4. Agent status changed ────────────────────────────────────────────────────
export const onAgentStatusChanged = inngest.createFunction(
  {
    id: 'agent-status-changed',
    name: 'Agent Status Change Handler',
    triggers: [{ event: 'agent/status-changed' }],
  },
  async ({ event, step }: { event: { data: Record<string, string | undefined> }; step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const { agentId, agentName, newStatus } = event.data
    if (newStatus !== 'error') return { skipped: true }

    await step['run']('fire-agent-down-alert', async () => {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      await fetch(`${baseUrl}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, agentName, trigger: 'agent_down' }),
      })
      return 'alert fired'
    })

    return { agentId, newStatus }
  },
)

// ── Export all functions for the serve handler ─────────────────────────────────
import { weeklyResearchLoop as _weeklyResearchLoop } from './research-loop'

export const functions = [
  onMilestoneCompleted,
  onAssetCreated,
  dailyCostCheck,
  onAgentStatusChanged,
  _weeklyResearchLoop,
]
