/**
 * Command-palette registry — declarative list of commands the Ctrl+K palette
 * surfaces, grouped by intent. Pure data; the modal component (CommandPalette)
 * reads this and renders accordingly.
 *
 * Three groups, in priority order:
 *   - Navigate: jump to a route
 *   - Dispatch: invoke an agent or fire an action
 *   - Settings: theme / sign-out / dev toggles
 *
 * Dynamic commands (per-business slugs, recent issues) are injected at runtime
 * by the CommandPalette component itself — this file is the static spine.
 */

export type CommandGroup = 'navigate' | 'dispatch' | 'settings'

export interface PaletteCommand {
  id:       string
  group:    CommandGroup
  label:    string
  /** Short subtitle / hint shown on the right of the row. */
  hint?:    string
  /** When set, palette navigates here on Enter. Mutually exclusive with `run`. */
  href?:    string
  /** When set, palette calls this function on Enter. Mutually exclusive with `href`. */
  run?:     () => void | Promise<void>
  /** Keywords for the fuzzy matcher beyond the label. */
  keywords?: string[]
}

export const STATIC_COMMANDS: ReadonlyArray<PaletteCommand> = [
  // ── Navigate ─────────────────────────────────────────────────────────────
  { id: 'nav:dashboard',    group: 'navigate', label: 'Mission Control',  href: '/dashboard',       hint: 'g d' },
  { id: 'nav:inbox',        group: 'navigate', label: 'Inbox',            href: '/inbox',           hint: 'g i' },
  { id: 'nav:businesses',   group: 'navigate', label: 'Businesses',       href: '/businesses',      hint: 'g b' },
  { id: 'nav:business-new', group: 'navigate', label: 'New business',     href: '/businesses/new',  hint: 'create_business' },
  { id: 'nav:agents',       group: 'navigate', label: 'Agents',           href: '/agents',          hint: 'g a' },
  { id: 'nav:approvals',    group: 'navigate', label: 'Approvals',        href: '/approvals',       hint: 'legacy' },
  { id: 'nav:board',        group: 'navigate', label: 'Pipeline (board)', href: '/board',           hint: 'g p' },
  { id: 'nav:graph',        group: 'navigate', label: 'Knowledge graph',  href: '/graph',           hint: 'g k' },
  { id: 'nav:learn',        group: 'navigate', label: 'Learn',            href: '/learn',           hint: 'g l' },
  { id: 'nav:dev',          group: 'navigate', label: 'Dev Console',      href: '/manage-platform', hint: 'g v' },
  { id: 'nav:settings',     group: 'navigate', label: 'Settings',         href: '/settings',        hint: ', ' },
  { id: 'nav:accounts',     group: 'navigate', label: 'Connected accounts', href: '/settings/accounts', keywords: ['composio', 'oauth', 'cloudflare'] },

  // ── Dispatch ─────────────────────────────────────────────────────────────
  { id: 'dispatch:platform-copilot', group: 'dispatch', label: 'Open platform-copilot chat', href: '/manage-platform',  hint: 'chat' },
  { id: 'dispatch:signals',          group: 'dispatch', label: 'Ask: what signals do I have?', href: '/manage-platform?prompt=signals%3F', hint: 'skill: signals_briefing' },
  { id: 'dispatch:diagnose-codex',   group: 'dispatch', label: 'Diagnose codex-gateway',     href: '/manage-platform?prompt=npm+run+diagnose%3Acodex', hint: 'script' },
  { id: 'dispatch:repair-codex',     group: 'dispatch', label: 'Repair codex-gateway routing', href: '/manage-platform?prompt=npm+run+repair%3Acodex', hint: 'script' },

  // ── Settings ─────────────────────────────────────────────────────────────
  { id: 'settings:theme',    group: 'settings', label: 'Toggle theme (TODO)',   hint: 'palette: future' },
  { id: 'settings:sign-out', group: 'settings', label: 'Sign out',              href: '/sign-out' },
]

export const GROUP_LABEL: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  dispatch: 'Dispatch',
  settings: 'Settings',
}
