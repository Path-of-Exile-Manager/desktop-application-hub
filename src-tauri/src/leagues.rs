//! Лиги: `GET /v1/leagues`, кэш на диске (`leagues.json`), обновление раз в час.
//!
//! Какая лига текущая, сервер не говорит — её выбирает интерфейс (`ui/src/app/leagues.tsx`):
//! по умолчанию по эвристике, дальше — выбор пользователя. Ядро только держит свежий список.
//!
//! Поток `leagues-sync`: при запуске — список из кэша, затем запрос; раз в час, после ошибки —
//! раз в минуту, сразу — по `leagues_refresh` и когда сервер снова на связи. Событие `leagues-status`.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::api::{Api, Call, Reply};
use crate::paths::write_atomic;

pub const EVENT: &str = "leagues-status";
const FILE: &str = "leagues.json";
const REFRESH: Duration = Duration::from_secs(60 * 60);
const RETRY: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum LeagueKind {
    /// Standard, Hardcore: не заканчиваются.
    Permanent,
    /// Сезонная лига испытаний.
    Challenge,
    /// Короткое событие.
    Event,
    #[serde(other)]
    Unknown,
}

/// Лига, как её отдаёт `GET /v1/leagues`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct League {
    /// Id GGG: `Allflame`, `Hardcore Allflame`. Его же ждут `/v1/prices/:league` и сайт торговли.
    pub id: String,
    pub name: String,
    pub kind: LeagueKind,
    pub hardcore: bool,
    /// ISO-время; `null` — неизвестно.
    pub start_at: Option<String>,
    /// ISO-время; `null` — конец не объявлен.
    pub end_at: Option<String>,
    /// Хотя бы один источник цен включён в админке.
    pub prices_tracked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LeaguesSource {
    /// С диска; сервер мог и не ответить.
    Cache,
    /// Получен в этом запуске.
    Network,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LeaguesStatus {
    pub leagues: Vec<League>,
    pub source: Option<LeaguesSource>,
    pub syncing: bool,
    /// Конец последнего запроса, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    /// Ошибка последнего запроса (список при этом может быть из кэша).
    pub error: Option<String>,
}

pub struct LeaguesService {
    status: Mutex<LeaguesStatus>,
    wake: Mutex<Sender<()>>,
}

impl LeaguesService {
    pub fn status(&self) -> LeaguesStatus {
        self.status.lock().unwrap().clone()
    }

    /// Обновить список сейчас.
    pub fn wake(&self) {
        let _ = self.wake.lock().unwrap().send(());
    }
}

pub fn start(app: &AppHandle, app_root: &std::path::Path) {
    let (tx, rx) = mpsc::channel();
    let status = LeaguesStatus { leagues: Vec::new(), source: None, syncing: false, checked_at: None, error: None };
    app.manage(LeaguesService { status: Mutex::new(status), wake: Mutex::new(tx) });

    let file = app_root.join(FILE);
    let app = app.clone();
    thread::Builder::new().name("leagues-sync".into()).spawn(move || run(app, file, rx)).expect("spawn leagues sync");
}

fn run(app: AppHandle, file: PathBuf, wake: Receiver<()>) {
    let service = app.state::<LeaguesService>();
    if let Some(leagues) = fs::read(&file).ok().and_then(|bytes| serde_json::from_slice::<Vec<League>>(&bytes).ok()) {
        let mut status = service.status.lock().unwrap();
        status.leagues = leagues;
        status.source = Some(LeaguesSource::Cache);
    }
    publish(&app, &service);

    loop {
        service.status.lock().unwrap().syncing = true;
        publish(&app, &service);

        let api = app.state::<Arc<Api>>().inner().clone();
        let result = match api.send::<Vec<League>>(Call::get("/v1/leagues")) {
            Ok(Reply::Fresh { value, .. }) => Ok(value),
            // Без If-None-Match сервер 304 не отвечает; на всякий случай — список прежний.
            Ok(Reply::NotModified { .. }) => Ok(service.status().leagues),
            Err(e) => Err(e.message),
        };
        let failed = result.is_err();
        {
            let mut status = service.status.lock().unwrap();
            status.syncing = false;
            status.checked_at = Some(now_ms());
            match result {
                Ok(leagues) => {
                    if let Ok(bytes) = serde_json::to_vec_pretty(&leagues) {
                        let _ = write_atomic(&file, &bytes);
                    }
                    status.leagues = leagues;
                    status.source = Some(LeaguesSource::Network);
                    status.error = None;
                }
                Err(e) => status.error = Some(e),
            }
        }
        publish(&app, &service);

        match wake.recv_timeout(if failed { RETRY } else { REFRESH }) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn publish(app: &AppHandle, service: &LeaguesService) {
    let _ = app.emit(EVENT, service.status());
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `invoke("leagues_status")`.
#[tauri::command]
pub fn leagues_status(service: State<LeaguesService>) -> LeaguesStatus {
    service.status()
}

/// Обновить список лиг сейчас.
#[tauri::command]
pub fn leagues_refresh(service: State<LeaguesService>) {
    service.wake();
}
