/**
 * Hand-built fallback workflow scaffold for /api/n8n/generate.
 *
 * Used when Claude is unreachable, times out, or returns output we can't parse.
 * Returns an editable n8n workflow so the user always gets paste-ready JSON
 * instead of a 500 error.
 *
 * When structured idea-card fields (steps, tools, howItMakesMoney) are
 * supplied we build a FULL pipeline from them — one node per step (agent if
 * the step is automatable, manual trigger if it needs the owner), an asset-
 * gated review node after asset-producing steps, and a final publish gate.
 * Without those fields we emit a short generic scaffold as a last resort.
 */
import type { N8nNode, N8nWorkflow } from './types'
import { detectAsset, needsManagedAgent, needsSwarm, suggestAgentSlug } from './asset-detector'
import { buildSessionDispatchNode } from './managed-agent-builder'

export interface FallbackIdeaInput {
  description:     string
  workflowType:    'build' | 'maintain'
  steps?:          { title: string; automatable: boolean; phase?: 'build' | 'maintain'; tools?: string[] }[]
  tools?:          { name: string; purpose?: string }[]
  howItMakesMoney?: string
  capabilityIds:   string[]
  /** A5 — threaded into every dispatch-node body so run_events attribute correctly. */
  runId?:          string
}

// Keyword → capabilityId. First match wins. Falls back to 'consultant'.
const CAPABILITY_KEYWORDS: Array<{ rx: RegExp; id: string }> = [
  { rx: /research|analy[sz]e|investigat|market|competitor|audit/i,       id: 'research' },
  { rx: /seo|keyword|rank|backlink|sitemap/i,                             id: 'seo' },
  { rx: /social|linkedin|twitter|x\.com|facebook|instagram|tiktok|post/i, id: 'social' },
  { rx: /email|outreach|cold (email|dm)|newsletter|sequence/i,            id: 'email-outreach' },
  { rx: /neuro|hook|viral|persuas/i,                                      id: 'neuro-content' },
  { rx: /brand|design|logo|mockup|figma|image/i,                          id: 'design' },
  { rx: /video|reel|short|tiktok clip|trailer|brief/i,                    id: 'video-brief' },
  { rx: /support|ticket|customer|faq|helpdesk/i,                          id: 'customer-service' },
  { rx: /invoice|billing|finance|bookkeep|tax|accounting|stripe/i,        id: 'financial' },
  { rx: /legal|terms|privacy|contract|compliance|gdpr/i,                  id: 'legal' },
  { rx: /code|deploy|build the site|scaffold|repo|vercel|github/i,        id: 'code' },
  { rx: /content|write|article|blog|copy|newsletter|caption/i,            id: 'content' },
  { rx: /plan|strategy|roadmap|consult|advise/i,                          id: 'consultant' },
]

function pickCapability(step: { title: string; tools?: string[] }, allowed: string[]): string {
  const haystack = `${step.title} ${(step.tools ?? []).join(' ')}`
  for (const { rx, id } of CAPABILITY_KEYWORDS) {
    if (rx.test(haystack) && allowed.includes(id)) return id
  }
  return allowed.includes('consultant') ? 'consultant' : (allowed[0] ?? 'research')
}

function toolsForStep(
  stepTools: string[] | undefined,
  cardTools: { name: string; purpose?: string }[] | undefined,
): { name: string; purpose?: string }[] {
  if (!stepTools || stepTools.length === 0) return []
  const map = new Map((cardTools ?? []).map(t => [t.name.toLowerCase(), t]))
  return stepTools.map(name => map.get(name.toLowerCase()) ?? { name })
}

function dedupName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) { taken.add(base); return base }
  for (let i = 2; i < 999; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) { taken.add(candidate); return candidate }
  }
  taken.add(base); return base
}

export interface ScaffoldResult {
  workflow:    N8nWorkflow
  checklist:   string[]
  explanation: string
}

