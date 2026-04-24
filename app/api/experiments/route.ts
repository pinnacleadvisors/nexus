/**
 * /api/experiments — C5
 *
 * GET  /api/experiments?runId=<uuid>&status=<running|decided|stopped>
 * POST /api/experiments { runId?, hypothesis?, variantA, variantB }
 *   or  { experimentId, variant: 'a'|'b', success: 0|1 }  (add a sample)
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { audit } from '@/lib/audit'
import {
  addSample,
  createExperiment,
  listExperiments,
} from '@/lib/experiments/client'
import type { CreateExperimentInput, ExperimentStatus, SampleInput } from '@/lib/experiments/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'experiments:list' },
  })
  if ('response' in g) return g.response

  const runId  = req.nextUrl.searchParams.get('runId')  ?? undefined
  const status = (req.nextUrl.searchParams.get('status') ?? undefined) as ExperimentStatus | undefined

  const experiments = await listExperiments(g.userId, { runId, status })
  return NextResponse.json({ experiments })
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'experiments:write' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as Partial<CreateExperimentInput & SampleInput>

  // Sample path: { experimentId, variant, success }
  if (typeof body.experimentId === 'string' && (body.variant === 'a' || body.variant === 'b')) {
    const success = body.success === 1 ? 1 : 0
    const updated = await addSample({
      experimentId: body.experimentId,
      variant:      body.variant,
      success,
    })
    if (!updated) return NextResponse.json({ error: 'experiment not found' }, { status: 404 })
    audit(req, {
      action:     'experiment.sample',
      resource:   'experiment',
      resourceId: body.experimentId,
      userId:     g.userId,
      metadata:   { variant: body.variant, success },
    })
    return NextResponse.json({ experiment: updated })
  }

  // Create path: { variantA, variantB, ... }
  if (!body.variantA || !body.variantB) {
    return NextResponse.json({ error: 'variantA and variantB required' }, { status: 400 })
  }

  const exp = await createExperiment(g.userId, {
    runId:      body.runId,
    hypothesis: body.hypothesis,
    variantA:   body.variantA,
    variantB:   body.variantB,
  })
  if (!exp) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  audit(req, {
    action:     'experiment.create',
    resource:   'experiment',
    resourceId: exp.id,
    userId:     g.userId,
    metadata:   { runId: exp.runId },
  })

  return NextResponse.json({ experiment: exp }, { status: 201 })
}
