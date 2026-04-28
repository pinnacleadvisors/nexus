---
type: atom
title: "Coolify image tag plus build causes pull attempt"
id: coolify-image-tag-plus-build-causes-pull-attempt
created: 2026-04-28
sources:
  - services/claude-gateway/docker-compose.yaml
links:
  - "[[coolify]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Coolify image tag plus build causes pull attempt

Declaring both 'build:' and 'image:' on a service in docker-compose.yaml causes Docker Compose (via Coolify) to first attempt 'docker pull' against the image tag. If the tag is local-only ('nexus/claude-gateway:latest'), the pull fails with 'pull access denied', aborting the deploy before build runs. Fix: drop the image tag entirely (build alone is enough) or set 'pull_policy: build' to skip the pull.

## Related
- [[coolify]]
