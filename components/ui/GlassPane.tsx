/**
 * GlassPane — canonical iOS-liquid-glass surface for Nexus panels.
 *
 * Extracted by the 2026-05-16 audit (Section 5 — Visual direction). Today
 * the platform has the look inlined in ~14 call-sites with subtle drift
 * between them (some have inset highlight, some don't; some have the
 * 24×48px soft shadow, some have a tighter 16×32px). This component
 * locks the pattern so new surfaces inherit it automatically.
 *
 * Variants:
 *   - `default` — neutral lavender wash (used on most operator panels)
 *   - `success` — green accent (Connected, KPI healthy)
 *   - `danger`  — red accent (errors, threshold breach, kill-switch active)
 *   - `info`    — light grey (skeleton, empty state, "loading…" rail)
 *
 * Sizes / shadows are intentionally NOT a prop — every pane shares the
 * same elevation. If you need a different elevation, you almost certainly
 * want a tooltip, popover, or modal — not a pane.
 *
 * Usage:
 *   <GlassPane>{children}</GlassPane>
 *   <GlassPane variant="success" as="section">{children}</GlassPane>
 *   <GlassPane className="p-4 flex gap-3">{children}</GlassPane>
 *
 * Migration target — these inline styles around the codebase ARE this
 * pane, just hand-rolled (look for `saturate(180%)` and `blur(28px)`):
 *   - components/settings/AccountList.tsx (OAuthTile, ApiKeyCard, Banner)
 *   - app/(protected)/settings/accounts/page.tsx (switcher bar, loader)
 *   - components/business-chat / platform-chat surface panels
 * Each can be swapped to <GlassPane> in a follow-up; not done in this
 * PR to keep the diff focused on the primitive itself.
 */

import { createElement, type CSSProperties, type ElementType, type ReactNode, type HTMLAttributes } from 'react'

export type GlassVariant = 'default' | 'success' | 'danger' | 'info'

interface VariantStyle {
  background: string
  border:     string
}

const VARIANT_STYLES: Record<GlassVariant, VariantStyle> = {
  default: {
    background: 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
    border:     '1px solid rgba(255,255,255,0.10)',
  },
  success: {
    background: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(255,255,255,0.02))',
    border:     '1px solid rgba(34,197,94,0.18)',
  },
  danger: {
    background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(255,255,255,0.02))',
    border:     '1px solid rgba(239,68,68,0.22)',
  },
  info: {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
    border:     '1px solid rgba(255,255,255,0.06)',
  },
}

// Shared across all variants. The shadow + inset highlight are the bits
// that make the surface feel like iOS liquid glass rather than a flat card.
const SHARED_STYLE: CSSProperties = {
  backdropFilter:       'blur(28px) saturate(180%)',
  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  borderRadius:         '16px',
  boxShadow:
    '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
}

type GlassPaneProps = {
  variant?:  GlassVariant
  /** Override the rendered tag — defaults to <div>. Use 'section' / 'article' for semantic surfaces. */
  as?:       ElementType
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'style' | 'children'> & { style?: CSSProperties }

export function GlassPane({
  variant = 'default',
  as: Tag = 'div',
  children,
  className,
  style,
  ...rest
}: GlassPaneProps) {
  const variantStyle = VARIANT_STYLES[variant]
  // createElement keeps the type loose enough for polymorphic `as` without
  // needing the full ElementRef + ComponentPropsWithoutRef generics dance.
  // For our purposes (semantic div/section/article wrapping), this is plenty.
  return createElement(
    Tag,
    {
      className,
      style: {
        ...SHARED_STYLE,
        ...variantStyle,
        ...style,    // call-site overrides win — keep escape hatch open
      },
      ...rest,
    },
    children,
  )
}

export default GlassPane
