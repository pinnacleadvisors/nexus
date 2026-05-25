/**
 * Per-provider API-key validators.
 *
 * Called from POST /api/connected-accounts/api-key before persisting a key
 * the operator just pasted into /settings/accounts. Each validator hits a
 * cheap, idempotent endpoint on the provider and returns `{ ok: true }` on
 * success or `{ ok: false, error }` on failure (NEVER throws — the route
 * surfaces the error as 200 + payload so the inline form can render it).
 *
 * Adding a new provider validator: append to the dispatch map below. Skipping
 * a provider (no entry) means the key persists as-is — the existing behaviour
 * for every pre-existing apiKeySetup provider.
 */

interface ValidationResult {
  ok: boolean
  error?: string
  /** Optional additional context the UI can show ("workspace: acme-co"). */
  detail?: string
}

const VALIDATION_TIMEOUT_MS = 8_000

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS) })
}

async function validateDoppler(token: string): Promise<ValidationResult> {
  try {
    const res = await timedFetch('https://api.doppler.com/v3/me', {
      method:  'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Doppler rejected the token (401/403). Generate a fresh service token and retry.' }
    }
    if (!res.ok) {
      return { ok: false, error: `Doppler /v3/me returned HTTP ${res.status}` }
    }
    const body = await res.json() as { name?: string; workplace?: { name?: string } }
    const detail = body.workplace?.name ? `workplace: ${body.workplace.name}` : (body.name ? `account: ${body.name}` : undefined)
    return { ok: true, detail }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    return { ok: false, error: `Doppler validation failed: ${msg}` }
  }
}

async function validateSupabase(serviceRoleKey: string): Promise<ValidationResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    return { ok: false, error: 'NEXT_PUBLIC_SUPABASE_URL not set — cannot validate the service-role key without a project URL.' }
  }
  try {
    const res = await timedFetch(`${url.replace(/\/$/, '')}/rest/v1/?apikey=${encodeURIComponent(serviceRoleKey)}`, {
      method:  'GET',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Accept':        'application/openapi+json',
      },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Supabase rejected the key (401/403). Confirm you copied the service_role secret, not the anon key.' }
    }
    if (!res.ok) {
      return { ok: false, error: `Supabase REST root returned HTTP ${res.status}` }
    }
    return { ok: true, detail: `project: ${new URL(url).hostname.split('.')[0]}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    return { ok: false, error: `Supabase validation failed: ${msg}` }
  }
}

const VALIDATORS: Record<string, (key: string) => Promise<ValidationResult>> = {
  doppler:  validateDoppler,
  supabase: validateSupabase,
}

export function hasValidator(providerId: string): boolean {
  return providerId in VALIDATORS
}

export async function validateApiKey(providerId: string, apiKey: string): Promise<ValidationResult> {
  const fn = VALIDATORS[providerId]
  if (!fn) return { ok: true }   // no validator → pass-through (existing behaviour for all 26 pre-existing providers)
  return fn(apiKey)
}
