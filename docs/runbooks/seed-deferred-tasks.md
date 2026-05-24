# Seeding deferred-audit tasks into the Nexus platform

When the operator wants the deferred-audit backlog (from
`task_plan-this-week.md` Part 1 + similar audit runs) visible in the
**Manual to-dos** Views panel, run the seed script. Re-runnable;
already-present tasks are skipped.

## One-time setup

Doppler must contain the Supabase service-role key (already present per
`memory/platform/SECRETS.md`).

## Run it

```bash
# Find your Clerk user_id first:
#   clerk.com → Users → click yourself → copy the user_xxxxxxxx string

# Dry-run preview (nothing written):
doppler run -- node scripts/seed-deferred-tasks.mjs --user-id=user_xxxxxxxxx --dry-run

# Actual run:
doppler run -- node scripts/seed-deferred-tasks.mjs --user-id=user_xxxxxxxxx

# OR shorter (via npm script):
SEED_USER_ID=user_xxxxxxxxx npm run seed:deferred-tasks
```

Output is `seeded` / `skipped (exists, done=X)` / `failed` per row.

## What lands

20+ rows in `operator_tasks` with `scope='admin'` covering:

- **hygiene** — `withGuards` wrapper, husky secret-scan, rate-limit audit, skill-promote UI, orphan-atom re-push
- **strategic** — debug-loop-oss T1, Paperclip Phase 2-4, chat-views V2-V4, codex-debug-loop Phase 2-4
- **not-started** — learning-system, user-tester-panel, thai-sales-agency
- **operator-env** — autonomous-qa rollout, execution-overhaul pilot, lean-mode config, solopreneur Phase 3 approval
- **follow-up** — edit-self block client-wiring (Group D v2)

Open `/manage-platform` → Views dropdown → **Manual to-dos** to see them.

## Cross-agent context

Once seeded, ANY agent that calls `listTasks(userId, 'admin')` from
[`lib/views/tasks.ts`](../../lib/views/tasks.ts) sees these rows with
their `done` status. This is the cross-session memory the operator
asked for — mark a row done, and the next agent session knows it's
been completed without needing to be told.

Agents can also emit `manual-task-complete` blocks referencing one of
these titles (case-insensitive title match per
[`lib/views/tasks.ts findOpenTaskByTitle`](../../lib/views/tasks.ts))
to flip a row to done automatically when they verify it's complete.

## Editing the backlog

The backlog lives at the top of [`scripts/seed-deferred-tasks.mjs`](../../scripts/seed-deferred-tasks.mjs) in
the `BACKLOG` array. Add / edit there; re-run; new items get inserted,
existing ones stay untouched. Categories live in the title prefix
(`[hygiene]`, `[strategic]`, `[new]`, `[operator]`, `[follow-up]`) so
the TasksView visually groups them without a schema change.

## Removing all seeded tasks

Manually via Supabase SQL — the script doesn't have a delete path.

```sql
delete from operator_tasks
where user_id = 'user_xxxxxxxxx'
  and scope   = 'admin'
  and source  = 'operator'
  and (
    title like '[hygiene] %'
    OR title like '[strategic] %'
    OR title like '[new] %'
    OR title like '[operator] %'
    OR title like '[follow-up] %'
  );
```
