// src-tauri/src/main.rs
// Thin entrypoint — all logic lives in lib.rs so we can unit-test it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    screenpilot_overlay_lib::run()
}
