/**
 * lib/platform/local-mode.ts — local-first runtime detector (PR #379).
 *
 * Phase-2 helpers for the desktop-app migration plan
 * (task_plan-desktop-app.md). v1 is just the env-flag scaffold;
 * conditional code paths arrive in later phases.
 *
 * Activate by setting `LOCAL_MODE=1` (or `NEXUS_LOCAL_MODE=1`). When on,
 * future PRs will:
 *   • skip Clerk middleware (single-user localhost)
 *   • skip Composio in executeBusinessAction (direct API keys)
 *   • read secrets from `~/.nexus/secrets.json` instead of Doppler
 *   • use node-cron in-process instead of cron-job.org
 *   • default LLM_PROVIDER to 'ollama'
 *
 * For v1 this module only EXPOSES the flag — no behavioural change yet.
 * Plumb into call sites incrementally as the operator opts into local.
 */

export function isLocalMode(): boolean {
  const v = (process.env.LOCAL_MODE ?? process.env.NEXUS_LOCAL_MODE ?? '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Where local-mode reads operator-managed config. Defaults to
 * ~/.nexus, overridable via NEXUS_LOCAL_HOME (useful in tests).
 *
 * Inside the file:
 *   secrets.json        — { ANTHROPIC_API_KEY: "...", STRIPE_SECRET_KEY: "...", … }
 *   uploads/            — local blob store (mirrors R2/S3 key layout)
 *   disabled-crons.json — { "post-deploy-smoke": true } to skip crons
 */
export function localHome(): string {
  if (process.env.NEXUS_LOCAL_HOME) return process.env.NEXUS_LOCAL_HOME
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
  return `${home.replace(/\/$/, '')}/.nexus`
}

/**
 * The single-user identifier for local mode. Sentinel id makes export/
 * import + audit clean — when the operator exports from local and
 * imports into a multi-tenant deployment, a one-pass rewrite swaps
 * 'local-operator' for the real Clerk user_id.
 */
export const LOCAL_OPERATOR_USER_ID = 'local-operator'

/**
 * Default LLM provider for local mode. Override with LLM_PROVIDER in
 * env if the operator wants to still hit Claude / OpenRouter from a
 * local-mode install.
 */
export function localDefaultLlmProvider(): 'ollama' | 'claude' | 'openrouter' | 'mimo' {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER as 'ollama' | 'claude' | 'openrouter' | 'mimo'
  return 'ollama'
}
