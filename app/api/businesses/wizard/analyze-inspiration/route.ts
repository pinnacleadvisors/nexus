/**
 * POST /api/businesses/wizard/analyze-inspiration
 *
 * Body: { url: string }
 *
 * Scrapes a public URL the operator wants the new business to resemble
 * (competitor home page, pricing page, etc.) and synthesises a structured
 * brief the wizard pre-fills into its later steps. The point: the operator
 * pastes one URL instead of typing 7 free-text fields.
 *
 * Returns: {
 *   ok: boolean,
 *   inspiration: {
 *     title:       string | null,
 *     description: string | null,
 *     suggested:   {
 *       niche:        string,
 *       brand_voice:  string,
 *       money_model:  'subscription' | 'one_off' | 'affiliate' | 'ads' | 'service' | 'unknown',
 *       price_hint:   string | null,
 *       audience:     string | null,
 *     },
 *     signals: string[],   // bullet-list of "here's what this site looks like"
 *     warnings: string[],  // failed fetches, blocked scrapes, etc.
 *   },
 * }
 *
 * Heuristic-only — runs purely on the scraped HTML (no LLM call) so the
 * operator gets sub-second feedback as they paste the URL. The wizard can
 * still let them tweak everything before submitting; this just pre-fills.
 *
 * Retry-storm safe: returns 200 with { ok: false, error } on any failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'

export const runtime = 'nodejs'
export const maxDuration = 30

interface AnalyzeBody { url?: unknown }

interface Suggested {
  niche:       string
  brand_voice: string
  money_model: 'subscription' | 'one_off' | 'affiliate' | 'ads' | 'service' | 'unknown'
  price_hint:  string | null
  audience:    string | null
}

interface Inspiration {
  url:         string
  title:       string | null
  description: string | null
  suggested:   Suggested
  signals:     string[]
  warnings:    string[]
}

/**
 * SSRF defence — only allow http(s) URLs on public hostnames. Prevents the
 * operator (or anything that takes user input here) from probing internal
 * services via this route. Hostnames in the deny-list are common SSRF
 * targets (cloud metadata, loopback, link-local).
 */
function isSafeUrl(raw: string): { ok: true; href: string } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' }
  }
  const host = parsed.hostname.toLowerCase()
  // Block loopback + cloud metadata + RFC1918 private ranges (defence in depth)
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '169.254.169.254' ||                // EC2/GCP metadata
    host === '100.100.100.200' ||                // alibaba metadata
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /\.internal$/.test(host) ||
    /\.local$/.test(host)
  ) {
    return { ok: false, reason: 'private_host_blocked' }
  }
  return { ok: true, href: parsed.href }
}

function extractTextNode(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'i')
  const m = html.match(re)
  return m ? m[1].trim() : null
}

