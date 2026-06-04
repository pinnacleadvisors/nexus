import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

// Clerk-authed reverse-proxy for Paperclip's FULL SPA, served same-origin under
// /api/workforce/ui/* so the Nexus /workforce page can iframe it securely
// (Paperclip stays loopback-only; no public exposure; same-origin = no X-Frame
// issues). HTML is rewritten + a shim re-routes the SPA's runtime /api and asset
// calls back through the proxy. Best-effort for a complex SPA (WS live-logs may
// not stream); the native panels on /workforce are the reliable surface.

export const runtime = 'nodejs'
export const maxDuration = 30

const BASE = (process.env.PAPERCLIP_API_BASE ?? 'http://host.docker.internal:3100').replace(/\/$/, '')
const UI = '/api/workforce/ui'

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId)
}

// Injected first in <head>: re-routes runtime fetch/XHR/SSE to the proxy.
const SHIM = `<script>(function(){var UI='${UI}',API='/api/workforce';
function rw(u){if(typeof u!=='string')return u;if(u.indexOf('/api/workforce')===0)return u;
if(u.indexOf('/api/')===0)return API+u.slice(4);if(u.charAt(0)==='/')return UI+u;return u;}
var of=window.fetch;window.fetch=function(u,o){try{if(u&&u.url)return of(new Request(rw(u.url),u),o);return of(rw(u),o);}catch(e){return of(u,o);}};
var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=rw(u);}catch(e){}return oo.apply(this,arguments);};
if(window.EventSource){var ES=window.EventSource;window.EventSource=function(u,c){return new ES(rw(u),c);};}
})();</script>`

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!isOwner(userId)) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 })

  const { path } = await ctx.params
  const upstream = `${BASE}/${(path ?? []).join('/')}${req.nextUrl.search}`

  let res: Response
  try {
    res = await fetch(upstream, { signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'paperclip unreachable', detail: (e as Error).message }, { status: 502 })
  }

  const ct = res.headers.get('content-type') ?? 'application/octet-stream'

  if (ct.includes('text/html')) {
    let html = await res.text()
    // Rewrite absolute asset/href paths to load through the proxy (skip already-proxied + external).
    html = html.replace(/(src|href)="\/(?!\/|api\/workforce)/g, `$1="${UI}/`)
    // Inject the runtime shim as the first thing in <head>.
    html = html.replace(/<head([^>]*)>/i, `<head$1>${SHIM}`)
    return new NextResponse(html, {
      status: res.status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  // Assets / JSON: stream through with original content-type.
  const buf = await res.arrayBuffer()
  return new NextResponse(buf, { status: res.status, headers: { 'content-type': ct } })
}
