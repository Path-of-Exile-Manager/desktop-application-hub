//! Цены выбранной лиги: `GET /v1/prices/:league` целиком, с ETag; кэш на диске
//! (`prices\<лига>.json` + `.etag`); индекс в памяти по `(itemId, variantKey)`.
//!
//! Лигу задаёт интерфейс (`prices_set_league`), когда меняется текущая. Поток `prices-sync`:
//! сменили лигу — поднимает её кэш и спрашивает сервер с `If-None-Match` (304 — данные те же,
//! трафика почти нет); дальше раз в 15 минут, после ошибки — раз в минуту, сразу —
//! по `prices_refresh` и когда сервер снова на связи. Событие `prices-status`.
//!
//! Сводная цена (`chaosValue`) — медиана источников на сервере; `reliable = false` — годных
//! значений не было. Свежесть клиент проверяет сам по `updatedAt`: сервер не чистит цены,
//! которые источник перестал отдавать.

use std::collections::HashMap;
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
use crate::dataset::DatasetService;
use crate::paths::write_atomic;

pub const EVENT: &str = "prices-status";
const REFRESH: Duration = Duration::from_secs(15 * 60);
const RETRY: Duration = Duration::from_secs(60);
const TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum PriceSource {
    Ninja,
    Watch,
    Tft,
    #[serde(other)]
    Unknown,
}

/// Цена одного источника.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourcePrice {
    pub source: PriceSource,
    pub chaos_value: f64,
    /// Лотов за значением; `null` — источник не сообщает.
    pub listing_count: Option<u32>,
    /// Источник сам считает значение ненадёжным.
    pub low_confidence: bool,
    /// Когда источник посчитал значение (ISO).
    pub observed_at: String,
}

