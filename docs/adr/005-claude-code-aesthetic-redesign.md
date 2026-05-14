# ADR 005 — Claude-Code-aesthetic redesign + liquid glass

**Status:** Proposed
**Date:** 2026-05-15
**Supersedes:** scattered inline styles across components

## Context

Today's Nexus UI is functional but visually scattered. Each component reaches for hex literals (`#0d0d14`, `#24243e`, `#a8a3ff`) and inline `style={{ ... }}` objects rather than a shared design system. The chat surfaces — added incrementally over Phases 1–9 — landed with a stronger aesthetic than the dashboards and settings pages, so the platform looks inconsistent depending on which surface you're on.

The operator's reference point is Claude Code: dense, monochromatic, generous-but-not-bloated whitespace, minimal color, _quiet_ chrome that gets out of the way. With one accent color (purple) used only for state (active item, loading, focus). Combined with **liquid glass** — soft backdrop blur on overlay surfaces, semi-transparent panels with subtle internal gradients — this is a recognisable, premium-feeling visual style.

The pre-redesign work that's already done (sidebar collapsible, Views dropdown, ResizablePanel hook, ToolCallCard, ApprovalCard) already pulls in this direction. The redesign is about consolidating the tokens, applying them everywhere, and removing the inconsistencies.

## Goals

1. **One design vocabulary, used everywhere** — no more per-file color literals or one-off type sizes.
2. **Claude-Code-aesthetic** — near-black backgrounds, monospace + sans pair, generous-but-tight spacing, single accent color used for state only.
3. **Liquid glass on overlays** — popovers, modals, side panels, dropdowns use `backdrop-filter: blur` + semi-transparent fill.
4. **Coherent across surfaces** — `/dashboard`, `/board`, `/businesses`, `/graph`, `/learn`, `/tools`, `/settings`, `/manage-platform` all feel like the same product.
5. **Doesn't break Phases 1–9** — the chat work that just shipped should look better afterward, not regress.

## Non-goals

- Not a feature pass. No new pages, no new agent surfaces.
- Not a marketing landing-page redesign. `/` and `/sign-in` are existing Clerk-managed pages — leave them alone for now.
- Not removing the React framework's components — Tailwind classes stay, just point at design tokens.

## Design tokens (the vocabulary)

Defined once in `app/globals.css` under `@theme inline { }` (Tailwind 4 CSS-first). Every component references via class or `var(--token)`.

### Color

```
--bg-base       #050508   /* page background */
--bg-raised     rgba(255,255,255,0.02)   /* panels at +1 elevation */
--bg-glass-1    rgba(15,15,24,0.92)      /* soft overlay (dropdowns) */
--bg-glass-2    rgba(15,15,24,0.96)      /* strong overlay (modals) */

--border-soft   rgba(255,255,255,0.06)   /* divider lines */
--border-mid    rgba(255,255,255,0.10)   /* card outlines */
--border-strong rgba(255,255,255,0.18)   /* focus outlines */

--text-1        #e8e8f0   /* primary copy */
--text-2        #c8c8d8   /* secondary copy */
--text-3        #9090b0   /* tertiary / hint copy */
--text-4        #55556a   /* faint / disabled */

--accent        #6c63ff   /* purple — state only (active, focus, loading) */
--accent-soft   rgba(108,99,255,0.20)
--accent-tint   rgba(108,99,255,0.10)

--ok            #22c55e
--warn          #f59e0b
--err           #ef4444
```

The accent is **only** for state. Never use purple for decoration. Brand color is the absence of color — Claude Code's confidence.

### Type

Single sans family (Inter Variable, with system fallback) for everything except code blocks, which use a single mono family (JetBrains Mono Variable). No second display font.

```
--font-sans     'InterVariable', system-ui, …
--font-mono     'JetBrainsMono', ui-monospace, …

--text-xs       11px / 16px
--text-sm       13px / 20px
--text-base     14px / 22px
--text-lg       16px / 24px
--text-xl       20px / 28px

--track-tight    -0.01em
--track-normal   0
--track-wide     0.02em
--track-eyebrow  0.14em uppercase    /* used for section labels */
```

### Spacing + radius

Tailwind defaults work but we constrain to a known set so spacing feels rhythmic:

```
2 / 3 / 4 / 6 / 8 / 12 / 16 / 24 px      — primary scale
--radius-sm   6px     /* chips, inputs */
--radius-md   10px    /* cards */
--radius-lg   16px    /* modals, big panels */
```

### Motion

```
--ease-out-soft   cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out     cubic-bezier(0.65, 0, 0.35, 1)

--dur-quick     120ms      /* hover, ring, tooltips */
--dur-base      180ms      /* opens / closes */
--dur-slow      280ms      /* page transitions */
```

### Liquid glass primitives

A single utility class `.glass` applied to overlay surfaces:

