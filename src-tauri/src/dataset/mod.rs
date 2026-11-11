//! Набор данных (справочник предметов): загрузка с сервера, кэш на диске, справочник в памяти.
//!
//! Поток `dataset-sync`:
//! 1. при запуске поднимает текущий набор из кэша — приложение работает и без сети;
//! 2. спрашивает `GET /v1/bootstrap`; набор новый — качает файлы по ссылкам манифеста,
//!    проверяет sha256 и размер, ставит целиком и делает текущим (`store.rs`);
//! 3. повторяет раз в час, после ошибки — раз в минуту, и сразу — по `dataset_check_now`
//!    или когда сервер снова на связи.
//!
//! Интерфейсу — событие `dataset-status` и команды ниже; при смене набора ещё `dataset-updated`.

mod catalog;
pub mod model;
mod store;

use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::api::{Api, ApiCode, Call, Reply};
pub use catalog::{normalize, Catalog};
use catalog::{
    has_file, parse_ascendancies, parse_crafting, parse_map_search, parse_trade_stats, ASCENDANCIES_FILE, CRAFTING_FILE, MAP_SEARCH_FILE, TRADE_STATS_FILE,
};
use model::{Ascendancy, Bootstrap, CatalogItem, ItemClass, ManifestCounts, ManifestIcons, MapSearch, SCHEMA_VERSION};
pub use store::sha256_hex;
use store::{verify, DatasetStore};

pub const EVENT: &str = "dataset-status";
pub const EVENT_UPDATED: &str = "dataset-updated";