/// Цена ключа `(itemId, variantKey)` в лиге.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Price {
    /// Нужен только для истории.
    pub price_key_id: i64,
    pub item_id: String,
    /// Канонический ключ варианта: `corrupted=1;level=21;quality=20`, `''` — простой предмет.
    pub variant_key: String,
    /// Медиана годных значений источников.
    pub chaos_value: f64,
    /// `false` — годных значений не было, медиана по свежим.
    pub reliable: bool,
    pub sources_used: u32,
    /// Когда сервер пересчитал сводную цену (ISO).
    pub updated_at: String,
    pub sources: Vec<SourcePrice>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct LeaguePrices {
    league: String,
    prices: Vec<Price>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PricesState {
    /// Лига не выбрана.
    Idle,
    /// Кэша нет, первая загрузка идёт.
    Loading,
    /// Цены есть (из кэша или с сервера).
    Ready,
    /// Цен нет: кэша нет, сервер не ответил или лиги у него нет.
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PricesSource {
    Cache,
    Network,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PricesStatus {
    pub league: Option<String>,
    pub state: PricesState,
    pub syncing: bool,
    /// Ключей цен в лиге.
    pub count: u32,
    /// Самая свежая сводная цена лиги (ISO): возраст данных в целом.
    pub newest_update: Option<String>,
    /// Цена Divine Orb в chaos (по справочнику, `tradeId = divine`).
    pub divine_chaos: Option<f64>,
    pub source: Option<PricesSource>,
    /// Конец последнего запроса, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    pub error: Option<String>,
}

/// Цены одной лиги с индексом.
struct Board {
    prices: Vec<Price>,
    by_item: HashMap<String, Vec<usize>>,
    etag: Option<String>,
}

impl Board {
    fn new(prices: Vec<Price>, etag: Option<String>) -> Self {
        let mut by_item: HashMap<String, Vec<usize>> = HashMap::with_capacity(prices.len());
        for (i, price) in prices.iter().enumerate() {
            by_item.entry(price.item_id.clone()).or_default().push(i);
        }
        Self { prices, by_item, etag }
    }

    fn variants(&self, item_id: &str) -> Vec<&Price> {
        self.by_item.get(item_id).map(|list| list.iter().map(|&i| &self.prices[i]).collect()).unwrap_or_default()
    }

    fn get(&self, item_id: &str, variant_key: &str) -> Option<&Price> {
        self.variants(item_id).into_iter().find(|p| p.variant_key == variant_key)
    }

    fn newest(&self) -> Option<String> {
        // ISO-строки сервера одного формата: сравниваются как строки.
        self.prices.iter().map(|p| &p.updated_at).max().cloned()
    }
}

struct Inner {
    status: PricesStatus,
    board: Option<Arc<Board>>,
}

pub struct PricesService {
    inner: Mutex<Inner>,
    wake: Mutex<Sender<()>>,
    root: PathBuf,
}

impl PricesService {
    pub fn status(&self) -> PricesStatus {
        self.inner.lock().unwrap().status.clone()
    }

    pub fn wake(&self) {
        let _ = self.wake.lock().unwrap().send(());
    }

    fn board(&self) -> Option<Arc<Board>> {
        self.inner.lock().unwrap().board.clone()
    }

    fn league(&self) -> Option<String> {
        self.inner.lock().unwrap().status.league.clone()
    }

    fn cache_files(&self, league: &str) -> (PathBuf, PathBuf) {
        let name: String = league.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
        let dir = self.root.join("prices");
        (dir.join(format!("{name}.json")), dir.join(format!("{name}.etag")))
    }
}

pub fn start(app: &AppHandle, app_root: &std::path::Path) {
    let (tx, rx) = mpsc::channel();
    let status = PricesStatus {
        league: None,
        state: PricesState::Idle,
        syncing: false,
        count: 0,
        newest_update: None,
        divine_chaos: None,
        source: None,
        checked_at: None,
        error: None,
    };
    app.manage(PricesService { inner: Mutex::new(Inner { status, board: None }), wake: Mutex::new(tx), root: app_root.to_path_buf() });
    let app = app.clone();
    thread::Builder::new().name("prices-sync".into()).spawn(move || run(app, rx)).expect("spawn prices sync");
}

fn run(app: AppHandle, wake: Receiver<()>) {
    let service = app.state::<PricesService>();
    loop {
        let interval = service.league().map(|league| sync_once(&app, &service, &league));
        let received = match interval {
            Some(interval) => wake.recv_timeout(interval),
            None => wake.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        if let Err(RecvTimeoutError::Disconnected) = received {
            return;
        }
    }
}

/// Одна проверка лиги; возвращает, через сколько проверить снова.
fn sync_once(app: &AppHandle, service: &PricesService, league: &str) -> Duration {
    // Сменили лигу — сначала её кэш, чтобы цены были сразу.
    let needs_cache = service.inner.lock().unwrap().board.is_none();
    if needs_cache {
        let (json, etag) = service.cache_files(league);
        if let Some(cached) = fs::read(&json).ok().and_then(|b| serde_json::from_slice::<LeaguePrices>(&b).ok()).filter(|c| c.league == league) {
            let etag = fs::read_to_string(&etag).ok().map(|s| s.trim().to_string());
            set_board(service, league, Board::new(cached.prices, etag), PricesSource::Cache);
        }
    }
    {
        let mut inner = service.inner.lock().unwrap();
        inner.status.syncing = true;
        if inner.board.is_none() {
            inner.status.state = PricesState::Loading;
        }
    }
    publish(app, service);

    let api = app.state::<Arc<Api>>().inner().clone();
    let mut call = Call::get(format!("/v1/prices/{}", encode_segment(league))).timeout(TIMEOUT);
    if let Some(etag) = service.board().and_then(|b| b.etag.clone()) {
        call = call.if_none_match(etag);
    }
    let result = api.send::<LeaguePrices>(call);

    // Пока шёл запрос, лигу могли сменить — тогда результат не наш.
    if service.league().as_deref() != Some(league) {
        return Duration::ZERO;
    }
    let failed = result.is_err();
    match result {
        Ok(Reply::Fresh { value, meta }) => {
            let (json, etag_file) = service.cache_files(league);
            if let Some(dir) = json.parent() {
                let _ = fs::create_dir_all(dir);
            }
            if let Ok(bytes) = serde_json::to_vec(&value) {
                let _ = write_atomic(&json, &bytes);
            }
            match &meta.etag {
                Some(etag) => {
                    let _ = write_atomic(&etag_file, etag.as_bytes());
                }
                None => {
                    let _ = fs::remove_file(&etag_file);
                }
            }
            set_board(service, league, Board::new(value.prices, meta.etag), PricesSource::Network);
            service.inner.lock().unwrap().status.error = None;
        }
        Ok(Reply::NotModified { .. }) => {
            let mut inner = service.inner.lock().unwrap();
            inner.status.error = None;
            inner.status.source = Some(PricesSource::Network);
        }
        Err(e) => service.inner.lock().unwrap().status.error = Some(e.message),
    }
    {
        let mut inner = service.inner.lock().unwrap();
        inner.status.syncing = false;
        inner.status.checked_at = Some(now_ms());
        inner.status.state = if inner.board.is_some() { PricesState::Ready } else { PricesState::Missing };
    }
    publish(app, service);
    if failed { RETRY } else { REFRESH }
}

fn set_board(service: &PricesService, league: &str, board: Board, source: PricesSource) {
    let mut inner = service.inner.lock().unwrap();
    if inner.status.league.as_deref() != Some(league) {
        return;
    }
    inner.status.state = PricesState::Ready;
    inner.status.count = board.prices.len() as u32;
    inner.status.newest_update = board.newest();
    inner.status.source = Some(source);
    inner.board = Some(Arc::new(board));
}

/// Статус с курсом divine: справочник может прийти позже цен, поэтому курс считается при отправке.
fn publish(app: &AppHandle, service: &PricesService) {
    let mut status = service.status();
    status.divine_chaos = divine_chaos(app, service);
    service.inner.lock().unwrap().status.divine_chaos = status.divine_chaos;
    let _ = app.emit(EVENT, status);
}

fn divine_chaos(app: &AppHandle, service: &PricesService) -> Option<f64> {
    let catalog = app.state::<DatasetService>().catalog()?;
    let divine = catalog.by_trade_id("divine")?;
    service.board()?.get(&divine.id, "").map(|p| p.chaos_value)
}

/// Сегмент пути: всё, кроме `[A-Za-z0-9-._~]`, — в `%XX` (`Hardcore Allflame` → `Hardcore%20Allflame`).
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `invoke("prices_status")`.
#[tauri::command]
pub fn prices_status(app: AppHandle, service: State<PricesService>) -> PricesStatus {
    let mut status = service.status();
    status.divine_chaos = divine_chaos(&app, &service);
    status
}

/// Текущая лига интерфейса; `null` — не выбрана. Та же лига — ничего не делает.
#[tauri::command]
pub fn prices_set_league(app: AppHandle, service: State<PricesService>, league: Option<String>) {
    {
        let mut inner = service.inner.lock().unwrap();
        if inner.status.league == league {
            return;
        }
        inner.status = PricesStatus {
            state: if league.is_some() { PricesState::Loading } else { PricesState::Idle },
            league,
            syncing: false,
            count: 0,
            newest_update: None,
            divine_chaos: None,
            source: None,
            checked_at: None,
            error: None,
        };
        inner.board = None;
    }
    publish(&app, &service);
    service.wake();
}

/// Обновить цены сейчас.
#[tauri::command]
pub fn prices_refresh(service: State<PricesService>) {
    service.wake();
}

/// Цена ключа в текущей лиге.
#[tauri::command]
pub fn price_get(service: State<PricesService>, item_id: String, variant_key: String) -> Option<Price> {
    service.board().and_then(|b| b.get(&item_id, &variant_key).cloned())
}

/// Все варианты предмета, у которых есть цена в текущей лиге.
#[tauri::command]
pub fn price_variants(service: State<PricesService>, item_id: String) -> Vec<Price> {
    service.board().map(|b| b.variants(&item_id).into_iter().cloned().collect()).unwrap_or_default()
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum HistoryRange {
    /// Часовые точки за 7 дней.
    Week,
    /// Суточные за всё время.
    All,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryPoint {
    pub at: String,
    pub chaos_value: f64,
    pub min: f64,
    pub max: f64,
    pub listing_count: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistorySeries {
    pub source: PriceSource,
    /// От старых к новым.
    pub points: Vec<HistoryPoint>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PriceHistory {
    pub price_key_id: i64,
    pub range: HistoryRange,
    /// По источникам; сводной линии сервер не отдаёт.
    pub series: Vec<HistorySeries>,
}

/// История цены ключа в лиге. Без кэша: нужна по запросу.
#[tauri::command]
pub async fn price_history(api: State<'_, Arc<Api>>, league: String, price_key_id: i64, range: HistoryRange) -> Result<PriceHistory, String> {
    let range_param = match range {
        HistoryRange::Week => "week",
        HistoryRange::All => "all",
    };
    let call = Call::get(format!("/v1/prices/{}/history/{price_key_id}", encode_segment(&league))).query("range", range_param).timeout(TIMEOUT);
    let api = api.inner().clone();
    let reply = tauri::async_runtime::spawn_blocking(move || api.send::<PriceHistory>(call)).await.map_err(|e| e.to_string())?;
    match reply {
        Ok(Reply::Fresh { value, .. }) => Ok(value),
        Ok(Reply::NotModified { .. }) => Err("сервер ответил 304 без запроса с ETag".into()),
        Err(e) => Err(e.message),
    }
}
