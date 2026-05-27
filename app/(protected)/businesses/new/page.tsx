/**
 * /businesses/new — multi-step wizard for creating a new business.
 *
 * H2 from session 2026-05-27. Replaces the redirect-to-chat behaviour with
 * a structured form per operator request. Lands as a simulated business
 * (simulation=true) by default — graduate to production from
 * /businesses/<slug> once the pre-flight checklist passes.
 *
 * Falls back to the chat-driven flow via a link at the bottom of the wizard
 * for operators who want the open-ended consultation experience.
 */

import BusinessWizard from '@/components/business-wizard/BusinessWizard'

export const dynamic = 'force-dynamic'

export default function NewBusinessPage() {
  return <BusinessWizard />
}