function extractMeta(html: string, name: string): string | null {
  // Handles both name= and property= (Open Graph). Case-insensitive.
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`,
    'i',
  )
  const m = html.match(re)
  return m ? m[1].trim() : null
}

/** Naive niche guess from page text — looks for common SaaS / e-comm / agency
 *  / creator / B2B markers. Operator can override in the wizard. */
function guessNiche(text: string): string {
  const t = text.toLowerCase()
  if (/\b(saas|platform|api|developer|sdk|integration)\b/.test(t)) return 'saas'
  if (/\b(course|cohort|coaching|mentorship|workshop)\b/.test(t)) return 'info-products'
  if (/\b(shop|store|product|cart|shipping|checkout)\b/.test(t))  return 'e-commerce'
  if (/\b(agency|service|consult|firm|done-for-you)\b/.test(t))    return 'service-agency'
  if (/\b(newsletter|substack|writer|blog|essay|publication)\b/.test(t)) return 'media-newsletter'
  if (/\b(creator|influencer|community|audience)\b/.test(t))       return 'creator-economy'
  return 'general'
}

function guessMoneyModel(text: string): Suggested['money_model'] {
  const t = text.toLowerCase()
  if (/\b(\$\d+\s*\/\s*(mo|month|year|yr)|per month|per year|billed monthly|monthly subscription)\b/.test(t)) return 'subscription'
  if (/\b(buy now|one-?time|lifetime access|single purchase)\b/.test(t)) return 'one_off'
  if (/\b(affiliate|referral|commission)\b/.test(t)) return 'affiliate'
  if (/\b(advertise|sponsor|ad-supported|brand partnership)\b/.test(t)) return 'ads'
  if (/\b(consult|engagement|retainer|hourly|day rate)\b/.test(t)) return 'service'
  return 'unknown'
}

function extractPriceHint(text: string): string | null {
  // Look for the lowest-numbered $-prefixed price on the page (usually the
  // entry tier). Caps at 4 digits so we don't grab cents or huge numbers.
  const matches = Array.from(text.matchAll(/\$\s?(\d{1,4})\s?(?:\.\d{2})?\s?(?:\/\s?(mo|month|year|yr))?/gi))
  if (matches.length === 0) return null
  const numbered = matches
    .map(m => ({ raw: m[0], n: parseInt(m[1], 10), unit: m[2] ?? '' }))
    .filter(x => x.n > 0 && x.n < 10_000)
    .sort((a, b) => a.n - b.n)
  return numbered.length > 0 ? numbered[0].raw.trim() : null
}

function guessBrandVoice(description: string | null, title: string | null): string {
  const blob = `${title ?? ''} ${description ?? ''}`.toLowerCase()
  if (/\b(playful|fun|whimsical|quirky|cheeky)\b/.test(blob)) return 'playful, conversational, light'
  if (/\b(enterprise|secure|compliant|scalable|robust)\b/.test(blob)) return 'professional, authoritative, precise'
  if (/\b(simple|minimal|clean|fast|easy)\b/.test(blob)) return 'minimal, direct, no-fluff'
  if (/\b(community|together|share|connect)\b/.test(blob)) return 'warm, inclusive, community-first'
  return 'clear, neutral, confidence-forward'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'biz-wizard:inspire' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as AnalyzeBody
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl) return NextResponse.json({ ok: false, error: 'url required' })

  const safe = isSafeUrl(rawUrl)
  if (!safe.ok) {
    return NextResponse.json({ ok: false, error: safe.reason })
  }

  // Single fetch — no crawl, no link-following. Operator can re-run on
  // a different page (e.g. /pricing) if the home page is light.
  let html = ''
  const warnings: string[] = []
  try {
    const res = await fetch(safe.href, {
      headers: {
        'User-Agent': 'Nexus-WizardBot/1.0 (+https://nexus.coolifycloudtunnel.uk)',
        'Accept':     'text/html,*/*',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `fetch_${res.status}`,
        hint: 'Inspiration URL returned non-2xx. Try a different page (often the home page or /pricing works best).',
      })
    }
    // Cap to 256 KB so a huge SPA payload doesn't blow memory
    const reader = res.body?.getReader()
    if (reader) {
      let total = 0
      const decoder = new TextDecoder()
      while (total < 256 * 1024) {
        const { done, value } = await reader.read()
        if (done) break
        html += decoder.decode(value, { stream: true })
        total += value.byteLength
      }
      try { await reader.cancel() } catch { /* best-effort */ }
    } else {
      html = await res.text()
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: 'fetch_failed',
      detail: err instanceof Error ? err.message : 'network error',
    })
  }

  // Strip script + style + comments before extracting visible text.
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 8000)

  const title       = extractTextNode(html, 'title') ?? extractMeta(html, 'og:title')
  const description = extractMeta(html, 'description') ?? extractMeta(html, 'og:description')
  if (!title)       warnings.push('No <title> tag — page might be a JS-rendered SPA. Try /about or /pricing.')
  if (!description) warnings.push('No meta description — niche/audience guesses will be weaker.')

  const niche        = guessNiche(visible)
  const money_model  = guessMoneyModel(visible)
  const price_hint   = extractPriceHint(visible)
  const brand_voice  = guessBrandVoice(description, title)

  const inspiration: Inspiration = {
    url:         safe.href,
    title:       title ?? null,
    description: description ?? null,
    suggested: {
      niche,
      brand_voice,
      money_model,
      price_hint,
      audience: description ? description.slice(0, 120) : null,
    },
    signals: [
      title       ? `Title: "${title}"` : null,
      description ? `Description: "${description.slice(0, 140)}…"` : null,
      `Guessed niche: ${niche}`,
      `Money model: ${money_model}`,
      price_hint ? `Lowest visible price: ${price_hint}` : null,
    ].filter((s): s is string => Boolean(s)),
    warnings,
  }

  return NextResponse.json({ ok: true, inspiration })
}