const REFRESH: Duration = Duration::from_secs(60 * 60);
const RETRY: Duration = Duration::from_secs(60);
const FILE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DatasetState {
    /// Кэша нет, первая проверка ещё идёт.
    Loading,
    /// Справочник есть (из кэша или только что скачан).
    Ready,
    /// Справочника нет: кэша нет, скачать не удалось. Нужна сеть.
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DatasetSource {
    /// Поднят с диска; сервер мог и не ответить.
    Cache,
    /// Скачан в этом запуске.
    Network,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DatasetStatus {
    pub state: DatasetState,
    /// Идёт проверка или загрузка.
    pub syncing: bool,
    pub dataset_id: Option<String>,
    pub generated_at: Option<String>,
    pub counts: Option<ManifestCounts>,
    pub source: Option<DatasetSource>,
    /// Конец последней проверки, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    /// Ошибка последней проверки (при `ready` — работаем с кэшем).
    pub error: Option<String>,
}

struct Inner {
    status: DatasetStatus,
    catalog: Option<Arc<Catalog>>,
}

pub struct DatasetService {
    inner: Mutex<Inner>,
    wake: Mutex<Sender<()>>,
}

impl DatasetService {
    /// Текущий справочник; `None`, пока его нет.
    pub fn catalog(&self) -> Option<Arc<Catalog>> {
        self.inner.lock().unwrap().catalog.clone()
    }

    pub fn status(&self) -> DatasetStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// Откуда качать иконки — из манифеста текущего набора.
    pub fn icons(&self) -> Option<ManifestIcons> {
        self.catalog().map(|c| c.manifest.icons.clone())
    }

    /// Проверить набор сейчас, не дожидаясь часа.
    pub fn wake(&self) {
        let _ = self.wake.lock().unwrap().send(());
    }
}

pub fn start(app: &AppHandle, app_root: &Path) {
    let (tx, rx) = mpsc::channel();
    let status = DatasetStatus {
        state: DatasetState::Loading,
        syncing: false,
        dataset_id: None,
        generated_at: None,
        counts: None,
        source: None,
        checked_at: None,
        error: None,
    };
    app.manage(DatasetService { inner: Mutex::new(Inner { status, catalog: None }), wake: Mutex::new(tx) });

    let store = DatasetStore::new(app_root);
    let app = app.clone();
    thread::Builder::new().name("dataset-sync".into()).spawn(move || run(app, store, rx)).expect("spawn dataset sync");
}

fn run(app: AppHandle, store: DatasetStore, wake: Receiver<()>) {
    let service = app.state::<DatasetService>();

    if let Some(id) = store.current_id() {
        match Catalog::load(&store, &id) {
            Ok(catalog) => set_catalog(&service, catalog, DatasetSource::Cache),
            Err(e) => service.inner.lock().unwrap().status.error = Some(format!("кэш набора {id} не прочитан: {e}")),
        }
    }
    publish(&app, &service);

    loop {
        service.inner.lock().unwrap().status.syncing = true;
        publish(&app, &service);

        let current = service.catalog().map(|c| c.manifest.dataset_id.clone());
        let api = app.state::<Arc<Api>>().inner().clone();
        let outcome = sync(&api, &store, current.as_deref());

        let updated = matches!(outcome, Ok(Some(_)));
        let failed = outcome.is_err();
        {
            let mut inner = service.inner.lock().unwrap();
            inner.status.error = outcome.as_ref().err().cloned();
            inner.status.syncing = false;
            inner.status.checked_at = Some(now_ms());
        }
        if let Ok(Some(catalog)) = outcome {
            set_catalog(&service, catalog, DatasetSource::Network);
        }
        {
            let mut inner = service.inner.lock().unwrap();
            inner.status.state = if inner.catalog.is_some() { DatasetState::Ready } else { DatasetState::Missing };
        }
        publish(&app, &service);
        if updated {
            let _ = app.emit(EVENT_UPDATED, service.status());
            store.cleanup();
        }

        let has_catalog = service.catalog().is_some();
        let interval = if failed || !has_catalog { RETRY } else { REFRESH };
        match wake.recv_timeout(interval) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn set_catalog(service: &DatasetService, catalog: Catalog, source: DatasetSource) {
    let mut inner = service.inner.lock().unwrap();
    inner.status.state = DatasetState::Ready;
    inner.status.dataset_id = Some(catalog.manifest.dataset_id.clone());
    inner.status.generated_at = Some(catalog.manifest.generated_at.clone());
    inner.status.counts = Some(catalog.manifest.counts.clone());
    inner.status.source = Some(source);
    inner.catalog = Some(Arc::new(catalog));
}

/// Одна проверка: `Ok(Some)` — скачан и поставлен новый набор, `Ok(None)` — текущий актуален.
fn sync(api: &Api, store: &DatasetStore, current: Option<&str>) -> Result<Option<Catalog>, String> {
    let manifest = match api.send::<Bootstrap>(Call::get("/v1/bootstrap")) {
        Ok(Reply::Fresh { value, .. }) => value.dataset,
        Ok(Reply::NotModified { .. }) => return Ok(None),
        Err(e) if e.has(ApiCode::DatasetNotFound) => return Err("сервер ещё не опубликовал ни одного набора данных".into()),
        Err(e) => return Err(e.message),
    };
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!("формат набора данных {} не поддерживается — обновите приложение", manifest.schema_version));
    }
    if current == Some(manifest.dataset_id.as_str()) {
        return Ok(None);
    }

    let mut files = Vec::with_capacity(manifest.files.len());
    for file in &manifest.files {
        let bytes = api.download(&file.url, FILE_TIMEOUT).map_err(|e| format!("{}: {}", file.name, e.message))?;
        verify(&file.name, &bytes, file.size, &file.sha256)?;
        files.push((file.name.clone(), bytes));
    }
    // Разбираем до установки: битый JSON не должен стать текущим набором.
    let file = |name: &str| files.iter().find(|(n, _)| n == name).map(|(_, b)| b.as_slice()).ok_or_else(|| format!("в наборе нет {name}"));
    let items: Vec<CatalogItem> = serde_json::from_slice(file("items.json")?).map_err(|e| format!("items.json не разобран: {e}"))?;
    let classes: Vec<ItemClass> = serde_json::from_slice(file("classes.json")?).map_err(|e| format!("classes.json не разобран: {e}"))?;
    // Необязательный файл: не разобран — набор всё равно ставим, ошибку увидит вкладка.
    let map_search = has_file(&manifest, MAP_SEARCH_FILE).then(|| file(MAP_SEARCH_FILE).and_then(parse_map_search));
    let crafting = has_file(&manifest, CRAFTING_FILE).then(|| file(CRAFTING_FILE).and_then(parse_crafting));
    let ascendancies = has_file(&manifest, ASCENDANCIES_FILE).then(|| file(ASCENDANCIES_FILE).and_then(parse_ascendancies));
    let trade_stats = has_file(&manifest, TRADE_STATS_FILE).then(|| file(TRADE_STATS_FILE).and_then(parse_trade_stats));

    store.install(&manifest, &files).map_err(|e| format!("набор не сохранён: {e}"))?;
    Ok(Some(Catalog::new(manifest, items, classes, map_search, crafting, ascendancies, trade_stats)))
}

fn publish(app: &AppHandle, service: &DatasetService) {
    let _ = app.emit(EVENT, service.status());
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `invoke("dataset_status")`.
#[tauri::command]
pub fn dataset_status(service: State<DatasetService>) -> DatasetStatus {
    service.status()
}

/// Проверить набор сейчас.
#[tauri::command]
pub fn dataset_check_now(service: State<DatasetService>) {
    service.wake();
}

/// Поиск по справочнику (русские и английские названия). Пусто, пока справочника нет.
#[tauri::command]
pub fn catalog_search(service: State<DatasetService>, query: String, limit: Option<u32>) -> Vec<CatalogItem> {
    let limit = limit.unwrap_or(20).min(200) as usize;
    service.catalog().map(|c| c.search(&query, limit).into_iter().cloned().collect()).unwrap_or_default()
}

/// Записи справочника по id сайта торговли (`chaos`, `divine`…): иконки валют, курс.
#[tauri::command]
pub fn catalog_by_trade_ids(service: State<DatasetService>, trade_ids: Vec<String>) -> Vec<CatalogItem> {
    let Some(catalog) = service.catalog() else { return Vec::new() };
    trade_ids.iter().filter_map(|id| catalog.by_trade_id(id).cloned()).collect()
}

/// Запись справочника по id.
#[tauri::command]
pub fn catalog_item(service: State<DatasetService>, id: String) -> Option<CatalogItem> {
    service.catalog().and_then(|c| c.get(&id).cloned())
}

/// Моды и свойства карт для вкладки «RegEx карт». `null` — справочника ещё нет или в наборе нет
/// `map-search.json` (старый набор — обновить набор данных); ошибка — файл есть, но не прочитан
/// (формат новее приложения — обновить приложение).
#[tauri::command]
pub fn catalog_map_search(service: State<DatasetService>) -> Result<Option<MapSearch>, String> {
    service.catalog().and_then(|c| c.map_search.clone()).transpose()
}

/// Портреты классов и восхождений для вкладки «Билды». Пусто — справочника ещё нет, в наборе нет
/// `ascendancies.json` или он не прочитан: тогда вкладка рисует монограммы.
#[tauri::command]
pub fn catalog_ascendancies(service: State<DatasetService>) -> Vec<Ascendancy> {
    service.catalog().and_then(|c| c.ascendancies.as_ref().and_then(|a| a.as_ref().ok().cloned())).unwrap_or_default()
}
