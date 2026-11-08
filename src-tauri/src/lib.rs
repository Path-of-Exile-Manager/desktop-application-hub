use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use ts_rs::TS;
use uuid::Uuid;

mod api;
mod dataset;
mod device;
mod discord;
mod extension;
mod game;
mod icons;
mod leagues;
mod paths;
mod server;

/// Что ядро сообщает интерфейсу о себе. `Serialize` позволяет отдать структуру в JS как JSON.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
struct AppInfo {
    name: String,
    version: String,
    parser_version: String,
    /// Id устройства (`X-Device-Id`), см. `device.rs`.
    device_id: Uuid,
    /// Папка данных приложения.
    data_dir: String,
}

/// Команда, которую интерфейс вызывает через `invoke("app_info")`.
/// Подробнее о командах: https://tauri.app/develop/calling-rust/
#[tauri::command]
fn app_info(app: tauri::AppHandle, api: tauri::State<Arc<api::Api>>, paths: tauri::State<paths::AppPaths>) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        parser_version: item_parser::VERSION.to_string(),
        device_id: api.device_id(),
        data_dir: paths.root().display().to_string(),
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
        .register_asynchronous_uri_scheme_protocol(icons::SCHEME, icons::handle)
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            let device_id: Uuid = device::load_or_create(&paths);
            let app_root = paths.root().to_path_buf();
            app.manage(paths);
            game::start(app.handle());
            server::start(app.handle());
            let handle = app.handle().clone();
            app.manage(Arc::new(api::Api::new(device_id, move || handle.state::<server::ServerWatcher>().current_url())));
            dataset::start(app.handle(), &app_root);
            leagues::start(app.handle(), &app_root);
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
            api::probe::api_probe,
            dataset::dataset_status,
            dataset::dataset_check_now,
            dataset::catalog_search,
            dataset::catalog_item,
            leagues::leagues_status,
            leagues::leagues_refresh,
            extension::extension_status,
            discord::discord_status,
            discord::discord_configure,
            discord::discord_reconnect,
            discord::discord_clear_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
