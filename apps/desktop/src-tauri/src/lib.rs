// Nexus desktop shell — Tauri 2.0 entrypoint.
//
// v1 ships an absolute-minimum Tauri app that wraps the URL configured
// in `tauri.conf.json` (default: https://nexus.coolifycloudtunnel.uk).
// All real work happens in the Next.js frontend served at that URL —
// Tauri's only job is to give it a native window + dock icon + the
// ability to bundle as a signed installer per platform.
//
// Future v2 — load the URL from a config file under
// `~/Library/Application Support/Nexus/url.txt` (macOS),
// `%APPDATA%/Nexus/url.txt` (Windows), `~/.config/nexus/url.txt`
// (Linux) so the operator can switch between local / Coolify /
// staging without a rebuild. For now hardcoded in tauri.conf.json.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                eprintln!("[nexus-desktop] launched in debug build");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nexus-desktop");
}
