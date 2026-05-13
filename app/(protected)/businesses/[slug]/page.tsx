/**
 * /businesses/[slug] — redirects to /businesses/[slug]/chat.
 *
 * The chat is the primary day-to-day surface for a business right now
 * (every other surface — Ideas / Pipeline / Knowledge — is platform-wide).
 * Typing `/businesses/inkbound` lands you in Inkbound's chat instead of a
 * 404 or an empty placeholder page. Follow-up could replace this with a
 * proper business landing page (KPI tiles + recent run history + the chat
 * embedded) — for now the redirect keeps the URL space tidy.
 */

import { redirect } from 'next/navigation'

export default async function BusinessSlugRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/businesses/${encodeURIComponent(slug)}/chat`)
}