export function buildFallbackWorkflow(input: FallbackIdeaInput): ScaffoldResult {
  const { description, workflowType, steps, tools, howItMakesMoney, capabilityIds, runId } = input
  const isBuild       = workflowType === 'build'
  const phaseSteps    = (steps ?? []).filter(s => !s.phase || s.phase === workflowType)
  const hasStructured = phaseSteps.length > 0

  const workflowName = isBuild
    ? `Build — ${description.slice(0, 56)}`
    : `Maintain & profit — ${description.slice(0, 56)}`

  const nodes: N8nNode[] = []
  const connections: N8nWorkflow['connections'] = {}
  const takenNames = new Set<string>()
  const XSTEP  = 260
  const BASE_X = 240
  const ROW_Y  = 320
  let col = 0

  function makeHttpAgentNode(name: string, capabilityId: string, stepTitle: string, stepToolNames: string[]): N8nNode {
    return {
      id:          `agent_${col}`,
      name,
      type:        'n8n-nodes-base.httpRequest',
      typeVersion: 4,
      position:    [BASE_X + col * XSTEP, ROW_Y],
      parameters:  {
        method: 'POST',
        url:    '={{$vars.NEXUS_BASE_URL}}/api/agent',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
        sendBody: true,
        bodyContentType: 'json',
        jsonBody: JSON.stringify({
          capabilityId,
          inputs: {
            task:            stepTitle,
            description,
            howItMakesMoney: howItMakesMoney ?? undefined,
            tools:           stepToolNames.length ? stepToolNames : undefined,
            upstream:        '={{$json}}',
          },
        }, null, 2),
      },
    }
  }

  function makeDispatchNode(
    name:         string,
    capabilityId: string,
    agentSlug:    string,
    stepTitle:    string,
    stepToolNames: string[],
    swarm:        boolean,
    asset:        ReturnType<typeof detectAsset>,
  ): N8nNode {
    return buildSessionDispatchNode({
      id:          `dispatch_${col}`,
      name,
      position:    [BASE_X + col * XSTEP, ROW_Y],
      agentSlug,
      capabilityId,
      swarm,
      autoCreateAgent: true,
      asset:       asset ? asset.kind : null,
      runId,
      inputs: {
        task:            stepTitle,
        description,
        howItMakesMoney: howItMakesMoney ?? undefined,
        tools:           stepToolNames.length ? stepToolNames : undefined,
      },
    })
  }

  function makeManualTriggerNode(name: string, notes: string): N8nNode {
    return {
      id:          `manual_${col}`,
      name,
      type:        'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position:    [BASE_X + col * XSTEP, ROW_Y],
      parameters:  { notes },
    }
  }

  function connect(from: string, to: string) {
    connections[from] ??= { main: [[]] }
    connections[from].main[0].push({ node: to, type: 'main', index: 0 })
  }

  // 1. Trigger
  const triggerName = dedupName(isBuild ? 'Manual Start' : 'Weekly Schedule', takenNames)
  nodes.push({
    id:          'trigger',
    name:        triggerName,
    type:        isBuild ? 'n8n-nodes-base.manualTrigger' : 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1,
    position:    [BASE_X + col * XSTEP, ROW_Y],
    parameters:  isBuild
      ? { notes: `Kick off the build for: ${description}` }
      : { rule: { interval: [{ field: 'weeks', triggerAtDayOfWeek: 1, triggerAtHour: 9 }] } },
  })
  col++

  // 2. Mastermind orchestrator
  const mastermindName = dedupName('Mastermind', takenNames)
  nodes.push({
    id:          'mastermind',
    name:        mastermindName,
    type:        'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    position:    [BASE_X + col * XSTEP, ROW_Y],
    parameters:  {
      method: 'POST',
      url:    '={{$vars.NEXUS_BASE_URL}}/api/chat',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      bodyContentType: 'json',
      jsonBody: JSON.stringify({
        model: 'claude-opus-4-6',
        messages: [{
          role: 'user',
          content: [
            `You are the mastermind for this ${workflowType} workflow.`,
            `Idea: ${description}`,
            howItMakesMoney ? `Money model: ${howItMakesMoney}` : '',
            (tools?.length ? `Tools: ${tools.map(t => t.name).join(', ')}` : ''),
            (hasStructured ? `Steps: ${phaseSteps.map(s => s.title).join(' → ')}` : ''),
            'Decide which downstream tasks to trigger and return concise instructions per step.',
          ].filter(Boolean).join('\n'),
        }],
      }, null, 2),
    },
  })
  connect(triggerName, mastermindName)
  col++

  let previousNode = mastermindName

  // 3. One node per phase step (or a default pair when we lack structured data)
  const workSteps = hasStructured
    ? phaseSteps
    : [
        { title: isBuild ? 'Research & planning'    : 'Scan performance & audience',  automatable: true  },
        { title: isBuild ? 'Generate launch assets' : 'Produce this cycle\'s content', automatable: true  },
        { title: isBuild ? 'Owner side-effects'     : 'Owner approval',                automatable: false },
      ]

  let swarmStepCount    = 0
  let dispatchStepCount = 0
  let assetReviewCount  = 0

  workSteps.forEach((step) => {
    const safeTitle     = step.title.slice(0, 60)
    const stepToolNames = (step.tools ?? []).map(String)
    const asset         = detectAsset(step.title)
    let nodeName: string

    if (step.automatable) {
      const capabilityId = pickCapability(step, capabilityIds)
      const stepForClass = { title: step.title, automatable: step.automatable, tools: stepToolNames }

      if (needsManagedAgent(stepForClass)) {
        const swarm     = needsSwarm(stepForClass)
        const agentSlug = suggestAgentSlug(capabilityId, asset?.kind ?? null)
        nodeName = dedupName(`Agent: ${agentSlug} — ${safeTitle}`, takenNames)
        nodes.push(makeDispatchNode(nodeName, capabilityId, agentSlug, step.title, stepToolNames, swarm, asset))
        dispatchStepCount++
        if (swarm) swarmStepCount++
      } else {
        nodeName = dedupName(`Capability: ${capabilityId} — ${safeTitle}`, takenNames)
        nodes.push(makeHttpAgentNode(nodeName, capabilityId, step.title, stepToolNames))
      }
    } else {
      const stepToolList = toolsForStep(step.tools, tools)
      const toolsSuffix  = stepToolList.length
        ? `\nSuggested tools: ${stepToolList.map(t => t.name).join(', ')}`
        : ''
      nodeName = dedupName(`Manual: ${safeTitle}`, takenNames)
      nodes.push(makeManualTriggerNode(nodeName, `Owner action required: ${step.title}${toolsSuffix}`))
    }
    connect(previousNode, nodeName)
    previousNode = nodeName
    col++

    // Asset-gated review: only emit a Review node when the step produced a
    // reviewable asset.
    if (asset) {
      const reviewName = dedupName(asset.reviewTitle, takenNames)
      nodes.push(makeManualTriggerNode(reviewName, asset.reviewNotes))
      connect(previousNode, reviewName)
      previousNode = reviewName
      col++
      assetReviewCount++
    }
  })

  // 4. Final publish / spend gate — always end with a review before exit
  const finalReviewName = dedupName(
    isBuild ? 'Review: launch readiness' : 'Review: before publish / spend',
    takenNames,
  )
  nodes.push(makeManualTriggerNode(
    finalReviewName,
    isBuild
      ? `Confirm the build meets the launch bar before going live.\nMoney model: ${howItMakesMoney ?? '(check idea card)'}`
      : `Confirm the cycle output is safe to publish / spend on.\nMoney model: ${howItMakesMoney ?? '(check idea card)'}`,
  ))
  connect(previousNode, finalReviewName)
  previousNode = finalReviewName
  col++

  // 5. Owner side-effects bucket (OAuth, payments, DNS, etc.)
  const manualSideEffectsName = dedupName('Manual: owner side-effects', takenNames)
  nodes.push(makeManualTriggerNode(
    manualSideEffectsName,
    [
      'Handle any side-effects the workflow cannot automate:',
      '- OAuth authorisations (social, email, CRM)',
      '- Payment method setup (Stripe, PayPal)',
      '- Domain / DNS purchases',
      '- Legal / compliance steps',
      tools?.length ? `\nKey tools for this idea: ${tools.map(t => t.name).join(', ')}` : '',
    ].filter(Boolean).join('\n'),
  ))
  connect(previousNode, manualSideEffectsName)

  const workflow: N8nWorkflow = {
    name:     workflowName,
    active:   false,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    tags:     ['nexus', 'scaffold', workflowType],
    nodes,
    connections,
  }

  const checklist: string[] = [
    'Set NEXUS_BASE_URL in n8n Variables to your deployed Nexus URL',
    'Confirm /api/chat, /api/agent and /api/claude-session/dispatch are reachable from your n8n instance',
    'Review each Mastermind / Agent / Dispatch node body — the idea-card context is pre-filled',
    'Asset reviews ("Review: website", "Review: image", …) fire only after asset-producing steps — adjust the notes if your quality bar differs',
    'Complete the "Manual:" nodes once before activating — they block the flow',
    isBuild
      ? 'When all manual steps are done, set the workflow active and run it once end-to-end'
      : 'Set the Weekly Schedule cadence (day / hour) and activate the workflow',
  ]
  if (swarmStepCount > 0) {
    checklist.push(
      `${swarmStepCount} step(s) run in swarm mode — /api/claude-session/dispatch sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 automatically; ensure your Claude Code / OpenClaw environment supports Agent Teams`,
    )
  }
  if (dispatchStepCount > 0) {
    checklist.push(
      `${dispatchStepCount} managed-agent step(s) dispatch via /api/claude-session/dispatch — the endpoint auto-creates missing .claude/agents/<slug>.md specs on first run`,
    )
  }
  if (tools?.length) {
    checklist.push(`Connect credentials for: ${tools.map(t => t.name).join(', ')}`)
  }

  const agentStepCount  = workSteps.filter(s => s.automatable).length
  const manualStepCount = workSteps.filter(s => !s.automatable).length
  const explanation = [
    hasStructured
      ? `Scaffold built from the idea card: ${agentStepCount} agent step(s) (${dispatchStepCount} via Claude managed agents, ${swarmStepCount} with swarm/Agent Teams enabled), ${manualStepCount} manual step(s), ${assetReviewCount} asset-gated review node(s), final ${isBuild ? 'launch' : 'publish'} gate.`
      : `Generic scaffold: trigger → mastermind → two agents → owner side-effects → final review. Edit the bodies to match the idea.`,
    howItMakesMoney ? `Money model: ${howItMakesMoney}.` : '',
    'Each node is editable — this workflow is designed as a working starting point, not a finished product.',
  ].filter(Boolean).join(' ')

  return { workflow, checklist, explanation }
}
