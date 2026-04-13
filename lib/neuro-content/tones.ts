/**
 * lib/neuro-content/tones.ts
 * 5 tone profiles for neuro-optimised content generation.
 */

import type { ToneProfile } from './types'

export const TONE_PROFILES: ToneProfile[] = [
  {
    id:          'authority',
    name:        'Authority',
    tagline:     'The expert who\'s seen it all',
    description: 'Confident, definitive, data-backed. You\'ve earned the right to speak with certainty. Used by thought leaders, experienced executives, and domain experts.',
    voice: `You speak from a position of earned expertise. Your sentences are declarative, not hedged. You cite specific data, name real experiences, and make clear judgements without apology. There is no "maybe" or "it depends" — you give the answer, then explain why. Readers trust you because you sound like you've tested the advice yourself, not just read it somewhere.`,
    doList: [
      'Make bold declarative statements: "The answer is X. Here\'s why."',
      'Reference specific data, names, case studies, and timeframes',
      'Use the passive voice sparingly — active voice signals confidence',
      'Open with your conclusion, then prove it',
      'Use "will" not "might" when predicting outcomes',
      'Acknowledge counterarguments briefly, then dismiss them decisively',
    ],
    dontList: [
      'Hedge with "I think", "perhaps", "it seems like", "in my opinion"',
      'Ask permission: "I hope this is helpful", "let me know if you agree"',
      'Over-explain the obvious — respect the reader\'s intelligence',
      'Use corporate jargon or buzzwords that dilute authority',
      'Apologise for length or directness',
    ],
    samplePhrase: 'Most growth strategies fail for one reason: founders optimise for the wrong metric. Fix the metric; fix the business.',
  },
  {
    id:          'peer',
    name:        'Peer',
    tagline:     'A smart friend sharing what\'s working',
    description: 'Warm, conversational, honest. You\'re talking to an equal — not teaching, not selling. Used by community builders, operators, and founders who want trust over status.',
    voice: `You write like you're texting a smart friend who happens to need this information. Contractions are fine. Incomplete sentences are fine. Starting with "And" or "But" is fine. You share mistakes alongside wins. You're transparent about uncertainty. The reader feels like they're getting the unfiltered version — not the polished pitch. This tone builds community because it signals: "I'm one of you."`,
    doList: [
      'Use contractions freely: "it\'s", "you\'re", "I\'ve", "here\'s"',
      'Include personal failures, not just wins',
      'Write short, punchy paragraphs — like texts, not essays',
      'Ask genuine questions you don\'t already know the answer to',
      'Use "we" when talking about shared challenges',
      'Admit when something is hard or uncertain',
    ],
    dontList: [
      'Sound like you\'re presenting to a board',
      'Use vocabulary that signals status or gatekeeping',
      'Make the reader feel less-than for not knowing something',
      'Over-produce — raw and real beats polished and distant',
      'Use second-person imperatives constantly — mix in "I" and "we"',
    ],
    samplePhrase: "Here's what I got wrong for the first two years — and why fixing it added $30k MRR almost overnight.",
  },
  {
    id:          'challenger',
    name:        'Challenger',
    tagline:     'The contrarian who reframes everything',
    description: 'Provocative, disruptive, counterintuitive. You challenge assumptions the audience didn\'t know they had. Used for thought leadership, category creation, and breaking through noise.',
    voice: `You exist to disrupt comfortable thinking. Every post starts with an assumption the reader holds — and then dismantles it. You're not rude, but you are relentless. The reader finishes your content feeling like their worldview shifted slightly. This tone generates strong reactions (shares, debates, saves) because it challenges identity — the most powerful cognitive trigger. Use data and specificity to earn the right to challenge; provocation without proof is just noise.`,
    doList: [
      'Open by naming a widely-held belief, then challenging it directly',
      'Use "counterintuitive" structures: "The more X, the less Y"',
      'Back every provocative claim with a specific data point or example',
      'Name the conventional wisdom explicitly before attacking it',
      'Embrace disagreement — "you might hate this, but..."',
      'End with a provocative open question that forces re-evaluation',
    ],
    dontList: [
      'Be contrarian for its own sake — every challenge needs substance',
      'Insult people who hold the belief you\'re challenging',
      'Soften the challenge with so many caveats it loses its edge',
      'Claim originality for ideas that aren\'t original',
      'Write from a place of anger — curiosity provokes better than hostility',
    ],
    samplePhrase: 'The productivity advice industry is making you worse at your job. Here\'s the uncomfortable reason why.',
  },
  {
    id:          'storyteller',
    name:        'Storyteller',
    tagline:     'Every insight wrapped in a scene',
    description: 'Narrative-driven, sensory, emotionally resonant. Every point arrives through story. Used for brand building, content that gets shared, and audiences who learn through narrative.',
    voice: `You never state a lesson — you dramatise it. Every insight arrives as the conclusion of a scene: a specific moment, a real person, a decision point with stakes. You use sensory language to make abstract ideas physical and memorable. Your writing has a beginning, middle, and end — even a 200-word LinkedIn post. The reader doesn't feel like they're being taught; they feel like they're watching something unfold. This is how ideas stick.`,
    doList: [
      'Open in the middle of a scene: "It was 11pm. The Slack message appeared."',
      'Name specific people, places, dates, and objects',
      'Use sensory language: what did it look like, sound like, feel like?',
      'Build tension before resolution — delay the lesson',
      'Let the story do the work — don\'t over-explain the moral',
      'End scenes with a single clear emotional beat',
    ],
    dontList: [
      'Open with "Today I want to talk about..."',
      'State the lesson before the story — earn it',
      'Use generic settings: "a company", "a founder", "recently"',
      'Pad with filler — every sentence must earn its place in the scene',
      'Let the story run so long the point gets lost',
    ],
    samplePhrase: "The call lasted four minutes. When it ended, I closed my laptop, walked outside, and sat on the kerb for twenty minutes. We'd just lost the contract that was supposed to save the company.",
  },
  {
    id:          'data-driven',
    name:        'Data-Driven',
    tagline:     'Numbers that tell an undeniable story',
    description: 'Precise, analytical, evidence-first. Every claim is quantified; every conclusion follows the data. Used for B2B content, research-backed thought leadership, and technically sophisticated audiences.',
    voice: `You let the numbers do the persuading. Every claim has a source, a percentage, a timeframe, or a sample size. You present data visually through text — tables, lists, comparisons — so the pattern is obvious. You're not cold or clinical; you contextualise data emotionally so the reader feels the significance. Your credibility comes from specificity: not "most companies fail" but "72% of Series A companies miss their 18-month revenue target by more than 40%."`,
    doList: [
      'Lead with the most striking data point — anchor the reader\'s attention',
      'Cite sources inline (even generally: "Stanford, 2024") for credibility',
      'Use comparison data to make numbers meaningful: "that\'s 3x the industry average"',
      'Structure content as "observation → data → implication → action"',
      'Use lists and subheadings to make data scannable',
      'Acknowledge limitations of data honestly — it increases trust',
    ],
    dontList: [
      'Use round numbers unless they\'re actually round ("about 50%" vs "47%")',
      'Cite data without context — "23% increase" in what, over what period?',
      'Let the data speak alone — connect it to human impact',
      'Use jargon that only statisticians understand',
      'Cherry-pick data without addressing contradicting evidence',
    ],
    samplePhrase: 'Of 1,200 cold email sequences analysed, those under 75 words generated a 34% reply rate — 2.8× higher than sequences over 200 words.',
  },
]

// ── Lookup helper ─────────────────────────────────────────────────────────────
export function getToneProfile(id: string): ToneProfile | undefined {
  return TONE_PROFILES.find(t => t.id === id)
}
