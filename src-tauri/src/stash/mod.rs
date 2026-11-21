//! «Тайник»: сколько стоят вкладки тайника аккаунта PoE в текущей лиге и снапшоты стоимости
//! (решения пользователя 21.11.2026: вход по `POESESSID`, снапшот только по кнопке, всё хранится
//! локально, оцениваем то, что есть в «Экономике», редкие — нет).
//!
//! - сессия (`POESESSID`) — только в диспетчере учётных данных Windows (`keyring`), уходит только на
//!   `www.pathofexile.com`; имя аккаунта, список вкладок и выбор вкладок — `stash.json`;
//! - запросы к сайту — `client.rs` (лимиты по заголовкам), оценка — `items.rs` (`appraise_item`),
//!   снапшоты — `store.rs` (`user.db`, таблицы `stash_*`);
//! - событие `stash-status` — состояние и ход работы (запрос вкладки N из M, ожидание лимита).

mod client;
mod items;
mod store;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::dataset::{Catalog, DatasetService};
use crate::paths::{write_atomic, AppPaths};
use crate::prices::{PricesService, PricesState};
use client::{normalize_session, PoeClient, PoeError, RawTab, Rule, STASH_POLICY};
use items::{value_all, Valued};
use store::{RowRecord, SnapshotRecord, SnapshotStore, TabRecord};

pub const EVENT: &str = "stash-status";
const SETTINGS_FILE: &str = "stash.json";
const KEYRING_SERVICE: &str = "poe-manager";
const KEYRING_USER: &str = "poesessid";
/// Дольше ждать лимит сайта не будем: снапшот прерывается с понятной причиной.
const MAX_WAIT: Duration = Duration::from_secs(5 * 60);

/// Вкладка тайника.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashTab {
    /// Постоянный id вкладки.
    pub id: String,
    /// Номер вкладки (меняется, если вкладки переставить).
    pub index: u32,
    pub name: String,
    /// Тип как у сайта: `PremiumStash`, `CurrencyStash`, `QuadStash`…
    pub kind: String,
    /// `#rrggbb`.
    pub colour: Option<String>,
    /// Вкладка «только забрать» или скрытая в игре.
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StashJobKind {
    Connect,
    Tabs,
    Snapshot,
}

/// Что ядро делает сейчас.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashJob {
    pub kind: StashJobKind,
    /// Сделано запросов вкладок.
    pub done: u32,
    pub total: u32,
    /// Какую вкладку загружаем.
    pub tab: Option<String>,
    /// Ждём лимит сайта ещё столько секунд.
    pub wait_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashStatus {
    /// Сессия сохранена и имя аккаунта известно.
    pub connected: bool,
    /// `Name#1234`.
    pub account: Option<String>,
    /// Лига цен (из шапки) — её тайник и оцениваем.
    pub league: Option<String>,
    /// Вкладки лиги из последнего ответа сайта.
    pub tabs: Vec<StashTab>,
    /// Когда список вкладок получен, мс с 1970-01-01.
    pub tabs_fetched_at: Option<u64>,
    /// Id вкладок, которые входят в снапшот.
    pub selected: Vec<String>,
    pub job: Option<StashJob>,
    /// Ошибка последнего действия.
    pub error: Option<String>,
    /// Правила лимита сайта для тайника по последнему ответу.
    pub limits: Vec<Rule>,
}

/// Снапшот: сколько стоил тайник в момент снятия (по ценам того момента).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashSnapshot {
    pub id: i64,
    pub league: String,
    /// Мс с 1970-01-01.
    pub taken_at: i64,
    pub total_chaos: f64,
    /// Курс divine в момент снятия.
    pub divine_chaos: Option<f64>,
    pub tabs: u32,
    /// Строк с ценой / без цены / не оцениваемых предметов (редкие, белый хлам).
    pub priced: u32,
    pub unpriced: u32,
    pub skipped: u32,
    /// Самая свежая цена прайса в момент снятия (ISO).
    pub prices_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashSnapshotTab {
    pub id: String,
    pub index: u32,
    pub name: String,
    pub kind: String,
    pub colour: Option<String>,
    pub total_chaos: f64,
    pub priced: u32,
    pub unpriced: u32,
    pub skipped: u32,
}

