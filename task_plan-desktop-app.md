# Nexus desktop app + local-first deployment plan

> **Operator's goal**: "I want this to be a desktop application installable on macOS, Windows, or Linux. Similar to Claude Code. So that I or future users can download this on any virtual machine, and start using it. Future: self-host backend in a container too. Flexibility to choose VMs, or freeze usage with export/import. Prioritise open-source projects that can host locally."

## North Star

Operator can run Nexus as a self-hosted personal OS on one machine (Mac mini, home server, laptop), with full feature parity to the Coolify-hosted version, zero vendor lock-in, one-click install. Optional remote Coolify host stays as the multi-device / mobile-access path.

## Success criteria

- [ ] Installable from a single command on macOS / Windows / Linux (Homebrew on macOS, scoop/winget on Windows, deb/AUR/Flatpak on Linux — at least one per platform).
- [ ] Runs entirely locally with **zero cloud dependencies** when `LOCAL_MODE=1`:
  - Local Postgres (Docker compose OR Postgres.app on macOS)
  - Local LLM via Ollama (already wired in `lib/llm/provider.ts`)
  - Local cron via `node-cron` (in-process) — no cron-job.org needed
  - No Clerk auth — single-user passwordless localhost
  - No Composio — direct API keys per integration in a local `~/.nexus/secrets.json`
- [ ] **Export-import** primitive: `nexus export > nexus-2026-05-26.tar.gz` packages Supabase dump + uploaded files + secrets metadata (NOT raw secrets). Restore on another machine: `nexus import nexus-2026-05-26.tar.gz`.
- [ ] **Hybrid mode**: operator can run UI locally + still hit remote Coolify backend by setting `NEXUS_BASE_URL=https://nexus.coolifycloudtunnel.uk` — desktop becomes a thin client.

## Hard constraints

- **No regression to the current Coolify deployment.** The existing prod stack stays operational throughout the migration. `LOCAL_MODE` is purely additive.
- **One codebase.** No fork. The desktop binary bundles the same Next.js app, just configured for local-first runtime. Open-source contributors maintain ONE thing.
- **Provider-agnostic LLM stays the rule.** `LLM_PROVIDER=ollama` should "just work" for local-first; `LLM_PROVIDER=claude` for cloud — same code path, swap one env var (already enforced by `check:provider-agnostic`).
- **No secrets in the binary.** Doppler stays the canonical secret store for cloud. Local mode reads from `~/.nexus/secrets.json` which the operator writes directly (or Doppler CLI fetches into it). The desktop binary itself ships zero secrets.

## Recommended architecture (the cleanest path)

I weighed four options. Recommendation in **bold**.

| Option | Pros | Cons | When |
|---|---|---|---|
| Tauri (Rust + webview) | Native binaries ~10 MB, auto-updater, modern | Rust toolchain for builds, learning curve | Best long-term; phase 5+ |
| Electron | Battle-tested, TS-native | 100 MB+ binaries, resource-heavy | If Tauri proves too thin |
| **PWA (this PR)** | **Installable on macOS / Windows / Linux / iOS / Android via the browser's "Install" action. Zero new build tech. Ships in days.** | **Still requires a browser engine; no native menus** | **Phase 1 — ship NOW; covers 80% of "feels like a desktop app"** |
| Plain web + Docker | Simplest; no wrapper | "Install" UX is `docker compose up` | Always available as fallback |

The cleanest path is **PWA now + Docker self-host parallel + Tauri later**. Each phase ships independently; no phase is wasted work because the PWA + Docker compose pieces are reused by Tauri.

## Phased migration

### Phase 1 — PWA + manifest (THIS PR)

- `public/manifest.webmanifest` — declares Nexus as a PWA
- `app/icon.tsx` + `public/icon.svg` — multi-size icons via Next.js metadata
- `public/sw.js` — minimal service worker (cache static assets + offline-fallback page)
- `components/pwa/ServiceWorkerRegister.tsx` — registers SW on mount
- `app/layout.tsx` — adds `<link rel="manifest">` + Apple-touch-icon
- After deploy, Chrome / Safari / Edge / Firefox show an "Install" button in the URL bar. Operator installs and gets a "desktop app" icon in their dock with no other tech.

### Phase 2 — LOCAL_MODE env flag (next PR)

- `lib/platform/local-mode.ts` — `isLocalMode()`, `localSecretsPath()`, `localDbUrl()` helpers
- Skip Clerk middleware when `LOCAL_MODE=1`; treat all traffic as the local operator
- Skip Composio in `executeBusinessAction()` when LOCAL_MODE — fall through to direct API keys from `~/.nexus/secrets.json`
- Tag every cost-guard call with `localMode: true` so spend tracking still works without Stripe attribution

### Phase 3 — Docker compose for self-host

- `docker-compose.local.yaml` — three services: `app` (nexus), `db` (postgres:16), `ollama` (ai/ollama)
- `scripts/local-install.sh` — one-command bootstrap: clones repo, copies `.env.local.example` → `.env`, runs `docker compose up -d`, opens browser to localhost:3000
- README section: "Install Nexus on macOS / Windows / Linux"

### Phase 4 — Local-cron sidecar

