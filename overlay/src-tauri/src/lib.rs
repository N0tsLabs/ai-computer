// src-tauri/src/lib.rs
//
// screenpilot-overlay — translucent, click-through, always-on-top overlay.
//
// Spans ALL connected monitors: one transparent webview window per display,
// each pinned to that monitor's bounds, all driven by the same stdin event
// stream. The first ("main") window is declared in tauri.conf.json; extra
// monitors get programmatically-built siblings labelled "monitor-N".

use std::io::{self, BufRead, Write};
use std::sync::{Mutex, OnceLock};
use std::thread;

use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

static APP_HANDLE: OnceLock<Mutex<Option<tauri::AppHandle>>> = OnceLock::new();

fn store_handle(h: tauri::AppHandle) {
    let cell = APP_HANDLE.get_or_init(|| Mutex::new(None));
    *cell.lock().unwrap() = Some(h);
}
fn get_handle() -> Option<tauri::AppHandle> {
    APP_HANDLE.get()?.lock().ok()?.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(build_global_esc_plugin())
        .setup(|app| {
            store_handle(app.handle().clone());

            // Configure the main window (covers the primary monitor) and
            // spawn extra windows for every other monitor.
            let main = app.get_webview_window("main")
                .ok_or("main webview window missing from config")?;
            let monitors = main.available_monitors().unwrap_or_default();
            eprintln!("[overlay] detected {} monitor(s)", monitors.len());

            for (i, m) in monitors.iter().enumerate() {
                let pos: PhysicalPosition<i32> = *m.position();
                let size: PhysicalSize<u32> = *m.size();
                eprintln!(
                    "[overlay] monitor #{i}: {}x{} at ({}, {}) scale={}",
                    size.width, size.height, pos.x, pos.y, m.scale_factor()
                );

                if i == 0 {
                    configure_overlay_window(&main, pos, size)?;
                } else {
                    // Build a fresh transparent webview pinned to monitor i.
                    let label = format!("monitor-{i}");
                    let win = WebviewWindowBuilder::new(
                        app.handle(),
                        label,
                        WebviewUrl::App("index.html".into()),
                    )
                    .title("screenpilot overlay")
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .visible(false)            // show after sizing
                    .shadow(false)
                    .focused(false)
                    .build()?;
                    configure_overlay_window(&win, pos, size)?;
                }
            }

            spawn_stdin_watcher();
            stdout_event("ready", "{}");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                stdout_event("exiting", "{}");
                let _ = window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![label_text, user_abort])
        .run(tauri::generate_context!())
        .expect("error while running screenpilot-overlay");
}

#[tauri::command]
fn label_text() -> String {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .unwrap_or_else(|| "AI 接管中".to_string())
}

#[tauri::command]
fn user_abort() {
    stdout_event("aborted", r#"{"by":"user"}"#);
    if let Some(h) = get_handle() {
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(80));
            stdout_event("exiting", "{}");
            let _ = h.exit(0);
        });
    }
}

fn configure_overlay_window(
    win: &WebviewWindow,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), Box<dyn std::error::Error>> {
    let _ = win.set_position(pos);
    let _ = win.set_size(size);
    let _ = win.set_decorations(false);
    let _ = win.set_resizable(false);
    let _ = win.set_always_on_top(true);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.show();

    // Inject this window's physical-pixel viewport so the WebView can map
    // incoming desktop coordinates → local CSS pixels without relying on
    // `window.screenX/screenY`, which Chromium reports in DPI-scaled logical
    // pixels and is unreliable across multi-DPI monitor setups.
    let scale = win.scale_factor().unwrap_or(1.0);
    let init_script = format!(
        "window.__SP_VIEWPORT__ = {{ x:{}, y:{}, w:{}, h:{}, scale:{} }};",
        pos.x, pos.y, size.width, size.height, scale
    );
    let _ = win.eval(&init_script);

    eprintln!(
        "[overlay] '{}' visible={} at ({}, {}) size {}x{} scale={}",
        win.label(),
        win.is_visible().unwrap_or(false),
        pos.x, pos.y, size.width, size.height, scale
    );
    Ok(())
}

/// Receive JSON-per-line events from the parent and broadcast each to
/// every overlay window's WebView.
fn spawn_stdin_watcher() {
    if std::env::var_os("SCREENPILOT_PARENT_PID").is_none() {
        eprintln!("[overlay] standalone launch — stdin protocol disabled");
        return;
    }
    eprintln!("[overlay] managed launch — listening on stdin");

    thread::spawn(move || {
        let stdin = io::stdin();
        let mut handle = stdin.lock();
        let mut buf = String::new();
        loop {
            buf.clear();
            match handle.read_line(&mut buf) {
                Ok(0) | Err(_) => {
                    eprintln!("[overlay] stdin EOF — parent gone");
                    if let Some(h) = get_handle() {
                        stdout_event("exiting", r#"{"reason":"parent-eof"}"#);
                        let _ = h.exit(0);
                    }
                    break;
                }
                Ok(_) => {
                    let line = buf.trim();
                    if line.is_empty() { continue; }
                    if line.contains("\"exit\"") && line.contains("\"kind\"") {
                        if let Some(h) = get_handle() {
                            stdout_event("exiting", r#"{"reason":"parent-asked"}"#);
                            let _ = h.exit(0);
                        }
                        break;
                    }
                    broadcast_to_webviews(line);
                }
            }
        }
    });
}

/// Push an event JSON string into EVERY overlay window's __SP_EVENT__ bridge.
/// Coordinates in the event are in *desktop* space — each WebView translates
/// them to its own viewport in main.js (subtracting window.screenX/screenY).
fn broadcast_to_webviews(json_line: &str) {
    let Some(h) = get_handle() else { return; };
    let escaped = json_line
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    let script = format!("window.__SP_EVENT__('{}')", escaped);
    for (_label, win) in h.webview_windows() {
        let _ = win.eval(&script);
    }
    let _ = h.emit("sp:event", json_line.to_string());
}

fn stdout_event(kind: &str, payload_json: &str) {
    let line = format!("{{\"kind\":\"{}\",\"payload\":{}}}\n", kind, payload_json);
    let mut out = io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.flush();
}

/// Build the global-shortcut plugin so that ANY Escape press triggers
/// user_abort, even when keyboard focus is elsewhere (e.g. the user is
/// typing into the app being driven, or the click-through overlay is
/// unable to receive its own keydowns).
fn build_global_esc_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

    let esc = Shortcut::new(None, Code::Escape);
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |_app, shortcut, event| {
            if shortcut == &esc && event.state() == ShortcutState::Pressed {
                eprintln!("[overlay] global Esc pressed → user_abort");
                user_abort();
            }
        })
        .with_shortcuts([esc])
        .expect("failed to register Esc")
        .build()
}
