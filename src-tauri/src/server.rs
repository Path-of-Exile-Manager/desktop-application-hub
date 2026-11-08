//! Связь с сервером (BFF): фоновый поток проверяет `GET {url}/v1/health` и сообщает интерфейсу
//! событием `server-status`.
//!
//! Адрес сервера, по убыванию приоритета:
//! 1. задан на странице «Режим разработки» (команда `server_set_url`; интерфейс сохраняет его между запусками
//!    и передаёт ядру, только пока в настройках включён режим разработчика);
//! 2. переменная окружения `API_URL` при запуске (в отладочной сборке читаются и `.env.local` / `.env`);
//! 3. `API_URL`, заданный при сборке (`option_env!`) — так в релиз попадёт адрес боевого сервера.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

pub const EVENT: &str = "server-status";

/// Как часто проверять: пока связь есть — реже, когда нет — чаще, чтобы быстро заметить восстановление.
const INTERVAL_ONLINE: Duration = Duration::from_secs(15);
const INTERVAL_OFFLINE: Duration = Duration::from_secs(5);
const TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ServerState {
    /// Адрес не задан.
    Unconfigured,
    /// Первая проверка после запуска или смены адреса.
    Checking,
    Online,
    Offline,
}

/// Откуда взят адрес.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum UrlSource {
    /// Задан на странице «Режим разработки».
    Developer,
    /// Переменная окружения или .env-файл при запуске.
    Env,
    /// Задан при сборке.
    Build,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServerStatus {
    pub state: ServerState,
    pub url: Option<String>,
    pub source: Option<UrlSource>,
    /// Адрес по умолчанию (API_URL) — чтобы показать, к чему вернёт «Сбросить».
    pub default_url: Option<String>,
    pub latency_ms: Option<u64>,
    /// Версия сервера из ответа /v1/health.
    pub version: Option<String>,
    pub error: Option<String>,
    /// Время последней проверки, мс с 1970-01-01.
    pub checked_at: Option<u64>,
}

/// Ответ сервера на /v1/health. Все поля необязательные: достаточно кода 2xx.
#[derive(Deserialize)]
struct Health {
    version: Option<String>,
}

struct Inner {
    url: Option<String>,
    source: Option<UrlSource>,
    default: Option<(String, UrlSource)>,
    status: ServerStatus,
}

pub struct ServerWatcher {
    inner: Mutex<Inner>,
    wake: Mutex<Sender<()>>,
}

impl ServerWatcher {
    fn snapshot(&self) -> ServerStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// Текущий адрес сервера — им пользуется клиент api-hub (`api/mod.rs`).
    pub fn current_url(&self) -> Option<String> {
        self.inner.lock().unwrap().url.clone()
    }
}

/// Нормализует адрес: без пробелов и завершающего «/», только http(s).
fn normalize(url: &str) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err("пустой адрес".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("адрес должен начинаться с http:// или https://".into());
    }
    Ok(url.to_string())
}

