#!/usr/bin/env bash
# UserPromptSubmit hook — routes prompts to skills by matching keywords.
# Reads the JSON envelope on stdin, extracts the prompt, prints a context
# hint to stdout. Claude Code injects stdout into the user-turn context.
# Non-zero exit would block submission; we always exit 0.

set -euo pipefail

payload="$(cat)"
prompt="$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print(d.get("prompt") or d.get("user_prompt") or "")
except Exception:
    sys.exit(0)' 2>/dev/null || true)"

# Lowercase for matching
lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

hints=()

matches() {
  for pat in "$@"; do
    if printf '%s' "$lc" | grep -qE "$pat"; then return 0; fi
  done
  return 1
}

# ── Skill routing rules ──────────────────────────────────────────────────
# Each block: if keywords match → suggest the relevant skill/workflow.

if matches 'scrape|fetch .*(url|website|page)|pull .* from https?://|extract .* from .*\.com|get the content|read this (url|page|site)'; then
  hints+=('- Prompt mentions reading a URL → consider **/firecrawl_local scrape <url>** (token-free, calls node .claude/skills/firecrawl_local/scrape.mjs). For a whole site, /firecrawl_local map then crawl.')
fi

if matches 'search the (web|internet)|google .*|look up online|find .* on the web'; then
  hints+=('- Prompt asks for web search → /firecrawl_local cannot search. Use Tavily (lib/tools/tavily.ts, needs key) or the built-in WebSearch tool. If researching a specific known URL, /firecrawl_local scrape is faster.')
fi

if matches 'remember this|save to memory|note this down|store for later|recall|what did we decide|past session'; then
  hints+=('- Prompt is about durable memory → consider **/molecularmemory_local** (atomic notes + entities + MOCs at memory/molecular/). For platform rules/roadmap, use memory/INDEX.md.')
fi

if matches 'extract (facts|atoms|atomic|key points|main ideas)|break .* into .*notes|summarize .* into notes|atomic notes'; then
  hints+=('- Prompt asks to extract facts → use **/molecularmemory_local**: run `init`, then for each distinct fact call `atom "<title>" --fact="..." --source=<url>`. Create entity notes for every person/company/concept mentioned.')
fi

if matches 'knowledge graph|map of content|moc|connect .* notes|how .* relate'; then
  hints+=('- Prompt is about knowledge structure → **/molecularmemory_local moc** or `graph` to build a Map of Content. Query existing graph first: `cli.mjs query "<topic>"`.')
fi

if matches 'refactor .* (across|multiple|many) files|rename .* across|multi-file|god node|call graph|where is .* used|who calls'; then
  hints+=('- Prompt spans multiple files → start a /molecularmemory_local MOC for the affected module (node .claude/skills/molecularmemory_local/cli.mjs moc "<module>") and accumulate atoms as you explore. This anchors a multi-file refactor without rescanning.')
fi

if matches 'write (a )?test|tdd|red[ -]green[ -]refactor|failing test first'; then
  hints+=('- TDD workflow → if /superpowers is loaded, it provides the RED-GREEN-REFACTOR skill. Follow AGENTS.md rule: failing test first, watch it fail, then minimal implementation.')
fi

if matches 'debug|why is .* failing|root cause|broken|not working|error'; then
  hints+=('- Debugging → /superpowers systematic-debugging skill (4-phase root cause) is the right tool if loaded. Otherwise: reproduce → isolate → hypothesis → verify.')
fi

if matches 'plan|break .* down|architect|design (the|an?) (feature|api|page)|implementation plan|roadmap'; then
  hints+=('- Planning task → follow the CLAUDE.md 4-step protocol (North Star → Explore → Plan → Implement). Use Plan agent for a step-by-step plan, or Nexus Architect for stack-rule-aware design.')
fi

if matches 'learn my patterns|style|how i work|personalize|adapt to me'; then
  hints+=('- Personalization → /claude-evolve (if loaded) captures patterns into reusable rules/skills/agents.')
fi

if matches 'security review|audit .* security|vulnerabil'; then
  hints+=('- Security review → use the built-in /security-review skill.')
fi

if matches 'review (this )?(pr|pull request|diff|change)'; then
  hints+=('- Code review → use the built-in /review skill.')
fi

if [ ${#hints[@]} -gt 0 ]; then
  {
    echo "<skill-router>"
    echo "Candidate skills for this prompt (advisory — pick only if the match is genuine, otherwise ignore):"
    for h in "${hints[@]}"; do echo "$h"; done
    echo "</skill-router>"
  }
fi

exit 0
