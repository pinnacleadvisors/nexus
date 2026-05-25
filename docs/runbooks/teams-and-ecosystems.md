# Teams + Ecosystems — operator runbook

> Architecture: [task_plan-departments-and-ecosystems.md](../../task_plan-departments-and-ecosystems.md)
> Quick reference: [AGENTS.md → Departments + ecosystem-agnostic teams](../../AGENTS.md#departments--ecosystem-agnostic-teams)

A **team** is a department instance for one business. A **department** is a named bundle of role specs + approval gates. An **ecosystem adapter** is the swappable backend (Higgsfield for video, Open Code for code, GBrain for memory, …) the roles call when they need a capability.

## Spawn a department

1. Open `/teams`.
2. Find the business's section. Click **Add department**.
3. Pick from the 7 starter departments. The spawn pre-fills the right ecosystem bindings based on the business's `niche` (per [`lib/teams/default-bindings.ts`](../../lib/teams/default-bindings.ts)).
4. New team lands at `status: 'active'` with its full member roster inserted into `team_members`.

Defaults you can change later:
- Per-niche `video` adapter (e.g. `saas` defaults to `runway`, everyone else to `higgsfield`).
- Per-niche `design`, `code`, `memory` adapters.
- Operator-supplied overrides via the rebind UI (below).

## Rebind an ecosystem

Click the chip on a team card (e.g. `video: higgsfield`). A dropdown of every adapter with the same `kind` appears. Pick a different one (e.g. `runway`) and the binding swaps immediately.

Behind the scenes the UI sends a `PATCH /api/teams/:id` with the FULL bindings map — sparse patches aren't supported because two operators rebinding at once would step on each other otherwise.

Adapters labelled `(unwired)` in the dropdown have no env vars set — picking one is legal (the abstraction stays valid), but the next dispatch returns `error: 'unavailable'` until you configure the env. The role agent surfaces that as a `manual-task` block in the chat with the exact env vars to set.

## Pause / resume

Click the `…` button on a team card → **Pause**. Status flips to `paused`; no dispatches fire. **Resume** flips it back to `active`.

Use this when:
- The team's outputs are creating noise the operator doesn't want this week.
- An ecosystem rebind is in flight and you want to freeze the team mid-cycle.
- The business is on a temporary hold (vacation, contractual gap, infra incident).

## Archive

`…` → **Archive**. Sets `status: 'archived'` — the team becomes read-only. Used when the dept is genuinely done (or you want a clean replacement). Archived teams stay in the DB for audit; no auto-delete.

## Add a new adapter

When a better vendor ships in a known capability class (e.g. "Veo is better than Higgsfield for our niche"):

1. Write the adapter at `lib/ecosystems/adapters/<name>.ts` implementing the `EcosystemAdapter` interface from [`lib/ecosystems/types.ts`](../../lib/ecosystems/types.ts).
2. Import it in [`lib/ecosystems/registry.ts`](../../lib/ecosystems/registry.ts) and add to `ALL_ADAPTERS`.
3. (Optional) Update [`lib/teams/default-bindings.ts`](../../lib/teams/default-bindings.ts) if it should be a new default for any niche.
4. (Optional) Add env vars to [`memory/platform/SECRETS.md`](../../memory/platform/SECRETS.md). Adapter's `available()` MUST report truthfully whether the env is set.
5. Existing teams continue to work — they're not touched. New spawns get the new default if you updated step 3; existing teams can rebind via the UI.

No department or role spec needs to change.

## Add a new capability class

Rare. When a new ecosystem kind is invented (e.g. `3d-render` for Blender / Tripo / Meshy):

1. Add the literal to `EcosystemKind` in [`lib/ecosystems/types.ts`](../../lib/ecosystems/types.ts).
2. Add a default for the kind in `DEFAULT_BINDINGS` at [`lib/teams/default-bindings.ts`](../../lib/teams/default-bindings.ts).
3. Departments that need it list it in their `defaultEcosystemKinds`.
4. At least one adapter of the new kind must exist before any dept binds it.

## Add a new department

Two paths:

**Starter-template (compile-time)** — add a row to `DEPARTMENTS` in [`lib/teams/departments.ts`](../../lib/teams/departments.ts). Write a `_department.md` spec, write a lead at `<dept>-lead.md`, write each role spec. Ships with the next PR.

**Custom (runtime)** — the future plan in [task_plan-departments-and-ecosystems.md](../../task_plan-departments-and-ecosystems.md) (Part 4). Operator creates a custom dept from the UI; no PR needed. Not in v1 / v2 yet.

## Add a new role to an existing department

1. Append the role slug to the dept's `roles` array in `DEPARTMENTS`.
2. Write the role spec at `.claude/agents/departments/<dept>/<role>.md` — fork [`_role-template.md`](../../.claude/agents/departments/_role-template.md).
3. Re-spawning a team picks the new role up automatically (the spawn helper iterates `dept.roles`). Existing teams: re-spawn or add the row manually to `team_members`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Spawn returns "team not found or update failed" | DB upstream blip | Retry. Route is 200-on-failure, retry-storm-safe — no infinite loop. |
| Spawn fails on unique constraint | Dept already spawned for this business | Use the existing team. v1 doesn't allow duplicate depts per business. |
| Rebind chip's dropdown is empty | No adapter is registered for that kind | Add one per "Add a new adapter" above. |
| Adapter shows `(unwired)` after a rebind | Adapter's `available()` returns false because its env vars aren't set | Configure the env var in Doppler. The chat will surface a `manual-task` block telling the operator exactly which env vars to set. |
| Paused team somehow still dispatches | Some agent dispatch path doesn't check status yet | File a bug — every dispatch SHOULD `select status from teams where id=...` and short-circuit on `paused`/`archived`. v2 added the field but not all callers honour it yet. |

## Related runbooks

- Per-business container provisioning: [per-business-container-rollout.md](per-business-container-rollout.md)
- Shared Stripe/Vercel attribution: [shared-stripe-vercel.md](shared-stripe-vercel.md)
- Cross-repo git protocols: [git-multi-agent-collaboration.md](git-multi-agent-collaboration.md)
