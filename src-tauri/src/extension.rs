//! Связь с расширением браузера (docs/extension-bridge.md в общих документах).
//!
//! При запуске:
//! 1. регистрируем хост Native Messaging в Chrome (манифест + ключ HKCU) — путь к exe всегда актуальный;
//! 2. слушаем именованный канал: к нему подключаются мосты (`poe-manager.exe chrome-extension://…`,
//!    их запускает Chrome, см. main.rs);
//! 3. сообщаем интерфейсу событием `extension-status`, на связи ли расширение.
//!
//! Протокол и транспорт — в крейте browser-bridge; здесь только склейка с Tauri.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use browser_bridge::protocol::PROTOCOL_VERSION;
use browser_bridge::server::{Handled, Hub, Snapshot};
use browser_bridge::{config, pipe, register};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::account::{AccountService, AccountState};
use crate::sync::bridge::{self as data, Change};

pub const EVENT: &str = "extension-status";

/// Что умеет приложение по мосту (расширение смотрит на это в `welcome`).
const FEATURES: &[&str] = &["account", "open-trade", "data"];
/// Сколько ждать, пока расширение откроет поиск, прежде чем открыть его в браузере само.
const OPEN_TRADE_TIMEOUT: Duration = Duration::from_secs(3);

/// Сервер канала — для рассылок и запросов приложения к расширению.
pub struct ExtensionHub {
    hub: Arc<Hub>,
    /// Последнее отправленное состояние аккаунта: одинаковое повторно не шлём.
    last_account: Mutex<Option<Value>>,
}

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
    let on_message = app.clone();
    let on_welcome = app.clone();
    let hub = Hub::with_handler(
        version,
        move |snapshot| update(&handle, |s| apply_snapshot(s, &snapshot)),
        move |_client, kind, message| handle_message(&on_message, kind, message),
        move || {
            let mut extra = Map::new();
            extra.insert("features".into(), json!(FEATURES));
            extra.insert("account".into(), account_payload(&on_welcome));
            extra
        },
    );
    app.manage(ExtensionHub { hub: hub.clone(), last_account: Mutex::new(None) });

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

/// Аккаунт для показа в расширении: без токенов (решение 8 — с сервером общается только приложение).
fn account_payload(app: &AppHandle) -> Value {
    let Some(account) = app.try_state::<AccountService>() else { return json!({ "signedIn": false, "user": null }) };
    let status = account.status();
    let signed_in = status.state == AccountState::SignedIn;
    let user = status.user.filter(|_| signed_in).map(|u| json!({ "displayName": u.display_name, "avatarUrl": u.avatar_url }));
    json!({ "signedIn": signed_in, "user": user })
}

/// Сообщения расширения, кроме рукопожатия: данные (этап 3).
fn handle_message(app: &AppHandle, kind: &str, message: &Value) -> Handled {
    let re = message.get("id").cloned().unwrap_or(Value::Null);
    match kind {
        "data.sync" | "data.ops" => {
            let changes: Vec<Change> = match message.get("changes").cloned().map(serde_json::from_value).transpose() {
                Ok(changes) => changes.unwrap_or_default(),
                Err(e) => return Handled::Reply(json!({ "v": PROTOCOL_VERSION, "type": "error", "re": re, "code": "invalid", "message": format!("changes: {e}") })),
            };
            // Первое подключение этого профиля: расширение ещё ни разу не получало снимок.
            let first = kind == "data.sync" && message.get("baseRevision").is_none_or(Value::is_null);
            let rejected = data::apply(app, changes, first);
            let mut reply = data::snapshot(app);
            reply["v"] = json!(PROTOCOL_VERSION);
            reply["type"] = json!("data.snapshot");
            reply["re"] = re;
            reply["rejected"] = json!(rejected);
            Handled::Reply(reply)
        }
        _ => Handled::Unknown,
    }
}

/// Данные расширения изменились здесь (правка в приложении, приход с сервера) — новый снимок всем.
pub fn data_changed(app: &AppHandle) {
    let Some(ext) = app.try_state::<ExtensionHub>() else { return };
    if ext.hub.snapshot().clients.is_empty() {
        return;
    }
    let mut message = data::snapshot(app);
    message["v"] = json!(PROTOCOL_VERSION);
    message["type"] = json!("data.changed");
    ext.hub.broadcast(&message);
}

/// Вход или выход в приложении — показать в панели расширения.
pub fn account_changed(app: &AppHandle) {
    let Some(ext) = app.try_state::<ExtensionHub>() else { return };
    let account = account_payload(app);
    {
        let mut last = ext.last_account.lock().unwrap();
        if last.as_ref() == Some(&account) {
            return;
        }
        *last = Some(account.clone());
    }
    ext.hub.broadcast(&json!({ "v": PROTOCOL_VERSION, "type": "account.changed", "account": account }));
}

/// Где открылся поиск.
#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OpenedIn {
    /// В уже открытой вкладке сайта торговли (через расширение).
    TradeTab,
    /// В новой вкладке (через расширение).
    NewTab,
    /// В браузере по умолчанию — расширения на связи нет.
    Browser,
}

/// Открыть поиск на сайте торговли PoE1: через расширение (в открытой вкладке торговли),
/// без него — в браузере по умолчанию.
#[tauri::command]
pub async fn extension_open_trade(app: AppHandle, url: String) -> Result<OpenedIn, String> {
    if !url.starts_with("https://www.pathofexile.com/trade/") {
        return Err("открываются только адреса сайта торговли PoE1".into());
    }
    if let Some(ext) = app.try_state::<ExtensionHub>() {
        let id = uuid::Uuid::now_v7().simple().to_string();
        let request = json!({ "v": PROTOCOL_VERSION, "type": "open-trade", "id": id, "url": url });
        if let Some(reply) = ext.hub.request_latest(request)
            && let Ok(Ok(reply)) = tokio::time::timeout(OPEN_TRADE_TIMEOUT, reply).await
                && reply["type"] == "opened" {
                    return Ok(if reply["reused"].as_bool().unwrap_or(false) { OpenedIn::TradeTab } else { OpenedIn::NewTab });
                }
    }
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())?;
    Ok(OpenedIn::Browser)
}

/// Текущее состояние: `invoke("extension_status")`.
#[tauri::command]
pub fn extension_status(watcher: State<ExtensionWatcher>) -> ExtensionStatus {
    watcher.0.lock().unwrap().clone()
}
