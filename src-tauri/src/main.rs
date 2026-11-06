// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Режим «мост» для расширения браузера: Chrome запускает нас как хост Native Messaging
    // (`poe-manager.exe chrome-extension://<id>/ --parent-window=…`). Окно, WebView и Tauri не нужны —
    // только пересылка между stdio и каналом запущенного приложения (crates/browser-bridge).
    if let Some(origin) = std::env::args().skip(1).find(|arg| arg.starts_with("chrome-extension://")) {
        std::process::exit(browser_bridge::relay::run_stdio(&origin));
    }
    poe_manager_lib::run()
}
