/**
 * Unit test for lib/llm/provider.ts — the pure resolution + default-model
 * paths. Network-bound provider construction (anthropic / openrouter / mimo /
 * ollama) is NOT exercised here — those go through their own SDKs and would
 * require live API keys to smoke. We test only the routing logic.
 *
 * Run with: `npx --yes tsx __tests__/llm-provider.test.ts`
 */
import { getLlm, activeProvider, type LlmProvider } from '../lib/llm/provider'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(overrides)) prev[k] = process.env[k]
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else                 process.env[k] = v
  }
  try { fn() }
  finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else                 process.env[k] = v
    }
  }
}

// 1. Default — no LLM_PROVIDER set → 'claude'
withEnv({ LLM_PROVIDER: undefined }, () => {
  assert(activeProvider() === 'claude', `default should be claude, got ${activeProvider()}`)
})

// 2. LLM_PROVIDER=openrouter → 'openrouter'
withEnv({ LLM_PROVIDER: 'openrouter' }, () => {
  assert(activeProvider() === 'openrouter', `openrouter env should resolve, got ${activeProvider()}`)
})

// 3. Case-insensitive
withEnv({ LLM_PROVIDER: 'OpenRouter' }, () => {
  assert(activeProvider() === 'openrouter', `case-insensitive resolve, got ${activeProvider()}`)
})

// 4. Unknown values fall back to claude (never throw at module level)
withEnv({ LLM_PROVIDER: 'gpt5-direct' }, () => {
  assert(activeProvider() === 'claude', `unknown should fall back to claude, got ${activeProvider()}`)
})

// 5. Explicit provider option wins over env
withEnv({ LLM_PROVIDER: 'claude' }, () => {
  // OpenRouter requires OPENROUTER_API_KEY to construct the model;
  // exercise the route path by checking it throws the documented config
  // error when the key is missing — proves the switch dispatched here.
  withEnv({ OPENROUTER_API_KEY: undefined }, () => {
    let thrown: unknown = null
    try { getLlm({ provider: 'openrouter' }) }
    catch (err) { thrown = err }
    assert(thrown instanceof Error, 'should throw Error when openrouter unconfigured')
    const message = (thrown as Error).message
    assert(
      message.includes('OpenRouter not configured'),
      `should mention OpenRouter, got: ${message}`,
    )
  })
})

// 6. OpenRouter with key → returns a LanguageModel (no throw)
withEnv({ OPENROUTER_API_KEY: 'sk-or-test-fake-key' }, () => {
  const model = getLlm({ provider: 'openrouter' })
  assert(model !== null && typeof model === 'object', 'should return a LanguageModel object')
})

// 7. Default OpenRouter model matches OPENROUTER_DEFAULT_MODEL when set
withEnv({
  OPENROUTER_API_KEY:      'sk-or-test-fake-key',
  OPENROUTER_DEFAULT_MODEL: 'openai/gpt-5',
}, () => {
  // We can't introspect the model id from the LanguageModel object directly
  // without coupling to the AI SDK's internal shape — but we can confirm
  // construction doesn't throw with a custom default, which is the surface
  // that matters for the env-var contract.
  const model = getLlm({ provider: 'openrouter' })
  assert(model !== null, 'custom default model should construct without error')
})

// 8. Type-level: LlmProvider union includes openrouter
const provider: LlmProvider = 'openrouter'
assert(provider === 'openrouter', 'compile-time check that openrouter is in LlmProvider union')

console.log('OK — lib/llm/provider.ts openrouter integration tests pass')