/// Предмет снапшота: один вариант цены в одной вкладке, количество сложено.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashRow {
    pub tab_id: String,
    /// `null` — предмета нет в справочнике.
    pub item_id: Option<String>,
    pub variant_key: String,
    pub name_en: String,
    pub name_ru: Option<String>,
    pub icon_sha256: Option<String>,
    /// Раздел «Экономики» (`currency`, `gems`…); `null` — нет в справочнике.
    pub category: Option<String>,
    pub quantity: u32,
    /// Цена за штуку в момент снапшота; `null` — цены не было.
    pub unit_chaos: Option<f64>,
    /// Цена за штуку сейчас (та же лига); `null` — нет.
    pub current_unit_chaos: Option<f64>,
    pub reliable: bool,
    /// Цена ровно этого варианта, а не ближайшего.
    pub exact: bool,
    /// Почему нет цены: «нет цены в лиге», «нет в справочнике», «неопознанный уникальный».
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashSnapshotDetail {
    pub snapshot: StashSnapshot,
    pub tabs: Vec<StashSnapshotTab>,
    pub rows: Vec<StashRow>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct CachedTabs {
    tabs: Vec<StashTab>,
    fetched_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    account: Option<String>,
    /// Лига → вкладки.
    tabs: HashMap<String, CachedTabs>,
    /// Лига → выбранные вкладки; лиги нет — все, кроме скрытых.
    selected: HashMap<String, Vec<String>>,
}

struct Inner {
    settings: Settings,
    has_session: bool,
    job: Option<StashJob>,
    error: Option<String>,
    limits: Vec<Rule>,
}

pub struct StashService {
    inner: Mutex<Inner>,
    /// Клиент живёт между действиями: в нём счёт лимитов сайта.
    client: Mutex<Option<PoeClient>>,
    store: Mutex<Option<SnapshotStore>>,
    cancel: AtomicBool,
    settings_path: PathBuf,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

fn stored_session() -> Option<String> {
    keyring_entry()?.get_password().ok().filter(|t| !t.is_empty())
}

pub fn start(app: &AppHandle, paths: &AppPaths) {
    let settings_path = paths.file(SETTINGS_FILE);
    let settings: Settings = fs::read(&settings_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let has_session = stored_session().is_some();
    let (store, error) = match SnapshotStore::open(&paths.file("user.db")) {
        Ok(s) => (Some(s), None),
        Err(e) => (None, Some(e)),
    };
    app.manage(StashService {
        inner: Mutex::new(Inner { settings, has_session, job: None, error, limits: Vec::new() }),
        client: Mutex::new(None),
        store: Mutex::new(store),
        cancel: AtomicBool::new(false),
        settings_path,
    });
}

impl StashService {
    fn status(&self, league: Option<String>) -> StashStatus {
        let inner = self.inner.lock().unwrap();
        let cached = league.as_ref().and_then(|l| inner.settings.tabs.get(l));
        let tabs = cached.map(|c| c.tabs.clone()).unwrap_or_default();
        let selected = selected_ids(&inner.settings, league.as_deref(), &tabs);
        StashStatus {
            connected: inner.has_session && inner.settings.account.is_some(),
            account: inner.settings.account.clone(),
            league,
            tabs,
            tabs_fetched_at: cached.map(|c| c.fetched_at),
            selected,
            job: inner.job.clone(),
            error: inner.error.clone(),
            limits: inner.limits.clone(),
        }
    }

    fn save_settings(&self, settings: &Settings) {
        if let Ok(bytes) = serde_json::to_vec_pretty(settings) {
            let _ = write_atomic(&self.settings_path, &bytes);
        }
    }

    fn update(&self, f: impl FnOnce(&mut Inner)) {
        let mut inner = self.inner.lock().unwrap();
        f(&mut inner);
    }
}

/// Вкладки, содержимое которых старый интерфейс сайта не отдаёт (`items: []`, проверено 22.11.2026
/// на вкладке карт: приходит только пустой `mapLayout`).
pub const OPAQUE_KINDS: [&str; 2] = ["MapStash", "UniqueStash"];

/// Выбор вкладок лиги; не выбирали — все, кроме скрытых и непрозрачных. Пропавшие вкладки отбрасываются.
fn selected_ids(settings: &Settings, league: Option<&str>, tabs: &[StashTab]) -> Vec<String> {
    match league.and_then(|l| settings.selected.get(l)) {
        Some(ids) => ids.iter().filter(|id| tabs.is_empty() || tabs.iter().any(|t| &t.id == *id)).cloned().collect(),
        None => tabs.iter().filter(|t| !t.hidden && !OPAQUE_KINDS.contains(&t.kind.as_str())).map(|t| t.id.clone()).collect(),
    }
}

fn emit(app: &AppHandle) {
    let league = app.state::<PricesService>().league();
    let status = app.state::<StashService>().status(league);
    let _ = app.emit(EVENT, status);
}

/// Вкладки сайта (с папками) → плоский список без самих папок.
fn flatten_tabs(raw: &[RawTab], out: &mut Vec<StashTab>) {
    for tab in raw {
        if !tab.children.is_empty() {
            flatten_tabs(&tab.children, out);
        }
        let Some(index) = tab.i else { continue };
        if tab.kind == "Folder" || tab.id.is_empty() {
            continue;
        }
        out.push(StashTab {
            id: tab.id.clone(),
            index,
            name: if tab.n.is_empty() { format!("Вкладка {}", index + 1) } else { tab.n.clone() },
            kind: tab.kind.clone(),
            colour: tab.colour.as_ref().map(|c| format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)),
            hidden: tab.hidden,
        });
    }
}

/// Общая обвязка действия: одно за раз, `job` в статусе, ошибка — в статус и ответ.
fn run_job<T>(app: &AppHandle, kind: StashJobKind, work: impl FnOnce(&AppHandle) -> Result<T, String>) -> Result<T, String> {
    let service = app.state::<StashService>();
    {
        let mut inner = service.inner.lock().unwrap();
        if inner.job.is_some() {
            return Err("тайник уже загружается — дождитесь конца".into());
        }
        inner.job = Some(StashJob { kind, done: 0, total: 0, tab: None, wait_seconds: None });
        inner.error = None;
    }
    service.cancel.store(false, Ordering::SeqCst);
    emit(app);
    let result = work(app);
    service.update(|inner| {
        inner.job = None;
        if let Err(e) = &result {
            inner.error = Some(e.clone());
        }
    });
    emit(app);
    result
}

/// Ждать `wait`, показывая обратный отсчёт; `false` — отменили.
fn sleep_with_countdown(app: &AppHandle, wait: Duration) -> bool {
    let service = app.state::<StashService>();
    let end = Instant::now() + wait;
    let mut last_shown = u64::MAX;
    while Instant::now() < end {
        if service.cancel.load(Ordering::SeqCst) {
            return false;
        }
        let left = (end - Instant::now()).as_secs();
        if wait >= Duration::from_secs(3) && left != last_shown {
            last_shown = left;
            service.update(|inner| {
                if let Some(job) = inner.job.as_mut() {
                    job.wait_seconds = Some(left + 1);
                }
            });
            emit(app);
        }
        std::thread::sleep(Duration::from_millis(250).min(end - Instant::now()));
    }
    service.update(|inner| {
        if let Some(job) = inner.job.as_mut() {
            job.wait_seconds = None;
        }
    });
    true
}

/// Один запрос вкладки с соблюдением лимитов: ждём сами до `MAX_WAIT`, после 429 — один повтор.
fn fetch_tab(app: &AppHandle, client: &mut PoeClient, account: &str, league: &str, index: u32, with_tabs: bool) -> Result<client::StashResponse, String> {
    let service = app.state::<StashService>();
    for attempt in 0..2 {
        let wait = client.wait_before(STASH_POLICY);
        if wait > MAX_WAIT {
            return Err(PoeError::RateLimited(wait.as_secs()).to_string());
        }
        if !wait.is_zero() && !sleep_with_countdown(app, wait) {
            return Err("отменено".into());
        }
        let result = client.stash(account, league, index, with_tabs);
        let limits = client.stash_rules();
        service.update(|inner| inner.limits = limits);
        match result {
            Ok(r) => return Ok(r),
            Err(PoeError::RateLimited(seconds)) if attempt == 0 && Duration::from_secs(seconds) <= MAX_WAIT => {
                if !sleep_with_countdown(app, Duration::from_secs(seconds)) {
                    return Err("отменено".into());
                }
            }
            Err(PoeError::Unauthorized) => {
                return Err(PoeError::Unauthorized.to_string());
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(PoeError::RateLimited(60).to_string())
}

fn with_client<T>(app: &AppHandle, f: impl FnOnce(&mut PoeClient) -> Result<T, String>) -> Result<T, String> {
    let service = app.state::<StashService>();
    let mut guard = service.client.lock().unwrap();
    if guard.is_none() {
        let session = stored_session().ok_or("сессия PoE не сохранена — подключите аккаунт заново")?;
        *guard = Some(PoeClient::new(&session));
    }
    f(guard.as_mut().unwrap())
}

fn current_league(app: &AppHandle) -> Result<String, String> {
    app.state::<PricesService>().league().ok_or_else(|| "лига не выбрана — выберите её в шапке".to_string())
}

fn store_tabs(app: &AppHandle, league: &str, tabs: Vec<StashTab>) {
    let service = app.state::<StashService>();
    let settings = {
        let mut inner = service.inner.lock().unwrap();
        inner.settings.tabs.insert(league.to_string(), CachedTabs { tabs, fetched_at: now_ms() });
        inner.settings.clone()
    };
    service.save_settings(&settings);
}

// ---------------------------------------------------------------------------------------------
// Команды

#[tauri::command]
pub fn stash_status(app: AppHandle) -> StashStatus {
    let league = app.state::<PricesService>().league();
    app.state::<StashService>().status(league)
}

/// Подключить аккаунт: кука `POESESSID` (можно целиком `POESESSID=…`) и, если не определилось само,
/// имя аккаунта. Проверка — список вкладок текущей лиги; после неё сессия уходит в keyring.
#[tauri::command]
pub async fn stash_connect(app: AppHandle, session: String, account: Option<String>) -> Result<StashStatus, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_job(&handle, StashJobKind::Connect, |app| {
            let session = normalize_session(&session).ok_or("POESESSID — 32 знака 0–9 и a–f (значение куки с www.pathofexile.com)")?;
            let mut client = PoeClient::new(&session);
            let account = match account.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) {
                Some(a) => a,
                None => client
                    .detect_account()
                    .map_err(|e| e.to_string())?
                    .ok_or("не удалось определить имя аккаунта — укажите его вручную, как на сайте: Name#1234")?,
            };
            let league = current_league(app)?;
            let tabs = match fetch_tab(app, &mut client, &account, &league, 0, true) {
                Ok(response) => {
                    let mut tabs = Vec::new();
                    flatten_tabs(&response.tabs, &mut tabs);
                    Some(tabs)
                }
                // У аккаунта нет тайника в этой лиге — подключение всё равно верное.
                Err(e) if e.starts_with("сайт PoE:") => None,
                Err(e) => return Err(e),
            };
            keyring_entry().ok_or("диспетчер учётных данных Windows недоступен")?.set_password(&session).map_err(|e| format!("сессия не сохранена: {e}"))?;
            let service = app.state::<StashService>();
            *service.client.lock().unwrap() = Some(client);
            let settings = {
                let mut inner = service.inner.lock().unwrap();
                inner.has_session = true;
                if inner.settings.account.as_deref() != Some(account.as_str()) {
                    inner.settings.tabs.clear();
                    inner.settings.selected.clear();
                }
                inner.settings.account = Some(account);
                inner.settings.clone()
            };
            service.save_settings(&settings);
            if let Some(tabs) = tabs {
                store_tabs(app, &league, tabs);
            }
            Ok(())
        })?;
        Ok(stash_status(handle))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Забыть сессию. Снапшоты остаются.
#[tauri::command]
pub fn stash_disconnect(app: AppHandle) {
    if let Some(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    let service = app.state::<StashService>();
    *service.client.lock().unwrap() = None;
    service.update(|inner| {
        inner.has_session = false;
        inner.error = None;
    });
    emit(&app);
}

/// Список вкладок лиги заново (один запрос к сайту).
#[tauri::command]
pub async fn stash_refresh_tabs(app: AppHandle) -> Result<Vec<StashTab>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_job(&app, StashJobKind::Tabs, |app| {
            let league = current_league(app)?;
            let account = app.state::<StashService>().inner.lock().unwrap().settings.account.clone().ok_or("аккаунт не подключён")?;
            let response = with_client(app, |client| fetch_tab(app, client, &account, &league, 0, true))?;
            let mut tabs = Vec::new();
            flatten_tabs(&response.tabs, &mut tabs);
            store_tabs(app, &league, tabs.clone());
            Ok(tabs)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stash_select(app: AppHandle, tab_ids: Vec<String>) -> Result<(), String> {
    let league = current_league(&app)?;
    let service = app.state::<StashService>();
    let settings = {
        let mut inner = service.inner.lock().unwrap();
        inner.settings.selected.insert(league, tab_ids);
        inner.settings.clone()
    };
    service.save_settings(&settings);
    emit(&app);
    Ok(())
}

#[tauri::command]
pub fn stash_cancel(service: State<StashService>) {
    service.cancel.store(true, Ordering::SeqCst);
}

/// Снять снапшот выбранных вкладок: загрузить, оценить по текущим ценам, сохранить.
#[tauri::command]
pub async fn stash_take_snapshot(app: AppHandle) -> Result<StashSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || run_job(&app, StashJobKind::Snapshot, take_snapshot)).await.map_err(|e| e.to_string())?
}

fn take_snapshot(app: &AppHandle) -> Result<StashSnapshot, String> {
    let league = current_league(app)?;
    let prices = app.state::<PricesService>();
    let prices_status = prices.status();
    if prices_status.state != PricesState::Ready || prices_status.count == 0 {
        return Err(format!("цен лиги {league} ещё нет — дождитесь загрузки цен"));
    }
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let service = app.state::<StashService>();
    let (account, cached, selected) = {
        let inner = service.inner.lock().unwrap();
        let account = inner.settings.account.clone().ok_or("аккаунт не подключён")?;
        let cached = inner.settings.tabs.get(&league).map(|c| c.tabs.clone()).unwrap_or_default();
        let selected = selected_ids(&inner.settings, Some(&league), &cached);
        (account, cached, selected)
    };
    if !cached.is_empty() && selected.is_empty() {
        return Err("не выбрано ни одной вкладки".into());
    }

    // Первый запрос — первая выбранная вкладка вместе со свежим списком вкладок: номера могли
    // поменяться, а id постоянные.
    let first_index = selected.first().and_then(|id| cached.iter().find(|t| &t.id == id)).map_or(0, |t| t.index);
    let progress = |done: u32, total: u32, tab: Option<String>| {
        service.update(|inner| {
            if let Some(job) = inner.job.as_mut() {
                job.done = done;
                job.total = total;
                job.tab = tab;
            }
        });
        emit(app);
    };
    progress(0, selected.len().max(1) as u32, None);
    let first = with_client(app, |client| fetch_tab(app, client, &account, &league, first_index, true))?;
    let mut tabs = Vec::new();
    flatten_tabs(&first.tabs, &mut tabs);
    store_tabs(app, &league, tabs.clone());
    let selected = {
        let inner = service.inner.lock().unwrap();
        selected_ids(&inner.settings, Some(&league), &tabs)
    };
    let wanted: Vec<StashTab> = tabs.iter().filter(|t| selected.contains(&t.id)).cloned().collect();
    if wanted.is_empty() {
        return Err("выбранных вкладок больше нет в тайнике — выберите вкладки заново".into());
    }
    let total = wanted.len() as u32;
    let mut fetched: HashMap<String, Vec<Value>> = HashMap::new();
    if let Some(tab) = tabs.iter().find(|t| t.index == first_index) {
        fetched.insert(tab.id.clone(), first.items);
    }
    let mut done = wanted.iter().filter(|t| fetched.contains_key(&t.id)).count() as u32;
    progress(done, total, None);
    for tab in &wanted {
        if fetched.contains_key(&tab.id) {
            continue;
        }
        if service.cancel.load(Ordering::SeqCst) {
            return Err("отменено".into());
        }
        progress(done, total, Some(tab.name.clone()));
        let response = with_client(app, |client| fetch_tab(app, client, &account, &league, tab.index, false))?;
        fetched.insert(tab.id.clone(), response.items);
        done += 1;
        progress(done, total, Some(tab.name.clone()));
    }

    let divine = prices_status.divine_chaos;
    let (tab_records, row_records) = value_tabs(&catalog, &prices, &wanted, &fetched);
    let snapshot = SnapshotRecord {
        id: 0,
        league: league.clone(),
        account: account.clone(),
        taken_at: now_ms() as i64,
        total_chaos: tab_records.iter().map(|t| t.total_chaos).sum(),
        divine_chaos: divine,
        tabs: tab_records.len() as u32,
        priced: tab_records.iter().map(|t| t.priced).sum(),
        unpriced: tab_records.iter().map(|t| t.unpriced).sum(),
        skipped: tab_records.iter().map(|t| t.skipped).sum(),
        prices_updated: prices_status.newest_update.clone(),
    };
    let id = {
        let mut guard = service.store.lock().unwrap();
        let store = guard.as_mut().ok_or("user.db недоступна — снапшот не сохранён")?;
        store.insert(&snapshot, &tab_records, &row_records)?
    };
    Ok(to_snapshot(&SnapshotRecord { id, ..snapshot }))
}

/// Оценка загруженных вкладок: строки сложены по (вкладка, предмет, вариант).
fn value_tabs(catalog: &Catalog, prices: &PricesService, tabs: &[StashTab], fetched: &HashMap<String, Vec<Value>>) -> (Vec<TabRecord>, Vec<RowRecord>) {
    let lookup = |id: &str| prices.variants(id);
    let mut tab_records = Vec::new();
    let mut rows: Vec<RowRecord> = Vec::new();
    for tab in tabs {
        let Some(items) = fetched.get(&tab.id) else { continue };
        let mut valued = Vec::new();
        for item in items {
            value_all(catalog, &lookup, item, &mut valued);
        }
        let mut record = TabRecord {
            tab_id: tab.id.clone(),
            tab_index: tab.index,
            name: tab.name.clone(),
            kind: tab.kind.clone(),
            colour: tab.colour.clone(),
            total_chaos: 0.0,
            priced: 0,
            unpriced: 0,
            skipped: 0,
        };
        let mut index: HashMap<(Option<String>, String, String), usize> = HashMap::new();
        let start = rows.len();
        for v in valued {
            let (item_id, variant_key, name, quantity, unit, reliable, exact, note) = match v {
                Valued::Skipped => {
                    record.skipped += 1;
                    continue;
                }
                Valued::Priced { item_id, variant_key, name, quantity, unit, reliable, exact } => {
                    record.priced += 1;
                    record.total_chaos += unit * quantity as f64;
                    (Some(item_id), variant_key, name, quantity, Some(unit), reliable, exact, None)
                }
                Valued::NoPrice { item_id, name, quantity, reason } => {
                    record.unpriced += 1;
                    (item_id, String::new(), name, quantity, None, false, false, Some(reason))
                }
            };
            let key = (item_id.clone(), variant_key.clone(), if item_id.is_none() { name.clone() } else { String::new() });
            match index.get(&key) {
                Some(&i) => rows[start + i].quantity += quantity,
                None => {
                    index.insert(key, rows.len() - start);
                    rows.push(RowRecord { tab_id: tab.id.clone(), item_id, variant_key, name, quantity, unit_chaos: unit, reliable, exact, note });
                }
            }
        }
        tab_records.push(record);
    }
    (tab_records, rows)
}

fn to_snapshot(r: &SnapshotRecord) -> StashSnapshot {
    StashSnapshot {
        id: r.id,
        league: r.league.clone(),
        taken_at: r.taken_at,
        total_chaos: r.total_chaos,
        divine_chaos: r.divine_chaos,
        tabs: r.tabs,
        priced: r.priced,
        unpriced: r.unpriced,
        skipped: r.skipped,
        prices_updated: r.prices_updated.clone(),
    }
}

/// Снапшоты подключённого аккаунта в текущей лиге, от старых к новым.
#[tauri::command]
pub fn stash_snapshots(app: AppHandle) -> Result<Vec<StashSnapshot>, String> {
    let Some(league) = app.state::<PricesService>().league() else { return Ok(Vec::new()) };
    let service = app.state::<StashService>();
    let Some(account) = service.inner.lock().unwrap().settings.account.clone() else { return Ok(Vec::new()) };
    let guard = service.store.lock().unwrap();
    let store = guard.as_ref().ok_or("user.db недоступна")?;
    Ok(store.list(&account, &league)?.iter().map(to_snapshot).collect())
}

/// Снапшот целиком: вкладки и предметы; у предметов — и цена сейчас.
#[tauri::command]
pub fn stash_snapshot_detail(app: AppHandle, id: i64) -> Result<StashSnapshotDetail, String> {
    let service = app.state::<StashService>();
    let (snapshot, tabs, rows) = {
        let guard = service.store.lock().unwrap();
        let store = guard.as_ref().ok_or("user.db недоступна")?;
        let snapshot = store.get(id)?.ok_or("снапшот не найден")?;
        (snapshot, store.tabs(id)?, store.rows(id)?)
    };
    let prices = app.state::<PricesService>();
    let same_league = prices.league().as_deref() == Some(snapshot.league.as_str());
    let catalog = app.state::<DatasetService>().catalog();
    let chaos_id = catalog.as_ref().and_then(|c| c.by_trade_id("chaos")).map(|c| c.id.clone());
    let rows = rows
        .into_iter()
        .map(|r| {
            let entry = catalog.as_ref().zip(r.item_id.as_deref()).and_then(|(c, id)| c.get(id));
            let current = match r.item_id.as_deref() {
                Some(id) if same_league && chaos_id.as_deref() == Some(id) => Some(1.0),
                Some(id) if same_league => prices.variants(id).into_iter().find(|p| p.variant_key == r.variant_key).map(|p| p.chaos_value),
                _ => None,
            };
            StashRow {
                tab_id: r.tab_id,
                item_id: r.item_id.clone(),
                variant_key: r.variant_key,
                name_en: entry.map_or_else(|| r.name.clone(), |e| e.name.en.clone()),
                name_ru: entry.and_then(|e| e.name.ru.clone()),
                icon_sha256: entry.and_then(|e| e.icon_sha256.clone()),
                category: entry.map(|e| crate::economy::category_of(e).to_string()),
                quantity: r.quantity,
                unit_chaos: r.unit_chaos,
                current_unit_chaos: current,
                reliable: r.reliable,
                exact: r.exact,
                note: r.note,
            }
        })
        .collect();
    Ok(StashSnapshotDetail {
        snapshot: to_snapshot(&snapshot),
        tabs: tabs
            .into_iter()
            .map(|t| StashSnapshotTab {
                id: t.tab_id,
                index: t.tab_index,
                name: t.name,
                kind: t.kind,
                colour: t.colour,
                total_chaos: t.total_chaos,
                priced: t.priced,
                unpriced: t.unpriced,
                skipped: t.skipped,
            })
            .collect(),
        rows,
    })
}

/// Отладка: ответ сайта по вкладке `index` как есть — в `stash-debug\tab-<index>.json`; путь файла.
#[tauri::command]
pub async fn stash_debug_tab(app: AppHandle, index: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let league = current_league(&app)?;
        let account = app.state::<StashService>().inner.lock().unwrap().settings.account.clone().ok_or("аккаунт не подключён")?;
        let text = with_client(&app, |client| {
            let wait = client.wait_before(STASH_POLICY);
            std::thread::sleep(wait.min(MAX_WAIT));
            client.stash_raw(&account, &league, index).map_err(|e| e.to_string())
        })?;
        let dir = app.state::<AppPaths>().file("stash-debug");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("tab-{index}.json"));
        fs::write(&path, text).map_err(|e| e.to_string())?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Отладка: оценка сохранённого `stash-debug\tab-<index>.json` без запросов к сайту — итог и строки.
#[tauri::command]
pub fn stash_debug_value(app: AppHandle, index: u32) -> Result<Value, String> {
    let path = app.state::<AppPaths>().file("stash-debug").join(format!("tab-{index}.json"));
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let response: client::StashResponse = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let prices = app.state::<PricesService>();
    let tab = StashTab { id: "debug".into(), index, name: format!("tab {index}"), kind: String::new(), colour: None, hidden: false };
    let fetched = HashMap::from([(tab.id.clone(), response.items)]);
    let (tabs, rows) = value_tabs(&catalog, &prices, std::slice::from_ref(&tab), &fetched);
    let t = &tabs[0];
    Ok(serde_json::json!({
        "total": t.total_chaos, "priced": t.priced, "unpriced": t.unpriced, "skipped": t.skipped,
        "rows": rows.iter().map(|r| format!("{} x{} {:?} {}", r.name, r.quantity, r.unit_chaos, r.note.clone().unwrap_or_default())).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn stash_snapshot_delete(service: State<StashService>, id: i64) -> Result<(), String> {
    let guard = service.store.lock().unwrap();
    guard.as_ref().ok_or("user.db недоступна")?.delete(id)
}
