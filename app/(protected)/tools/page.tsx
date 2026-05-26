/**
 * /tools — legacy redirect.
 *
 * The Toolbox surface was retired (see AGENTS.md: "The Toolbox link was
 * retired when /tools was deleted — agents now live at /settings/agents
 * and connectors at /settings/accounts"). Before this file existed,
 * navigating to /tools rendered Next.js's bare 404 page with no Nexus
 * branding or nav. Now we redirect to the agents settings — the closest
 * semantic destination for what /tools used to be (a list of available
 * agents + their tools).
 *
 * Permanent redirect (308) so external links can be silently updated.
 */
import { redirect, permanentRedirect } from 'next/navigation'

export default function ToolsLegacyRedirect(): never {
  permanentRedirect('/settings/agents')
  // unreachable; satisfies the never return type
  redirect('/settings/agents')
}