fn default_url() -> Option<(String, UrlSource)> {
    #[cfg(debug_assertions)]
    {
        // .env.local главнее .env; уже заданные переменные окружения не перезаписываются.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
        let _ = dotenvy::from_path(format!("{root}/.env.local"));
        let _ = dotenvy::from_path(format!("{root}/.env"));
    }
    if let Some(url) = std::env::var("API_URL").ok().and_then(|u| normalize(&u).ok()) {
        return Some((url, UrlSource::Env));
    }
    option_env!("API_URL").and_then(|u| normalize(u).ok()).map(|u| (u, UrlSource::Build))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn status_for(inner: &Inner, state: ServerState) -> ServerStatus {
    ServerStatus {
        state,
        url: inner.url.clone(),
        source: inner.source,
        default_url: inner.default.as_ref().map(|(u, _)| u.clone()),
        latency_ms: None,
        version: None,
        error: None,
        checked_at: None,
    }
}

fn describe(error: &ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(code) => format!("сервер ответил HTTP {code}"),
        ureq::Error::Timeout(_) => "сервер не ответил за 3 с".into(),
        ureq::Error::HostNotFound => "адрес не найден (DNS)".into(),
        ureq::Error::ConnectionFailed => "не удалось подключиться".into(),
        ureq::Error::Io(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => "в соединении отказано".into(),
        other => other.to_string(),
    }
}

fn check(agent: &ureq::Agent, url: &str) -> Result<(u64, Option<String>), String> {
    let started = Instant::now();
    let mut response = agent.get(&format!("{url}/v1/health")).call().map_err(|e| describe(&e))?;
    let latency = started.elapsed().as_millis() as u64;
    let version = response.body_mut().read_json::<Health>().ok().and_then(|h| h.version);
    Ok((latency, version))
}

fn publish(app: &AppHandle, status: ServerStatus) {
    let _ = app.emit(EVENT, status);
}

pub fn start(app: &AppHandle) {
    let default = default_url();
    let (tx, rx) = mpsc::channel();
    let mut inner = Inner { url: default.as_ref().map(|(u, _)| u.clone()), source: default.as_ref().map(|(_, s)| *s), default, status: placeholder() };
    inner.status = status_for(&inner, if inner.url.is_some() { ServerState::Checking } else { ServerState::Unconfigured });
    app.manage(ServerWatcher { inner: Mutex::new(inner), wake: Mutex::new(tx) });

    let app = app.clone();
    thread::Builder::new()
        .name("server-watcher".into())
        .spawn(move || watch(app, rx))
        .expect("spawn server watcher");
}

fn placeholder() -> ServerStatus {
    ServerStatus { state: ServerState::Unconfigured, url: None, source: None, default_url: None, latency_ms: None, version: None, error: None, checked_at: None }
}

fn watch(app: AppHandle, wake: Receiver<()>) {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).build().into();
    loop {
        let watcher = app.state::<ServerWatcher>();
        let url = watcher.inner.lock().unwrap().url.clone();

        let interval = match url {
            None => {
                // Адреса нет — ждём, пока его зададут в режиме разработки.
                if wake.recv().is_err() {
                    return;
                }
                continue;
            }
            Some(url) => {
                let result = check(&agent, &url);
                let mut inner = watcher.inner.lock().unwrap();
                if inner.url.as_deref() != Some(url.as_str()) {
                    continue; // пока проверяли, адрес сменили — проверим новый
                }
                let mut status = status_for(&inner, ServerState::Online);
                status.checked_at = Some(now_ms());
                match result {
                    Ok((latency, version)) => {
                        status.latency_ms = Some(latency);
                        status.version = version;
                    }
                    Err(error) => {
                        status.state = ServerState::Offline;
                        status.error = Some(error);
                    }
                }
                let interval = if status.state == ServerState::Online { INTERVAL_ONLINE } else { INTERVAL_OFFLINE };
                inner.status = status.clone();
                drop(inner);
                publish(&app, status);
                interval
            }
        };

        match wake.recv_timeout(interval) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Текущее состояние связи: `invoke("server_status")`.
#[tauri::command]
pub fn server_status(watcher: State<ServerWatcher>) -> ServerStatus {
    watcher.snapshot()
}

/// Проверить связь прямо сейчас (кнопка «Проверить сейчас»).
#[tauri::command]
pub fn server_check_now(watcher: State<ServerWatcher>) {
    let _ = watcher.wake.lock().unwrap().send(());
}

/// Задать адрес сервера (страница «Режим разработки»). `null` — вернуть адрес по умолчанию (API_URL).
#[tauri::command]
pub fn server_set_url(app: AppHandle, watcher: State<ServerWatcher>, url: Option<String>) -> Result<ServerStatus, String> {
    let status = {
        let mut inner = watcher.inner.lock().unwrap();
        match url {
            Some(url) => {
                inner.url = Some(normalize(&url)?);
                inner.source = Some(UrlSource::Developer);
            }
            None => {
                inner.url = inner.default.as_ref().map(|(u, _)| u.clone());
                inner.source = inner.default.as_ref().map(|(_, s)| *s);
            }
        }
        let state = if inner.url.is_some() { ServerState::Checking } else { ServerState::Unconfigured };
        inner.status = status_for(&inner, state);
        inner.status.clone()
    };
    publish(&app, status.clone());
    let _ = watcher.wake.lock().unwrap().send(());
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn normalizes_url() {
        assert_eq!(normalize(" http://localhost:8787/ ").unwrap(), "http://localhost:8787");
        assert_eq!(normalize("https://api.example.com").unwrap(), "https://api.example.com");
        assert!(normalize("localhost:8787").is_err());
        assert!(normalize("   ").is_err());
    }
}
