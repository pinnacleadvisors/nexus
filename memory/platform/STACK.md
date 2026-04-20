# Nexus — Stack Rules

> All rules enforced at review. Violations cause TypeScript errors or runtime failures.

## Next.js 16 (App Router)

- Pages → `app/` (App Router only — no `pages/` directory)
- Protected pages → `app/(protected)/` (route group, invisible in URLs)
- Middleware → `proxy.ts` (NOT `middleware.ts` — do not rename)
- `'use client'` required on any component using hooks, event handlers, or browser APIs
- `ssr: false` with `next/dynamic` only valid inside Client Components

## Tailwind CSS 4

- Design tokens → `app/globals.css` inside `@theme inline { }` (no `tailwind.config.js`)
- First line of globals.css: `@import "tailwindcss"` (already set — don't remove)

## TypeScript

- All shared types → `lib/types.ts` (never inline in components)
- Run `npx tsc --noEmit` before every commit

## Client / Server Component Boundary

| Uses | Directive needed |
|------|-----------------|
| `onClick`, `onChange`, `useState`, `useEffect`, `onMouseEnter` | `'use client'` |
| `next/dynamic({ ssr: false })` | `'use client'` (cannot use in Server Components) |
| `recharts` `ResponsiveContainer` | `'use client'` + `dynamic(..., { ssr: false })` |

## AI SDK (Vercel AI SDK 6)

- `useChat` hook → `@ai-sdk/react` (NOT `ai`)
- `streamText`, `convertToModelMessages`, `DefaultChatTransport` → `ai`
- API routes: `streamText` → `result.toUIMessageStreamResponse()`
- Model: `anthropic('claude-sonnet-4-6')` via `@ai-sdk/anthropic`
- Strategic advisor: Opus; implementation: Sonnet; fast scoring: Haiku

## Icons (lucide-react)

- `Github` → removed; use `GitBranch`
- `Trello` → removed; use `Kanban`
- Always verify: `node -e "const l=require('./node_modules/lucide-react'); console.log('IconName' in l)"`

## Pre-commit Checklist

- [ ] `npx tsc --noEmit` passes (zero errors)
- [ ] All interactive components have `'use client'`
- [ ] No browser globals (`window`, `document`) in Server Components
- [ ] Icons verified to exist in lucide-react
- [ ] No secrets committed (`git diff --staged` — check for keys/tokens)
- [ ] `ROADMAP.md` updated if a feature was completed or added
