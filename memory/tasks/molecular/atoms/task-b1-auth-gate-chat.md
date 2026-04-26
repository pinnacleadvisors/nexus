---
type: atom
title: "B1 — Auth-gate /api/chat"
id: task-b1-auth-gate-chat
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L167
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b1]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# B1 — Auth-gate `/api/chat`

Edit `app/api/chat/route.ts` so the first line is
`const { userId } = await auth(); if (!userId) return 401`. Then call
`ratelimit(userId, '/api/chat')` with a tighter bucket (~20/min, 500/day) and
`audit.log('chat.stream', {userId, model})`.

Verify: `curl -i -X POST http://localhost:3000/api/chat` → 401; with auth cookie
returns the stream.

## Related
- [[ecosystem-b-pack]]
