use serde::Serialize;

mod discord;
mod extension;
mod game;
mod server;

/// Что ядро сообщает интерфейсу о себе. `Serialize` позволяет отдать структуру в JS как JSON.
#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    parser_version: &'static str,
}

/// Команда, которую интерфейс вызывает через `invoke("app_info")`.
/// Подробнее о командах: https://tauri.app/develop/calling-rust/
#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        parser_version: item_parser::VERSION,
    }
}

/// Открыть инструменты разработчика WebView (кнопка на странице «Режим разработки»). Есть только в отладочной сборке.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        Err("DevTools доступны только в отладочной сборке (pnpm tauri dev)".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            game::start(app.handle());
            server::start(app.handle());
            extension::start(app.handle());
            discord::start(app.handle(), &game::current(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            open_devtools,
            game::game_status,
            server::server_status,
            server::server_check_now,
            server::server_set_url,
            extension::extension_status,
            discord::discord_status,
            discord::discord_configure,
            discord::discord_reconnect,
            discord::discord_clear_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
