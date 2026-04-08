import { NextRequest, NextResponse } from 'next/server'

type ClawAction = 'wake' | 'agent'

interface ClawRequestBody {
  action: ClawAction
  gatewayUrl: string
  hookToken: string
  payload: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const body: ClawRequestBody = await req.json()
  const { action, gatewayUrl, hookToken, payload } = body

  if (!gatewayUrl || !hookToken) {
    return NextResponse.json({ error: 'Missing gatewayUrl or hookToken' }, { status: 400 })
  }

  const endpoint = action === 'wake' ? '/hooks/wake' : '/hooks/agent'
  const url = `${gatewayUrl.replace(/\/$/, '')}${endpoint}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hookToken}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // 202 = async run started (agent), 200 = fire-and-forget (wake)
  if (response.ok) {
    return NextResponse.json({ ok: true, status: response.status })
  }

  return NextResponse.json(
    { error: `OpenClaw returned ${response.status}` },
    { status: response.status === 401 ? 401 : 502 },
  )
}
