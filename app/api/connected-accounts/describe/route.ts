/**
 * POST /api/connected-accounts/describe — classify a free-form connection request.
 *
 * The Settings → Accounts page has a "Describe a connection" card. The operator
 * types something like "I want to post to my company Twitter" or "Hook up the
 * Cloudflare DNS for the agency niche". This route classifies the prose into
 * one of three buckets:
 *
 *   - `oauth`    → matched a Composio-brokered platform. Frontend opens the
 *                  existing /api/connected-accounts/init flow for the platform.
 *   - `api_key`  → matched a platform with `apiKeySetup`. Frontend scrolls to
 *                  the matching ApiKeyCard and pre-focuses the input.
 *   - `manual`   → no clean match. Server inserts an `operator_tasks` row with
 *                  the operator's scope so the unblocked work lands in the
 *                  inbox; frontend shows a confirmation + Inbox link.
 *
 * Retry-storm safe: returns 200 + `{ ok: false, error }` on any classification
 * failure so the AccountList's optimistic UI doesn't 5xx-loop the route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { generateText } from 'ai'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getLlm } from '@/lib/llm/provider'
import { OAUTH_PROVIDERS } from '@/lib/oauth/providers'
import { ADMIN_SCOPE } from '@/lib/claw/business-client'
import { createTask } from '@/lib/views/tasks'
import { cacheWrap } from '@/lib/agents/cache'

export const runtime     = 'nodejs'
export const maxDuration = 20

type ClassifyKind = 'oauth' | 'api_key' | 'manual'

interface ClassifyResult {
  kind:          ClassifyKind
  providerId?:   string
  reasoning?:    string
  manualTitle?:  string
  manualBody?:   string
}

interface DescribeBody {
  description?:  string
  businessSlug?: string | null
}

interface DescribeResponse {
  ok:            boolean
  kind?:         ClassifyKind
  providerId?:   string
  providerName?: string
  apiKeyHint?:   string
  apiKeyDocsUrl?: string
  taskId?:       string
  message?:      string
  error?:        string
}

// Small + stable provider catalog we hand to the LLM. We strip everything the
// classifier doesn't need (actions, logos, scope policies) so the prompt is
// small. `name` + `id` + a one-line "auth shape" is enough for matching.
function compactCatalog(): Array<{ id: string; name: string; auth: 'oauth' | 'api_key'; instructions?: string }> {
  return OAUTH_PROVIDERS.map(p => ({
    id:    p.id,
    name:  p.name,
    auth:  p.apiKeySetup ? 'api_key' : 'oauth',
    instructions: p.apiKeySetup?.instructions,
  }))
}

const SYSTEM_PROMPT = `You are the connection classifier for an internal automation platform.

You receive a one- or two-sentence description from the operator about a service they want to connect, plus a catalog of supported providers. Reply with a single JSON object of shape:

  { "kind": "oauth" | "api_key" | "manual", "providerId": "<catalog id>" | null, "reasoning": "<short>", "manualTitle": "<title>" | null, "manualBody": "<body>" | null }

Rules:
- If the description clearly matches one of the catalog providers, set kind to that provider's auth ('oauth' or 'api_key') and providerId to the catalog id.
- If the description references a platform that is NOT in the catalog, set kind="manual". The frontend will surface the work as a manual to-do. In that case:
    - manualTitle: short imperative ("Set up Foo connection")
    - manualBody:  detailed steps (where to sign up, what credentials to fetch, what env var name to add to lib/oauth/providers.ts, link to the platform's API docs if you can guess it).
- Never invent a providerId that isn't in the catalog.
- Never include backticks or markdown fences around the JSON.`

export async function POST(req: NextRequest): Promise<NextResponse<DescribeResponse>> {
  const rl = await rateLimit(req, { limit: 15, window: '1 m', prefix: 'connected-accounts:describe' })
  if (!rl.success) return rateLimitResponse(rl) as NextResponse<DescribeResponse>

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: DescribeBody = {}
  try { body = await req.json() } catch { /* validated below */ }
  const description = (body.description ?? '').trim()
  if (description.length < 4) return NextResponse.json({ ok: false, error: 'description too short' }, { status: 400 })
  if (description.length > 800) return NextResponse.json({ ok: false, error: 'description too long' }, { status: 400 })

  // Scope: per-business when the page is showing a specific business, admin
  // otherwise. Mirrors AccountList's scope resolution at line 203.
  const businessSlug = (body.businessSlug ?? '').trim() || null
  const scope: string = businessSlug && businessSlug !== ADMIN_SCOPE
    ? `business:${businessSlug}`
    : 'admin'

  let classified: ClassifyResult
  try {
    const catalog = compactCatalog()
    // Smart cache: temperature:0 + stateless prompt + public-catalog input =
    // deterministic. Same `description` always classifies to the same provider,
    // so we cache for 24h. Cache key includes the catalog's length so a new
    // provider being added to lib/oauth/providers.ts naturally invalidates
    // every cached row (the description might now resolve differently).
    // Fail-soft — cache failures bypass to the fresh call.
    classified = await cacheWrap<ClassifyResult>(
      'connected-accounts-describe',
      { description: description.trim().toLowerCase(), catalogSize: catalog.length },
      async () => {
        const res = await generateText({
          model:  getLlm(),
          system: SYSTEM_PROMPT,
          prompt: `Operator description:\n"""${description}"""\n\nSupported provider catalog (JSON):\n${JSON.stringify(catalog)}\n\nReply with the classification JSON only.`,
          // Stay deterministic — no creative roleplay needed.
          temperature: 0,
        })
        return parseClassifyJson(res.text)
      },
      // 24h TTL — the catalog rarely changes, the classifier is deterministic.
      // Per-row invalidation lands when the agent's prompt or catalog changes
      // (catalogSize bump → cache miss).
      { ttlMinutes: 60 * 24 },
    )
  } catch (e) {
    // Retry-storm safe — return 200 with ok:false so the UI shows an inline
    // error and doesn't kill the user's flow.
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : 'classification failed',
    }, { status: 200 })
  }

  // Resolve back into the live catalog. Even if the model invents an id, the
  // lookup will return undefined and we'll fall through to "manual".
  const matched = classified.providerId
    ? OAUTH_PROVIDERS.find(p => p.id === classified.providerId)
    : undefined

  if (matched && classified.kind !== 'manual') {
    const isApiKey = !!matched.apiKeySetup
    return NextResponse.json({
      ok:            true,
      kind:          isApiKey ? 'api_key' : 'oauth',
      providerId:    matched.id,
      providerName:  matched.name,
      apiKeyHint:    matched.apiKeySetup?.instructions,
      apiKeyDocsUrl: matched.apiKeySetup?.credentialsUrl,
      message:       isApiKey
        ? `Paste your ${matched.name} key below to finish.`
        : `Opening ${matched.name} authorization flow…`,
    })
  }

  // Manual fallback — file an operator_tasks row so the unblocked work surfaces
  // in the inbox right away. We seed the explanation column (migration 059) with
  // the classifier's `manualBody` so the operator gets the long-form guide
  // immediately, before the Explain button even fires.
  const title = (classified.manualTitle ?? `Set up "${description.slice(0, 80)}" connection`).slice(0, 200)
  const initialBody = classified.manualBody ?? classified.reasoning ?? description

  const task = await createTask({
    userId:      session.userId,
    scope,
    title,
    description: initialBody,
    source:      'operator',
  })

  if (!task) {
    return NextResponse.json({
      ok:      false,
      error:   'could not file manual to-do (operator_tasks insert failed)',
      message: 'Stored on this page only — try again in a moment.',
    }, { status: 200 })
  }

  return NextResponse.json({
    ok:      true,
    kind:    'manual',
    taskId:  task.id,
    message: 'Filed as a manual to-do — see your Inbox.',
  })
}

/**
 * The LLM is told to return raw JSON, but Claude in particular sometimes
 * wraps it in a ```json fence. Tolerate either shape; bail to a default
 * manual classification on a hard parse failure.
 */
function parseClassifyJson(raw: string): ClassifyResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(trimmed) as Partial<ClassifyResult>
  if (parsed.kind !== 'oauth' && parsed.kind !== 'api_key' && parsed.kind !== 'manual') {
    throw new Error(`bad kind: ${String(parsed.kind)}`)
  }
  return {
    kind:        parsed.kind,
    providerId:  typeof parsed.providerId === 'string' ? parsed.providerId : undefined,
    reasoning:   typeof parsed.reasoning  === 'string' ? parsed.reasoning  : undefined,
    manualTitle: typeof parsed.manualTitle === 'string' ? parsed.manualTitle : undefined,
    manualBody:  typeof parsed.manualBody  === 'string' ? parsed.manualBody  : undefined,
  }
}