- Replace cron-job.org dependency in LOCAL_MODE with `node-cron` running in a sidecar process inside the compose stack
- Reads cron config from `vercel.json` (existing source of truth)
- Operator can disable individual crons via `~/.nexus/disabled-crons.json`

### Phase 5 — Export-import primitive

- `POST /api/admin/export` — operator-only; returns tar.gz of (a) Postgres dump via pg_dump, (b) `~/.nexus/uploads/` blob store, (c) `~/.nexus/secrets.json.encrypted` (encrypted with operator passphrase)
- `POST /api/admin/import` — accepts the tar.gz, restores DB + blobs + decrypts secrets
- CLI helpers: `nexus export > foo.tar.gz` and `nexus import foo.tar.gz`

### Phase 6 — Tauri wrapper ✅ (PR #387 — scaffolding shipped)

- `apps/desktop/` — Tauri 2.0 shell wrapping a configurable URL (default `https://nexus.coolifycloudtunnel.uk`).
- `apps/desktop/src-tauri/{Cargo.toml, tauri.conf.json, src/{main.rs, lib.rs}}` — minimal Rust entrypoint, no custom commands.
- `apps/desktop/README.md` — develop / build / icons / known limits documented.
- `.github/workflows/desktop-release.yml` — builds binaries for macOS (universal), Windows (x64), Linux (amd64) on every `desktop-v*` tag. Drafts a GitHub release with installer artefacts.
- Operator action: run `npx @tauri-apps/cli icon ../../public/icon.svg` once locally OR rely on the release workflow's icon-gen step.

Future v2 (deferred):
- Auto-updater via `tauri-plugin-updater` (needs a signing key + update server)
- Per-OS URL config file (`~/.config/nexus/url.txt` etc) so the operator can switch local ↔ Coolify without rebuild
- Code signing + notarisation (Apple Developer / Microsoft cert)
- App-store distribution: brew tap / scoop / AUR / Flatpak

## Open-source local-first stack choices

Prioritising open-source per operator's brief:

| Concern | Recommended | Why |
|---|---|---|
| Database | **Postgres 16** (open source) | Same engine as Supabase; zero schema differences |
| LLM | **Ollama** (open source) | Already wired (`LLM_PROVIDER=ollama`). Supports Llama 3.3 / Qwen / Mixtral. |
| OAuth → API keys | **Direct API keys in `~/.nexus/secrets.json`** (no broker) | Skip Composio for local; operator manages keys themselves |
| Cron scheduler | **`node-cron`** (npm, MIT) sidecar | Tiny, in-process. Alternative: **Temporal** (open source) if multi-step workflows grow |
| File storage | **Local filesystem** under `~/.nexus/uploads/` | Mirrors the R2 / S3 keys without the cloud bill |
| Secret store | **Operator-managed** `~/.nexus/secrets.json` | Or run a local `doppler-broker` shim that reads from sops-encrypted yaml |
| Auth | **No auth** (single-user localhost) OR **passwordless via passkeys** | Clerk is overkill for personal-OS mode |
| Telemetry | **Plausible** (self-hosted) — optional | Skip Sentry / PostHog for local |

## Hybrid usage pattern (operator's stated future)

The operator wants flexibility to switch between local + Coolify + phone access. The PWA design makes this trivial:

- **Local-only desktop**: install the PWA from `http://localhost:3000`, run the stack via docker-compose
- **Coolify-only mobile**: install the PWA from `https://nexus.coolifycloudtunnel.uk`, full feature parity
- **Hybrid**: install BOTH PWAs (browsers treat them as separate apps); operator uses local for dev / Coolify for mobile

Migrating from local → Coolify is `nexus export > foo.tar.gz` → upload to Coolify → `nexus import foo.tar.gz`. Vice-versa works the same.

## What this PR ships (Phase 1)

1. PWA manifest + icons + service worker + register component → installable from any modern browser, immediately.
2. This task_plan doc as the canonical reference for the rest of the migration.
3. `lib/platform/local-mode.ts` stub — the env flag scaffold so future PRs have a single helper to call.

Phases 2-6 are separate PRs the operator can opt into when ready.

## Progress
### Completed
- [x] North Star + architecture options weighed
- [x] Phase 1 — PWA shipping in this PR
- [x] LOCAL_MODE env flag stub

### Remaining (future PRs)
- [x] Phase 2 — LOCAL_MODE conditional code paths (PR #382)
- [x] Phase 3 — docker-compose.local.yaml + scripts/local-install.sh (PR #384)
- [ ] Phase 4 — node-cron sidecar (replaces cron-job.org for LOCAL_MODE)
- [x] Phase 5 — export-import primitive (PR #385)
- [x] Phase 6 — Tauri wrapper scaffolding (PR #387 — first binary release pending operator running icon generator)

### Open questions
- Should LOCAL_MODE single-user share user_id with the Coolify deployment for seamless export/import, or use a sentinel local-only id? My take: sentinel `local-operator` + export-rewrite-user-id pass on import. Cleaner audit trail.
- Should we mirror the per-business sandbox containers in local mode, or collapse to one big stack? My take: one big stack for v1; per-business optional behind a flag once the workload demands it.
