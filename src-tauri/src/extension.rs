//! Связь с расширением браузера (docs/extension-bridge.md в общих документах).
//!
//! При запуске:
//! 1. регистрируем хост Native Messaging в Chrome (манифест + ключ HKCU) — путь к exe всегда актуальный;
//! 2. слушаем именованный канал: к нему подключаются мосты (`poe-manager.exe chrome-extension://…`,
//!    их запускает Chrome, см. main.rs);
//! 3. сообщаем интерфейсу событием `extension-status`, на связи ли расширение.
//!
//! Протокол и транспорт — в крейте browser-bridge; здесь только склейка с Tauri.

use std::sync::Mutex;

use browser_bridge::server::{Hub, Snapshot};
use browser_bridge::{config, pipe, register};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVENT: &str = "extension-status";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    Connected,
}

/// Готов ли мост: зарегистрирован ли хост в Chrome и слушает ли приложение канал.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bridge {
    /// Хост зарегистрирован в Chrome (манифест и ключ реестра записаны).
    pub registered: bool,
    pub manifest_path: Option<String>,
    /// Канал создан и ждёт подключений.
    pub listening: bool,
    pub error: Option<String>,
    /// ID расширений, которым разрешено подключаться.
    pub extension_ids: Vec<String>,
}

/// То же, что тип `ExtensionStatus` в ui/src/app/extension.tsx.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub state: ConnectionState,
    /// «Chrome».
    pub browser: Option<String>,
    /// Версия расширения.
    pub version: Option<String>,
    /// Когда расширение подключилось, мс с 1970-01-01.
    pub last_seen_at: Option<u64>,
    /// Сколько профилей браузера на связи.
    pub clients: usize,
    pub bridge: Bridge,
}

pub struct ExtensionWatcher(Mutex<ExtensionStatus>);

fn browser_label(browser: &str) -> String {
    match browser {
        "chrome" => "Chrome".into(),
        other => other.to_string(),
    }
}

fn apply_snapshot(status: &mut ExtensionStatus, snapshot: &Snapshot) {
    let latest = snapshot.clients.last();
    status.state = if latest.is_some() { ConnectionState::Connected } else { ConnectionState::Disconnected };
    status.browser = latest.map(|c| browser_label(&c.browser));
    status.version = latest.map(|c| c.ext_version.clone());
    status.last_seen_at = latest.map(|c| c.connected_at);
    status.clients = snapshot.clients.len();
}

fn update(app: &AppHandle, change: impl FnOnce(&mut ExtensionStatus)) {
    let watcher = app.state::<ExtensionWatcher>();
    let status = {
        let mut status = watcher.0.lock().unwrap();
        change(&mut status);
        status.clone()
    };
    let _ = app.emit(EVENT, status);
}

pub fn start(app: &AppHandle) {
    let mut bridge = Bridge { registered: false, manifest_path: None, listening: false, error: None, extension_ids: config::extension_ids() };

    match std::env::current_exe().and_then(|exe| register::register_chrome(&exe, &register::manifest_dir(), &config::allowed_origins())) {
        Ok(path) => {
            bridge.registered = true;
            bridge.manifest_path = Some(path.to_string_lossy().to_string());
        }
        Err(e) => bridge.error = Some(format!("не удалось зарегистрировать мост в Chrome: {e}")),
    }

    app.manage(ExtensionWatcher(Mutex::new(ExtensionStatus {
        state: ConnectionState::Disconnected,
        browser: None,
        version: None,
        last_seen_at: None,
        clients: 0,
        bridge,
    })));

    let version = app.package_info().version.to_string();
    let handle = app.clone();
    let hub = Hub::new(version, move |snapshot| update(&handle, |s| apply_snapshot(s, &snapshot)));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        update(&app, |s| s.bridge.listening = true);
        let pipe_name = pipe::default_pipe_name();
        if let Err(e) = browser_bridge::server::serve(&pipe_name, hub).await {
            // Чаще всего — уже запущен другой экземпляр приложения и канал занят им.
            update(&app, |s| {
                s.bridge.listening = false;
                s.bridge.error = Some(format!("канал для расширения недоступен: {e}"));
            });
        }
    });
}

/// Текущее состояние: `invoke("extension_status")`.
#[tauri::command]
pub fn extension_status(watcher: State<ExtensionWatcher>) -> ExtensionStatus {
    watcher.0.lock().unwrap().clone()
}
