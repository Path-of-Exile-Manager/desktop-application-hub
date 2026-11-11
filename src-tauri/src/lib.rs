use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;
use ts_rs::TS;
use uuid::Uuid;

mod account;
mod api;
mod appraise;
mod capture;
/// Расчёт «Выгодных кластеров» без Tauri: открыт для примера `clusters_offline`.
pub mod cluster_plans;
mod clusters;
mod dataset;
mod device;
mod discord;
mod extension;
mod game;
mod icons;
mod leagues;
mod overlay;
mod paths;
mod prices;
mod server;
mod sync;

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
        .plugin(capture::plugin())
        .plugin(tauri_plugin_opener::init())
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
            prices::start(app.handle(), &app_root);
            clusters::start(app.handle(), &app_root);
            account::start(app.handle(), &app.state::<paths::AppPaths>());
            sync::start(app.handle(), &app.state::<paths::AppPaths>())?;
            app.manage(appraise::LastAppraisal::default());
            capture::start(app.handle(), &game::current(app.handle()));
            overlay::create(app.handle())?;
            extension::start(app.handle());
            discord::start(app.handle(), &game::current(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            open_devtools,
            game::game_status,
            server::server_status,
            account::account_status,
            account::account_login_start,
            account::account_login_cancel,
            account::account_logout,
            account::account_profile,
            account::account_devices,
            account::account_revoke_device,
            account::account_export,
            account::account_delete,
            sync::sync_status,
            sync::sync_now,
            sync::sync_resolve,
            sync::sync_records,
            sync::sync_put,
            sync::sync_delete,
            sync::sync_sort_key_between,
            server::server_check_now,
            server::server_set_url,
            api::probe::api_probe,
            dataset::dataset_status,
            dataset::dataset_check_now,
            dataset::catalog_search,
            dataset::catalog_item,
            dataset::catalog_by_trade_ids,
            dataset::catalog_map_search,
            leagues::leagues_status,
            leagues::leagues_refresh,
            prices::prices_status,
            prices::prices_set_league,
            prices::prices_refresh,
            prices::price_get,
            prices::price_variants,
            prices::price_history,
            clusters::clusters_status,
            clusters::clusters_refresh,
            clusters::clusters_list,
            clusters::cluster_detail,
            appraise::item_appraise,
            appraise::item_last_appraisal,
            capture::capture_set_hotkey,
            capture::capture_from_clipboard,
            overlay::overlay_show,
            overlay::overlay_hide,
            overlay::overlay_open_main,
            extension::extension_status,
            extension::extension_open_trade,
            discord::discord_status,
            discord::discord_configure,
            discord::discord_reconnect,
            discord::discord_clear_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
