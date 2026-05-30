/**
 * Unit test for lib/models/detect-providers.ts — the pure provider-detection
 * shared by the Agentdex + Skills model pickers. No network, no DOM.
 *
 * Run with: `npx --yes tsx __tests__/detect-providers.test.ts`
 */
import {
  detectConnectedProviders,
  OPENROUTER_ROUTABLE,
  type GatewayStatusLike,
} from '../lib/models/detect-providers'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}
function has(list: string[], v: string): boolean { return list.includes(v) }
function gw(over: Partial<GatewayStatusLike> = {}): GatewayStatusLike {
  return { provider: 'gateway', gatewayHealthy: true, ...over }
}

// 1. lean-mode: only the Claude gateway → just anthropic
{
  const p = detectConnectedProviders(gw(), [])
  assert(p.length === 1 && p[0] === 'anthropic', 'lean-mode gateway → [anthropic] only')
}
// 2. codex configured → openai surfaces (the headline bug fix)
{
  const p = detectConnectedProviders(gw({ codexConfigured: true }), [])
  assert(has(p, 'anthropic') && has(p, 'openai'), 'codexConfigured adds openai alongside anthropic')
}
// 3. openrouter configured → openrouter + every routable vendor
{
  const p = detectConnectedProviders(gw({ openrouterConfigured: true }), [])
  assert(has(p, 'openrouter'), 'openrouterConfigured adds openrouter')
  for (const v of OPENROUTER_ROUTABLE) assert(has(p, v), `openrouter fan-out includes ${v}`)
}
// 4. envProviders surface directly (covers NIM / Ollama / direct keys)
{
  const p = detectConnectedProviders(gw({ envProviders: ['google', 'nim', 'ollama'] }), [])
  assert(has(p, 'google') && has(p, 'nim') && has(p, 'ollama'), 'envProviders [google,nim,ollama] surface')
}
// 5. connected accounts: active surfaces, inactive excluded
{
  const p = detectConnectedProviders(gw(), [
    { platform: 'google', status: 'active' },
    { platform: 'deepseek', status: 'pending' },
  ])
  assert(has(p, 'google'), 'active google account surfaces')
  assert(!has(p, 'deepseek'), 'inactive deepseek account excluded')
}
// 6. null gateway + no accounts → empty
{
  const p = detectConnectedProviders(null, [])
  assert(p.length === 0, 'null gateway + no accounts → []')
}
// 7. dedup: codex + openai account → single entry
{
  const p = detectConnectedProviders(gw({ codexConfigured: true }), [{ platform: 'openai', status: 'active' }])
  assert(p.filter(x => x === 'openai').length === 1, 'openai deduped across codex + account')
}
// 8. provider 'api' without a healthy gateway → anthropic still reachable
{
  const p = detectConnectedProviders(gw({ provider: 'api', gatewayHealthy: false }), [])
  assert(has(p, 'anthropic'), "provider 'api' → anthropic reachable")
}
// 9. unhealthy 'none' gateway → anthropic NOT added
{
  const p = detectConnectedProviders(gw({ provider: 'none', gatewayHealthy: false }), [])
  assert(!has(p, 'anthropic'), "'none' gateway → anthropic NOT added")
}
// 10. unknown account platform is ignored (not a catalog provider)
{
  const p = detectConnectedProviders(null, [{ platform: 'slack', status: 'active' }])
  assert(p.length === 0, 'non-AI account platform (slack) ignored')
}

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log('\n✓ detect-providers: all assertions passed')
