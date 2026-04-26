---
type: atom
title: "A10 — Publish/distribute step"
id: task-a10-publish-distribute
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L145
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a10]]"
  - "[[oq-ecosystem-publish-app-review]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A10 — Publish/distribute step

New `lib/publish/{tiktok,instagram,youtube}.ts` provider abstraction plus
`app/api/publish/route.ts`. Implement YouTube Shorts end-to-end first (least
friction, documented quota); stub the other two with clear "not implemented"
errors. `publish(asset)` returns `{externalId, postedAt}`; the published ID is
written back onto the Run so the measure phase can poll.

Verify: dev-token publish to a test channel returns external URL.

Human-gated: requires real API keys + owner approval before building.

## Related
- [[ecosystem-a-pack]]
