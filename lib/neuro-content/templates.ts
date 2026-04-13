/**
 * lib/neuro-content/templates.ts
 * 8 content format templates, each with format-specific neuro guidelines.
 */

import type { FormatTemplate } from './types'

export const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    id:            'linkedin-post',
    name:          'LinkedIn Post',
    description:   'Professional network post optimised for engagement and sharing',
    icon:          'Linkedin',
    maxCharacters: 3000,
    structure: `Line 1: Hook (curiosity gap or bold claim — no more than 12 words)
Line 2-3: Context / contrast setup (what most people do wrong)
Lines 4-8: The insight / framework / story (your core value)
Line 9-10: Future pacing or identity mirror
Final line: Call-to-action or open question`,
    neuroGuidelines: `- Lead line must work as a standalone tweet — it's what appears before "see more"
- Use short paragraphs (1–2 lines max) — LinkedIn's mobile readers scan
- Never start with "I" — start with the insight or a question
- Include a specific number in the first 50 words
- End with a question to drive comments (algorithm boost)
- Avoid corporate language — write like a human talking to a friend`,
    example: `Most founders waste 80% of their marketing budget.

Not because they target the wrong audience.
Because they say the wrong thing.

Here's the 3-word rule that changed everything for us:
[core insight unfolds over 4–5 short paragraphs]

Which of these mistakes have you made?`,
  },
  {
    id:            'x-thread',
    name:          'X (Twitter) Thread',
    description:   'Multi-tweet thread optimised for virality and saves',
    icon:          'MessageSquare',
    maxCharacters: 280,
    structure: `Tweet 1 (hook): Bold claim or curiosity gap — makes them tap for more
Tweets 2-3: Setup / tension (the problem or the old way)
Tweets 4-8: The core content in tight, numbered points
Tweet 9: Synthesis / the bigger insight
Tweet 10: Call to action (follow, bookmark, retweet with comment)`,
    neuroGuidelines: `- Every tweet must be a standalone thought AND build on the previous
- Use "n/" format (e.g. 1/, 2/) — readers know it's a thread worth following
- Pattern interrupt between tweets — vary length and rhythm
- One idea per tweet — complexity kills threads
- The hook tweet is 80% of the thread's success — test multiple versions
- End tweets on a cliffhanger or unresolved question whenever possible`,
    example: `Most marketing advice will make your business worse.

Here's what actually works (and why most people get it backwards): 🧵

1/ [short punchy point]
2/ [surprising nuance]
...
10/ If this helped, follow @handle for one insight like this every week.`,
  },
  {
    id:            'instagram-caption',
    name:          'Instagram Caption',
    description:   'Visual-first caption that earns saves and comments',
    icon:          'Image',
    maxCharacters: 2200,
    structure: `Line 1: Hook that complements the image (not describes it)
Lines 2-3: Story or context
Lines 4-6: Core insight or value
Line 7: Identity mirror or future pace
Final: CTA + relevant hashtags (on a new line)`,
    neuroGuidelines: `- The caption should extend the image's story, not repeat it
- Use the "3-second rule" — hook must earn the tap within 3 seconds
- Write in first person — intimacy outperforms polish on Instagram
- Include a micro-story (conflict → resolution in 3 sentences)
- Hashtags go at the end, separated by a line break — never in the text
- "Save this for later" CTAs significantly outperform "double tap if..."`,
    example: `This mistake cost me $40k.

[2-3 line personal story]

What I learned: [insight]

Save this before you make the same mistake.
.
.
#entrepreneurship #startup #lessons`,
  },
  {
    id:            'long-form-blog',
    name:          'Long-Form Blog Post',
    description:   'SEO-optimised article with neuro engagement throughout',
    icon:          'FileText',
    maxCharacters: 20000,
    structure: `H1: Title (curiosity gap + target keyword)
Intro (200 words): Hook + open loop + what reader will gain
H2: The Problem / Context
H2: The Core Insight / Framework (use numbered list)
H2: Application / How to implement
H2: Common Mistakes / What to avoid
H2: Case Study or Example
Conclusion: Future pace + single CTA`,
    neuroGuidelines: `- Title must contain a curiosity gap AND a target keyword
- Intro should open 3 loops: a story, a data point, and a promise
- Use subheadings as curiosity gaps themselves (not summaries)
- Every 300 words: pattern interrupt (bold line, table, image break, short paragraph)
- Specificity is SEO and neuro gold — name real numbers, studies, people
- Final CTA should be one clear action — never multiple options`,
    example: `# Why 73% of Content Marketing Fails (And the 4-Part Fix)

Intro: Most companies spend $X on content and get almost nothing back. Here's why — and the counterintuitive framework that changes it.

[H2: The Real Problem with Most Content]
[H2: The IMPACT Framework]
...`,
  },
  {
    id:            'cold-email',
    name:          'Cold Email',
    description:   'Outreach sequence with high open and reply rates',
    icon:          'Mail',
    maxCharacters: 500,
    structure: `Subject line: 6 words max — curiosity gap or specific name-drop
Line 1: Personalised observation (specific to them, not generic)
Lines 2-3: Problem they have (framed as loss they're experiencing)
Lines 4-5: Your specific proof (numbers, company names, timeframe)
Line 6: Single, low-friction ask (15-min call, reply with one word)
P.S.: Pattern interrupt or social proof`,
    neuroGuidelines: `- Subject line should feel like it was written specifically for them
- Never start with "I" or "My name is" — start with THEM
- The pain must be specific enough to feel personally observed, not Googled
- One ask only — options kill response rates
- Total length: under 100 words for maximum reply rate
- P.S. lines have 90%+ readership — use them for your strongest proof point`,
    example: `Subject: [Company] + [our company]?

Noticed you recently [specific observation].

Most companies in [their space] are dealing with [specific problem] — which usually costs [specific consequence].

We helped [similar company] [specific result] in [timeframe].

Worth a 15-min call to see if we can do the same?

P.S. [Social proof or urgency]`,
  },
  {
    id:            'landing-page-hero',
    name:          'Landing Page Hero',
    description:   'Above-the-fold copy that converts visitors to action',
    icon:          'Layout',
    maxCharacters: 400,
    structure: `H1 Headline: The transformation promise (before → after)
H2 Subheadline: How + for whom + timeframe
Body copy (2-3 sentences): Specific proof + objection handling
CTA button text: Action + outcome (not generic "sign up")
Trust element: Social proof stat or logo line`,
    neuroGuidelines: `- The headline is doing 90% of the work — write 20 versions, pick the best
- Subheadline answers "for whom" and "how quickly" — specificity converts
- Avoid feature lists above the fold — lead with transformation
- CTA copy should complete the sentence "I want to ___"
- Include a number in the headline if possible — specificity anchors trust
- Every word competes for attention — cut any word that doesn't earn its place`,
    example: `H1: From Zero to $10k MRR in 90 Days
H2: The AI-powered growth engine for early-stage SaaS founders
Body: Join 2,400 founders who used [product] to hit their first $10k MRR. Average time: 73 days.
CTA: Start My 90-Day Sprint →
Trust: ★★★★★ 4.9/5 from 312 reviews`,
  },
  {
    id:            'vsl-script',
    name:          'VSL Script',
    description:   'Video Sales Letter script with pattern interrupts and neuro hooks',
    icon:          'Video',
    maxCharacters: 10000,
    structure: `[0:00-0:15] Hook: Bold claim or shocking stat — earns the next 30 seconds
[0:15-0:45] Agitate: The problem, viscerally described (sensory language)
[0:45-1:30] Credibility: Who you are and specific proof (not biography)
[1:30-3:00] The Solution: Framework / mechanism (not product features)
[3:00-4:30] Evidence: Case studies with specific numbers
[4:30-5:00] Objection handling: Top 3 objections → rebuttals
[5:00-5:30] Offer + CTA: What they get + how to get it
[5:30-6:00] Urgency/scarcity + repeat CTA`,
    neuroGuidelines: `- Write for the ear, not the eye — short sentences, natural contractions
- Pattern interrupt every 30–45 seconds (new visual, new voice tone, bold claim)
- The "agitate" section uses sensory language to make the pain physical
- Never say "I want to talk to you about X" — just start with X
- Rhetorical questions re-engage drifting attention
- The CTA must be repeated at least 3 times — spaced, not stacked`,
    example: `[HOOK] If you're still cold-calling prospects in 2025, you're leaving 60% of your pipeline on the table.

[AGITATE] You know the feeling. You've prepped for 20 minutes. The phone rings once, twice...

[SOLUTION] There's a 3-step sequence that changes everything...`,
  },
  {
    id:            'youtube-description',
    name:          'YouTube Description',
    description:   'SEO-rich description that earns clicks and subscriber conversions',
    icon:          'Youtube',
    maxCharacters: 5000,
    structure: `First 2 lines (above fold): Curiosity hook + keyword-rich summary
Lines 3-5: What viewers will learn (open loops)
Timestamps: Every 2–3 minutes, written as hooks not summaries
Resources/links section
About + social links
#Hashtags (3–5 relevant ones)`,
    neuroGuidelines: `- The first 2 lines appear in search results — make them count
- Each timestamp should function as a curiosity gap (not a summary)
- Include the primary keyword naturally in the first sentence
- "What you'll learn" bullets should create anticipation, not give away the answer
- The description extends the video's brand story — reinforce tone and identity
- End with a specific subscribe ask linked to a concrete benefit`,
    example: `Most people quit YouTube after 3 months. Here's the exact system that keeps growing channels for years.

In this video: the 4 content pillars, the retention hack nobody talks about, and why thumbnails aren't what you think.

⏱ TIMESTAMPS:
0:00 – The mistake that kills 90% of channels
2:15 – [Hook, not summary]
...`,
  },
]

// ── Lookup helper ─────────────────────────────────────────────────────────────
export function getTemplate(id: string): FormatTemplate | undefined {
  return FORMAT_TEMPLATES.find(t => t.id === id)
}
