# nexus-sandbox

Rootless-Podman exec sandbox. The `skill-trainer` agent (and any future
"execute untrusted code" loop) POSTs scripts here and gets back stdout /
stderr / exit_code.

## Architecture

- Base image: `quay.io/podman/stable` (Fedora + pre-configured rootless Podman)
- Runtime: pure node: builtins (no deps, no build step)
- Auth: `Authorization: Bearer ${NEXUS_SANDBOX_TOKEN}` on every `/exec` call
- Per-exec isolation: `--rm`, `--network=none` (default), `--memory=512m`,
  `--cpus=1`, `--pids-limit=128`, `--read-only`, ephemeral `/tmp` tmpfs.

## API

### `POST /exec`

```jsonc
{
  "script":     "echo hello && python -c 'print(2+2)'",
  "image":      "python:3.13-slim",     // optional, default 'alpine'
  "timeout_ms": 30000,                  // optional, default 60s, max 5min
  "network":    "none",                 // 'none' (default) | 'host'
  "env":        { "FOO": "bar" }        // optional, alphanum keys only
}
```

Response:

```jsonc
{
  "ok":               true,
  "stdout":           "hello\n4\n",
  "stderr":           "",
  "exit_code":        0,
  "killed_by_timeout": false,
  "truncated":        false,
  "duration_ms":      342,
  "sandbox_id":       "8a1b9f10-..."
}
```

stdout/stderr are ring-buffered at `SANDBOX_MAX_OUTPUT_BYTES` (default 256 KB).
`truncated: true` means the early portion of the output was discarded.

### `GET /health`

Returns `{ ok: true, service: 'nexus-sandbox' }`. Used by the Coolify
healthcheck.

## Deployment

### Coolify (recommended for lean stack)

1. Coolify → new application → Docker Compose
2. Build pack: this directory (`services/nexus-sandbox/`)
3. Required env vars (Coolify Variables):
   - `NEXUS_SANDBOX_TOKEN` — generate a 64-char random string. Same value
     goes into `nexus-app`'s env.
4. Optional env vars:
   - `SANDBOX_DEFAULT_IMAGE` (default `alpine`)
   - `SANDBOX_DEFAULT_TIMEOUT_MS` (default `60000`)
   - `SANDBOX_MAX_OUTPUT_BYTES` (default `262144`)
   - `SANDBOX_MAX_MEMORY` (default `512m`)
   - `SANDBOX_MAX_CPUS` (default `1`)
   - `SANDBOX_ALLOW_HOST_NETWORK` (default `0`) — set to `1` only when a
     specific skill needs network access. Off by default for safety.
5. Deploy. Coolify wires the `coolify` network alias automatically.

The Compose runs the container `privileged: true` so nested rootless Podman
can set up user namespaces. Lean-mode trade-off: one tenant (the owner), so
the blast radius of a sandbox escape is the host itself — same blast radius
the owner already has by SSHing in. When scale mode returns, swap for a
stricter runtime (gVisor, Firecracker) before customer code touches it.

### Host fallback (no nested containers)

If the VPS tier blocks `privileged: true` or user namespaces, run the
sandbox as a host-level service instead:

```bash
# On the KVM, as a non-root user
sudo dnf install -y nodejs podman   # or apt-get install nodejs podman
cd /opt/nexus-sandbox
NEXUS_SANDBOX_TOKEN=... node server.mjs
```

Wire it as a systemd user unit so it restarts on reboot. Then point
`NEXUS_SANDBOX_URL` at `http://<host-internal-ip>:8080` instead of the
Coolify alias.

## Smoke test

```bash
curl -s -X POST http://nexus-sandbox:8080/exec \
  -H "Authorization: Bearer $NEXUS_SANDBOX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script":"echo hello && uname -a","image":"alpine"}' \
  | jq .
```

Expect: `ok: true`, `exit_code: 0`, `stdout` contains `hello` + an `alpine` uname.

## Caller — `skill-trainer` agent

The primary caller is the [`skill-trainer`](../../.claude/agents/skill-trainer.md) managed agent. It uses this sandbox to:

1. Propose code for a competency brief
2. Execute against the sandbox
3. Grade output against success criteria
4. Retry up to 5 times until 3 consecutive passes
5. Write `SKILL.md` to `.claude/skills/<slug>/`

The full loop is documented in [`task_plan-lean-mode.md`](../../task_plan-lean-mode.md) Phase 3 (Sandbox + Upskilling Loop).

## See also

- [`lib/lean-mode.ts`](../../lib/lean-mode.ts) — lean-mode flag
- [`app/api/sandbox/exec/route.ts`](../../app/api/sandbox/exec/route.ts) — Nexus-side proxy
- [`services/lean-deploy/README.md`](../lean-deploy/README.md) — full lean stack
