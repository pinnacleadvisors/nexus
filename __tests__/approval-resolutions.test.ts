/**
 * Unit test for the persistent-approval-card fix.
 *
 * Reproduces the bug deterministically: an approval that was approved in
 * history must NOT resurface as pending (the symptom: "Provision … (N items)"
 * re-appearing after approval/completion or on reload). computeApprovalResolutions
 * derives resolution from the persisted APPROVAL reply; pickPendingAction must
 * then skip it.
 *
 * Run with: `npx --yes tsx __tests__/approval-resolutions.test.ts`
 */
import { computeApprovalResolutions } from '../lib/chat/approval-resolutions'
import { pickPendingAction } from '../lib/chat/action-bar'
import type { ApprovalRequest } from '../lib/chat/approval'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

const REQ: ApprovalRequest = {
  title: 'Provision KaizenCraft business (slug: kaizencraft)',
  approval_id: 'create-business-kaizencraft-1717200000',
  items: [
    { id: '1', label: 'insert business row' },
    { id: '2', label: 'resolve manifest' },
    { id: '3', label: 'create Coolify app' },
    { id: '4', label: 'provision DNS' },
  ],
}
const asst = (req: ApprovalRequest) => ({ role: 'assistant' as const, content: '', approval_requests: [req] })
const reply = (text: string) => ({ role: 'user' as const, content: text })
const noop = new Map()

// ── computeApprovalResolutions grammar ──────────────────────────────────────
{
  const r = computeApprovalResolutions([asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: approve 1,2,3,4`)])
  const res = r.get(REQ.approval_id)
  assert(res?.approvedItemIds.join(',') === '1,2,3,4', 'approve 1,2,3,4 → all approved')
  assert(res?.deniedItemIds.length === 0, 'approve all → none denied')
}
{
  const r = computeApprovalResolutions([asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: approve all`)])
  assert(r.get(REQ.approval_id)?.approvedItemIds.join(',') === '1,2,3,4', "approve all → all four ids")
}
{
  const r = computeApprovalResolutions([asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: approve 1,2 (skip 3,4)`)])
  const res = r.get(REQ.approval_id)
  assert(res?.approvedItemIds.join(',') === '1,2', 'subset → approved 1,2')
  assert(res?.deniedItemIds.join(',') === '3,4', 'subset → skipped 3,4 derived as denied')
}
{
  const r = computeApprovalResolutions([asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: deny all`)])
  const res = r.get(REQ.approval_id)
  assert(res?.approvedItemIds.length === 0 && res?.deniedItemIds.length === 4, 'deny all → none approved, all denied')
}
{
  const r = computeApprovalResolutions([asst(REQ)])
  assert(r.get(REQ.approval_id) === undefined, 'no reply → unresolved (card stays actionable)')
}
{
  const r = computeApprovalResolutions([asst(REQ), reply('APPROVAL [some-other-id]: approve 1')])
  assert(r.get(REQ.approval_id) === undefined, 'reply for a different id does not resolve this one')
}

// ── pickPendingAction: the actual bug ───────────────────────────────────────
{
  // Unresolved → the bar should surface the approval.
  const msgs = [asst(REQ)]
  const action = pickPendingAction(msgs, noop, computeApprovalResolutions(msgs))
  assert(action?.kind === 'approval-request', 'unresolved approval IS surfaced as pending')
}
{
  // RELOAD scenario: history has the APPROVAL reply but no ephemeral
  // message.approval_resolutions (lost on reload). BEFORE the fix this returned
  // the approval (bug); AFTER, the derived map resolves it → null.
  const msgs = [asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: approve 1,2,3,4`)]
  const action = pickPendingAction(msgs, noop, computeApprovalResolutions(msgs))
  assert(action === null, 'approved-in-history approval does NOT resurface after reload')
}
{
  // RE-EMIT scenario: the agent emits the same approval block again in a later
  // turn (after completion). The derived map (keyed by approval_id) still marks
  // it resolved, so the re-emitted card is not actionable.
  const msgs = [asst(REQ), reply(`APPROVAL [${REQ.approval_id}]: approve all`), asst(REQ)]
  const action = pickPendingAction(msgs, noop, computeApprovalResolutions(msgs))
  assert(action === null, 're-emitted approval after completion does NOT resurface')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