```css
.glass {
  background:           var(--bg-glass-1);
  border:               1px solid var(--border-mid);
  backdrop-filter:      blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow:           0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.40);
}

.glass-strong {
  /* For modals and full-screen-ish surfaces */
  background:           var(--bg-glass-2);
  border:               1px solid var(--border-mid);
  backdrop-filter:      blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
}
```

Uses CSS `backdrop-filter`. Safari + Firefox + Chrome 76+ all support it. On unsupported browsers the fallback is a flat color — acceptable degradation.

## What changes — surface inventory

The redesign pass touches every surface but with a tight rubric:

| Surface | Today | After redesign | Risk |
|---|---|---|---|
| Sidebar (`components/layout/Sidebar.tsx`) | Custom hex literals, mixed type sizes | Use design tokens, glass surface on hover popovers | Low — already close |
| Dashboard (`/dashboard`) | Card grid with inline colors | KPI cards re-styled to `.glass`, type pass, accent purple only on hover/state | Med — most-used page |
| Chat surfaces (`PlatformChat`, `BusinessChat`) | Phase 9 visuals | Token-ify hex literals (already aligned, mostly cosmetic) | Low |
| Views panel | Phase 9 visuals | Use `.glass` class instead of inline backdrop-filter | Low |
| `/businesses` index | New in #170 | Token-ify; convert cards to `.glass` style | Low |
| `/board` kanban | Mixed styles | Card chrome unified | Med |
| `/graph` | three.js canvas — leave alone | Just the chrome around it (controls, legend) | Low |
| `/learn`, `/tools`, `/manage-platform`, `/settings`, `/idea` | Each different | Apply tokens; no layout changes | Med — biggest LOC delta |

## Phased rollout

Five PRs sequenced for safety:

| Phase | PR scope | Risk gate |
|---|---|---|
| **R1** | `app/globals.css` — define every token. Add `.glass` and `.glass-strong` utilities. Add Inter + JetBrains Mono `@font-face`. **No component changes yet** — tokens live in CSS but nothing consumes them. | None — additive only |
| **R2** | Refactor the chat surfaces first (already closest to target) to consume tokens instead of hex literals. PlatformChat + BusinessChat + ToolCallCard + ApprovalCard + ViewsPanel. | Low — visual diff should be near-zero |
| **R3** | Sidebar + top bar + `/businesses` + `/dashboard`. | Med — apply tokens; do NOT change layouts |
| **R4** | Remaining surfaces (`/board`, `/learn`, `/tools`, `/idea`, `/manage-platform`, `/settings`). | Med — biggest LOC; split into 2 sub-PRs if reviewing slow |
| **R5** | Sweep — `grep -rn "#0d0d14\|#24243e\|rgba(255,255,255,0\.0"` should be empty outside `globals.css`. Fix stragglers. Add a lint rule (`no-restricted-syntax` for hex literals in JSX). | Low — guardrail |

Each PR ends with the same checklist: tsc clean, retry-storm clean, sentry-config clean, `npm run check:design-tokens` (added in R5) clean.

## Component primitives we should add along the way

Most surfaces re-implement the same patterns inline. Pull them into shared components — referenced by the redesign PRs rather than defined inside them:

- `<Card>` — wraps `.glass` with the right padding + border. Optional `interactive` prop for hover treatment.
- `<Stack>` and `<Inline>` — flex helpers with consistent gap.
- `<Eyebrow>` — uppercase tracked text used as section labels (already inline in several places).
- `<Pill>` — small rounded-full badge with tone variants (ok / warn / err / info).
- `<IconButton>` — square ghost button (X, kebab, etc.).
- `<Tooltip>` — uses `.glass` and the design-token type scale.

These don't ship in this ADR. They'd ship in R2 alongside the chat refactor and get reused in R3/R4.

## Risks

1. **`backdrop-filter` performance on long pages.** Mitigate by limiting to overlay surfaces (popovers, panels, modals) — never on main content scroll areas.
2. **Inter font flash on first load.** Use `font-display: swap` + system fallback that's close metrically.
3. **Existing inline styles miss the sweep.** R5 adds the lint rule so future drift is caught at PR time.
4. **Reviewer fatigue on R4.** Split that PR by directory if needed.

## Decision

Accept the rollout above. R1 is non-controversial (token definitions). R2 unlocks the rest with the lowest-risk surface as the pilot. R3–R5 are mechanical applications of the same vocabulary.

Each PR opens against a `redesign/RN-<scope>` branch and is reviewable independently. The whole pass should fit in ~2 weeks of part-time work.

## What we explicitly defer

- **Light mode.** Not a goal. Nexus is operator-only; dark is fine forever.
- **A11y audit.** Worth doing but separate scope — would gate the redesign and isn't ready.
- **Mobile.** Operator works on a 13–16" laptop. Tablet works; phone doesn't and won't.
- **Animation choreography pass.** The motion tokens land but coordinated cinematic transitions (e.g. page-to-page swipes) are not in scope.
