# .githooks

Repo-tracked git hooks. Enable per-clone (and per-worktree) with **one command**:

```bash
git config core.hooksPath .githooks
```

Verify:

```bash
git config --get core.hooksPath
# → .githooks
```

## Active hooks

| Hook | What it does |
|---|---|
| [`pre-push`](pre-push) | Blocks pushes to a branch whose PR has already MERGED. Prevents stranded-commit bugs. See [`docs/runbooks/git-multi-agent-collaboration.md`](../docs/runbooks/git-multi-agent-collaboration.md). |

## Bypass

Genuine emergencies only:

```bash
git push --no-verify
```

If you find yourself reaching for `--no-verify` because the hook keeps flagging stranded commits, fix the underlying branch lifecycle instead — cherry-pick to a fresh branch off main. Bypassing the guard re-creates the failure mode it exists to prevent.

## Why hooks here (not Husky)

Husky requires `npm install` to wire hooks. Using `core.hooksPath` is a one-command setup with zero new dependencies, and the hooks are versioned alongside the code that depends on them. The trade-off: every clone needs the one-time `git config core.hooksPath .githooks` — added to the project setup checklist.

## CI parity

Hooks are local-only; CI does NOT enforce these. The reasoning: hooks catch mistakes early at the dev workstation, where the fix is cheap. CI enforces the harder rules (typecheck, retry-storm, CodeQL). If a stranded-commit slips past the local hook, the merged-PR check in [`/api/...`] catches it at PR-open time via the GitHub-side "branch is gone, the PR auto-closes" behaviour (once `auto-delete branches on merge` is enabled — see the runbook).
