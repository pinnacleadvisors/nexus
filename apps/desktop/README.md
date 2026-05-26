# Nexus desktop shell (Tauri)

Native macOS / Windows / Linux installers wrapping the Nexus webapp.
Phase 6 of [`task_plan-desktop-app.md`](../../task_plan-desktop-app.md).

## Why a native shell on top of the PWA

The PWA install (Phase 1, [PR #379](https://github.com/pinnacleadvisors/nexus/pull/379)) already gives a "desktop app" feel from any modern browser — install button in the URL bar, no browser chrome, dock icon. Tauri is the upgrade path when:

- You want a `.dmg` / `.msi` / `.AppImage` operator can double-click
- You want a code-signed binary distributed via Homebrew tap / Chocolatey / Flatpak
- You want native menu bar items, system tray, OS notifications, deep links

If you're happy with the PWA you do **not** need to build the Tauri shell. Both paths coexist; pick per-deployment.

## Architecture (intentionally minimal)

Tauri wraps a single URL in a native window. v1 hardcodes `https://nexus.coolifycloudtunnel.uk` in `tauri.conf.json`. Future v2 reads from a per-OS config file so the operator can switch local ↔ remote without rebuild.

No custom Rust commands. Permission surface = `core:default`. Everything happens in the webview.

## Prerequisites

You need the standard Tauri 2.0 toolchain on the build host. **None of this is needed on the install host** — the operator just downloads the binary.

| OS | One-time setup |
|---|---|
| macOS | `xcode-select --install && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Windows | Install Visual Studio C++ build tools + `rustup-init.exe` |
| Linux | `apt install libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev` + rustup |

Then in this directory:
```bash
npm install
```

## Develop

```bash
# Bring up Next.js in another terminal first
cd ../../ && npm run dev      # http://localhost:3000

# Then launch the Tauri dev shell (auto-reloads when Rust changes)
cd apps/desktop && npm run dev
```

By default `devUrl` in `tauri.conf.json` points at `http://localhost:3000`. Change it temporarily if you want the dev shell to wrap the Coolify deployment instead.

## Build a release binary

```bash
cd apps/desktop
npm run build          # outputs to src-tauri/target/release/bundle/
```

| Platform | Artefacts |
|---|---|
| macOS | `Nexus_0.1.0_aarch64.dmg` or `Nexus_0.1.0_x64.dmg` |
| Windows | `Nexus_0.1.0_x64-setup.exe` (NSIS) or `.msi` |
| Linux | `nexus-desktop_0.1.0_amd64.deb` + `.AppImage` |

Icons must be in `src-tauri/icons/` — see "Icons" below. The release binary is fully self-contained; no Rust toolchain on the operator's machine.

## CI / GitHub release pipeline

`.github/workflows/desktop-release.yml` builds binaries for all three platforms on every git tag matching `desktop-v*`. The workflow uses [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action). Each successful build uploads installers to a GitHub Release.

To cut a release:
```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

The release stays draft until you add release notes + publish.

## Icons (operator-side one-time setup)

Tauri needs platform-specific icon files in `src-tauri/icons/`. I haven't committed binaries to keep the repo clean. Use one of:

```bash
# Option A — Tauri's own icon generator (recommended)
cd apps/desktop/src-tauri
npx @tauri-apps/cli icon ../../../public/icon.svg

# Option B — Manual: convert the SVG to PNG at 32 / 128 / 256 / 512
# then generate .icns (macOS) and .ico (Windows) with png2icns + ImageMagick
```

This is intentionally a one-shot operator action — committing binary icons to the repo means every PR diff includes them. The `desktop-release.yml` workflow runs `tauri icon` as a build step so CI doesn't need them committed.

## URL configuration (future v2)

The plan: read `~/.config/nexus/url.txt` (Linux), `%APPDATA%/Nexus/url.txt` (Windows), `~/Library/Application Support/Nexus/url.txt` (macOS) at boot and use that URL instead of the hardcoded `tauri.conf.json` value. Falls back to the conf default when absent.

Not implemented in v1 — operator can edit `tauri.conf.json` + rebuild for now. File an issue via the **Nexus dev team** radio on `/issues` and `platform-dev-loop` will draft the patch.

## Switching between local and Coolify

While the URL-config feature is pending, the cleanest pattern is to build **two desktop bundles** with different `tauri.conf.json` `url:` values:

```bash
# Coolify build (production)
git tag desktop-v0.1.0-coolify && git push origin desktop-v0.1.0-coolify

# Local build (dev)
sed -i.bak 's|nexus.coolifycloudtunnel.uk|localhost:3000|' src-tauri/tauri.conf.json
npm run build
mv src-tauri/target/release/bundle/*.dmg ~/Desktop/Nexus-local.dmg
git checkout src-tauri/tauri.conf.json
```

The PWA path (https://… AND http://localhost:3000 installed separately) is friction-free here — recommended unless you specifically need the .dmg/.msi distribution.

## Known limitations (v1)

- No deep links (registered URL handlers for `nexus://...`) — adding requires per-platform Info.plist / manifest tweaks.
- No native menu bar — webview uses the OS chrome only.
- No system-tray icon — keeps the install surface tiny; can be added in v2.
- No auto-updater — Tauri supports it via `tauri-plugin-updater` but needs a signing key + update server URL; deferred until operator wants it.
- macOS Gatekeeper will warn on first launch since the binary isn't notarised. Sign + notarise in the GitHub workflow when the operator has an Apple Developer account.

## Status

✅ Phase 1 — PWA install (PR #379)
✅ Phase 2 — LOCAL_MODE conditional code (PR #382)
✅ Phase 3 — docker-compose.local + bootstrap (PR #384)
✅ Phase 5 — export/import primitive (PR #385)
🟡 Phase 6 — Tauri shell scaffold (this PR — scaffolding ships; first binary release pending operator running the icon generator)
⬜ Phase 4 — node-cron sidecar (LOCAL_MODE cron primitive)
