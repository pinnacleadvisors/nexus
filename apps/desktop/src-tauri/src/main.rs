// Prevents an extra blank console window on Windows release builds.
// On macOS/Linux this attribute is a no-op.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexus_desktop_lib::run()
}
