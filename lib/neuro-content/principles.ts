/**
 * lib/neuro-content/principles.ts
 * The 12 cognitive engagement principles that power Tribe v2.
 * Each principle is backed by cognitive neuroscience research on how the brain
 * processes and responds to written content.
 */

import type { NeuroPrinciple } from './types'

export const NEURO_PRINCIPLES: NeuroPrinciple[] = [
  {
    id:          'curiosity-gap',
    name:        'Curiosity Gap',
    description: 'Create an information gap the reader\'s brain is compelled to close.',
    application: 'Open with an incomplete statement, surprising fact, or question. Delay the resolution. The gap creates cognitive tension that makes reading feel urgent.',
    signals:     ['here\'s what most people miss', 'the surprising truth', 'what nobody tells you', 'the counterintuitive reason', '…and here\'s why'],
  },
  {
    id:          'open-loops',
    name:        'Open Loops',
    description: 'Start patterns the brain needs to complete — like unfinished music.',
    application: 'Introduce a concept or story thread, then defer the conclusion. The Zeigarnik effect ensures readers stay engaged until resolution. Layer multiple open loops at different scales.',
    signals:     ['I\'ll come back to this', 'more on that in a moment', 'but first', 'here\'s where it gets interesting', 'the story doesn\'t end there'],
  },
  {
    id:          'social-proof',
    name:        'Social Proof',
    description: 'Leverage the brain\'s hardwired tendency to follow crowd behaviour.',
    application: 'Use specific numbers, named individuals, or vivid group references. Vague social proof ("many people") is far weaker than specific ("4,712 founders used this framework last month").',
    signals:     ['founders', 'companies like', 'X people', 'the same approach used by', 'trusted by', 'join'],
  },
  {
    id:          'contrast-effect',
    name:        'Contrast Effect',
    description: 'The brain evaluates everything relative to an anchor — not in absolute terms.',
    application: 'Establish a reference point (before/after, old way/new way, them/us) and then present your alternative. The contrast amplifies perceived value far beyond stating benefits alone.',
    signals:     ['before', 'used to', 'most people', 'the old way', 'instead', 'vs', 'unlike', 'compared to'],
  },
  {
    id:          'loss-aversion',
    name:        'Loss Aversion Framing',
    description: 'Losses feel twice as powerful as equivalent gains — use this asymmetry.',
    application: 'Frame benefits as preventing loss rather than achieving gain. Not "gain $10k" but "stop leaving $10k on the table." Use sparingly — overuse feels manipulative.',
    signals:     ['you\'re losing', 'leaving money on the table', 'every day you wait', 'missing out', 'can\'t afford not to', 'the cost of doing nothing'],
  },
  {
    id:          'specificity',
    name:        'Specificity Anchoring',
    description: 'Specific details dramatically increase believability and memory retention.',
    application: 'Replace every vague claim with a specific number, name, date, or place. "Helped companies grow" → "Helped 34 B2B SaaS companies add $2.1M ARR in 90 days." Specificity signals truth.',
    signals:     ['exactly', 'specifically', '%', '$', 'in N days/weeks', 'N out of N', 'step-by-step'],
  },
  {
    id:          'future-pacing',
    name:        'Future Pacing',
    description: 'Project the reader into a vivid desired future state — the brain simulates it as real.',
    application: 'Use second-person future tense to walk the reader through what life looks like after they take action. Engage multiple senses. The more vivid the simulation, the stronger the motivation.',
    signals:     ['imagine', 'picture this', 'six months from now', 'you\'ll wake up', 'what would it feel like', 'by next quarter'],
  },
  {
    id:          'micro-tension',
    name:        'Micro-Tension',
    description: 'Small moments of discomfort, conflict, or ambiguity that sustain engagement.',
    application: 'Introduce minor friction: a counterintuitive claim, a brief challenge to the reader\'s belief, a small conflict in a story. Comfort creates skimming; friction creates reading.',
    signals:     ['but here\'s the problem', 'most people get this wrong', 'what if I told you', 'the uncomfortable truth', 'this might surprise you'],
  },
  {
    id:          'identity-mirroring',
    name:        'Identity Mirroring',
    description: 'People act in ways consistent with how they see themselves or want to be seen.',
    application: 'Reflect back the reader\'s existing identity ("as a founder who cares about...") or their aspirational identity ("the kind of leader who..."). Identity consistency is a powerful motivator.',
    signals:     ['as someone who', 'you\'re the kind of person', 'people like you', 'for founders who', 'if you believe that'],
  },
  {
    id:          'pattern-interrupt',
    name:        'Pattern Interrupts',
    description: 'Break the reader\'s expected pattern to snap attention back to the content.',
    application: 'Use unexpected formatting (a very short sentence after a long one), a surprising pivot, an unusual word, or a bold claim that defies category expectations. The brain is wired to notice violations of pattern.',
    signals:     ['stop.', 'wait.', 'actually,', 'here\'s the thing:', 'I\'m going to be honest', 'full stop'],
  },
  {
    id:          'sensory-language',
    name:        'Sensory Language',
    description: 'Words that evoke physical sensation activate the same neural circuits as real experience.',
    application: 'Include tactile, visual, auditory, or kinesthetic language. "The sharp click of a deal closing." "The weight of a full pipeline." Physical metaphors make abstract concepts visceral and memorable.',
    signals:     ['feel', 'hear', 'see', 'sharp', 'heavy', 'bright', 'smooth', 'rough', 'pull', 'push', 'weight'],
  },
  {
    id:          'progressive-disclosure',
    name:        'Progressive Disclosure',
    description: 'Reveal information gradually — each piece earns the right to the next.',
    application: 'Structure content so each sentence or paragraph delivers enough value to justify reading the next. Never front-load everything. Build a staircase of revelation where each step earns the climb.',
    signals:     ['first', 'then', 'next', 'but there\'s more', 'here\'s where it gets better', 'the final piece'],
  },
]

