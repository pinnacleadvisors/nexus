---
type: atom
title: "Rootless Podman sandbox for closed upskilling loop (Nexus pattern)"
id: rootless-podman-sandbox-for-closed-upskilling-loop-nexus-pattern
created: 2026-05-19
links:
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# Rootless Podman sandbox for closed upskilling loop (Nexus pattern)

services/nexus-sandbox/ — ephemeral rootless-Podman containers per /exec call. Used by skill-trainer to run candidate code in isolation: --network=none, --memory=512m, --cpus=1, --pids-limit=128, --read-only with /tmp tmpfs. Lean-mode trade-off: Compose runs privileged: true so nested user namespaces work; acceptable because one tenant = the owner. MUST swap for gVisor or Firecracker before customer code touches it.

## Related
- [[agent-framework-survey]]
