/**
 * Back-compat barrel — re-exports the split Composio modules.
 *
 * Composio code lives under `lib/composio/`:
 *   - `client.ts`  — generic executeAction, initiateConnection, disconnect
 *   - `doppler.ts` — Doppler-specific secret fetcher
 *   - `actions.ts` — per-business action helper (lookup connected_account_id)
 *
 * Existing imports `@/lib/composio` continue to resolve here.
 * New code should import from the specific submodule.
 */
export { ComposioError, executeAction, initiateConnection, disconnectAccount } from './composio/client'
export type { ExecuteActionInput, InitiateConnectionInput, InitiateConnectionResult } from './composio/client'
export { fetchDopplerSecrets } from './composio/doppler'
