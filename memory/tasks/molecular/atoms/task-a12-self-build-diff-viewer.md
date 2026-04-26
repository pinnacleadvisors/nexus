---
type: atom
title: "A12 — Self-build (Phase 19 closeout)"
id: task-a12-self-build-diff-viewer
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L157
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a12]]"
---

# A12 — Self-build (Phase 19 closeout)

New `app/(protected)/board/components/DiffViewer.tsx`, `app/api/build/diff/route.ts`,
plus edits to `components/board/ReviewModal.tsx`. When a card's artifact is a git
branch, render a unified diff in the modal with approve→merge / reject→close-branch
buttons that POST to `/api/build/diff`. Uses existing OpenClaw worktree output;
GitHub status API surfaces a CI badge on the card.

Verify: dummy branch → card shows diff → approve merges → reject re-opens.

## Related
- [[ecosystem-a-pack]]