// ── Scoring system prompt ─────────────────────────────────────────────────────
export function buildScoringPrompt(content: string): string {
  const principleList = NEURO_PRINCIPLES.map((p, i) =>
    `${i + 1}. **${p.name}** (id: ${p.id}): ${p.description} Signals: ${p.signals.slice(0, 3).join(', ')}.`
  ).join('\n')

  return `You are a cognitive neuroscience content analyst. Score the following content against 12 principles of neural engagement.

## The 12 Principles
${principleList}

## Content to Score
${content.slice(0, 4000)}${content.length > 4000 ? '\n[...truncated]' : ''}

## Instructions
Score each principle 0–100 based on how effectively the content applies it. Be honest — most first drafts score 30–60.

Scoring guide:
- 0–30: Principle absent or actively violated
- 31–60: Principle present but weak or generic
- 61–80: Principle applied effectively
- 81–100: Masterful, memorable application

Respond with ONLY valid JSON (no markdown fences):
{
  "principles": [
    {
      "principleId": "curiosity-gap",
      "principleName": "Curiosity Gap",
      "score": 0-100,
      "rationale": "one sentence explaining the score",
      "improvement": "one specific rewrite suggestion (empty string if score >= 80)"
    }
  ],
  "topStrengths": ["principle name 1", "principle name 2", "principle name 3"],
  "topWeaknesses": ["principle name 1", "principle name 2", "principle name 3"],
  "suggestions": ["concrete suggestion 1", "concrete suggestion 2", "concrete suggestion 3"]
}`
}

// ── Revision prompt ───────────────────────────────────────────────────────────
export function buildRevisionPrompt(
  draft:       string,
  weaknesses:  string[],
  improvements:string[],
  format:      string,
  tone:        string,
): string {
  return `You are a master conversion copywriter. Rewrite the following content to significantly improve its neural engagement score.

## Current Draft
${draft}

## Weaknesses to Fix (in order of priority)
${weaknesses.map((w, i) => `${i + 1}. ${w}: ${improvements[i] ?? 'Strengthen this principle'}`).join('\n')}

## Format
${format}

## Tone
${tone}

## Instructions
- Keep all factual claims and key messages intact
- Strengthen the weak principles listed above without breaking the strong ones
- Maintain natural flow — it should feel authentic, not engineered
- Do NOT add meta-commentary about what you changed
- Output ONLY the improved content, ready to publish`
}
