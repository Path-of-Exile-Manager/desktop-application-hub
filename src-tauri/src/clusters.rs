//! «Выгодные кластеры»: цели крафта кластерных самоцветов лиги и их планы.
//!
//! План функции — `shared/docs/cluster-crafting.md`. Сервер отдаёт цели (`GET
//! /v1/crafting/clusters/:league`: спрос с poe.ninja и цена цели на сайте торговли), набор
//! данных — `crafting.json` (данные игры), прайс лиги — цены валюты, ископаемых и баз. Ядро
//! считает план каждой цели движком `craft-engine`: какую базу купить и каким методом крафтить.
//!
//! Поток `clusters`: лига — та же, что у цен (`prices_set_league`); ответ сервера с ETag и кэшем
//! на диске (`clusters\<лига>.json` + `.etag`), раз в 10 минут, после ошибки — раз в минуту,
//! сразу — по `clusters_refresh`. Пересчёт — когда меняются цели, цены лиги или набор данных,
//! в нескольких потоках (`cluster_plans.rs`). Событие `clusters-status`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use ts_rs::TS;

use crate::api::{Api, Call, Reply};
use crate::cluster_plans::{compute, ClusterDemand, ClusterDetail, ClusterName, ClusterRow, ClustersReply, Computed, MarketData};
use crate::dataset::{self, Catalog, DatasetService};
use crate::paths::write_atomic;
use crate::prices::{self, encode_segment, PricesService};

pub const EVENT: &str = "clusters-status";
const REFRESH: Duration = Duration::from_secs(10 * 60);
const RETRY: Duration = Duration::from_secs(60);
const TIMEOUT: Duration = Duration::from_secs(60);

/// Прайс и справочник приложения для расчёта.
struct LiveData<'a> {
    prices: &'a PricesService,
    catalog: &'a Catalog,
}

impl MarketData for LiveData<'_> {
    fn chaos(&self, item_id: &str) -> Option<f64> {
        self.prices.chaos(item_id)
    }

    fn variants(&self, item_id: &str) -> Vec<(String, f64)> {
        self.prices.variants(item_id).into_iter().map(|p| (p.variant_key, p.chaos_value)).collect()
    }

    fn item_name(&self, item_id: &str) -> Option<ClusterName> {
        self.catalog.get(item_id).map(|item| ClusterName { en: item.name.en.clone(), ru: item.name.ru.clone() })
    }
}

// ---------- состояние ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ClustersState {
    /// Лига не выбрана.
    Idle,
    /// Кэша нет, первая загрузка идёт.
    Loading,
    /// Цели есть (из кэша или с сервера).
    Ready,
    /// Целей нет: кэша нет, сервер не ответил или лиги у него нет.
    Missing,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClustersStatus {
    pub league: Option<String>,
    pub state: ClustersState,
    pub syncing: bool,
    pub computing: bool,
    /// Сервер следит за лигой; `false` — целей не будет, пока её не включат в админке.
    pub tracked: Option<bool>,
    pub demand: Option<ClusterDemand>,
    pub targets: u32,
    /// Целей с планом.
    pub planned: u32,
    /// Целей с прибылью больше нуля.
    pub profitable: u32,
    /// Конец последнего запроса, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    pub computed_at: Option<u64>,
    pub compute_ms: Option<u64>,
    pub error: Option<String>,
    /// Почему не считается: нет `crafting.json`, он не прочитан, нет цен лиги.
    pub engine_error: Option<String>,
}

struct Inner {
    status: ClustersStatus,
    reply: Option<Arc<ClustersReply>>,
    etag: Option<String>,
    /// Увеличивается при каждом новом ответе сервера: часть версии расчёта.
    reply_version: u64,
    computed: Option<Arc<Computed>>,
    /// Из чего посчитан `computed`.
    computed_from: Option<String>,
}

enum Wake {
    /// Спросить сервер сейчас.
    Refresh,
    /// Могли измениться цены, набор или лига: проверить, нужен ли пересчёт.
    Changed,
}

pub struct ClustersService {
    inner: Mutex<Inner>,
    wake: Mutex<Sender<Wake>>,
    root: PathBuf,
}

impl ClustersService {
    fn status(&self) -> ClustersStatus {
        self.inner.lock().unwrap().status.clone()
    }

    fn send(&self, wake: Wake) {
        let _ = self.wake.lock().unwrap().send(wake);
    }

    fn cache_files(&self, league: &str) -> (PathBuf, PathBuf) {
        let name: String = league.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
        let dir = self.root.join("clusters");
        (dir.join(format!("{name}.json")), dir.join(format!("{name}.etag")))
    }
}

fn idle_status(league: Option<String>) -> ClustersStatus {
    ClustersStatus {
        state: if league.is_some() { ClustersState::Loading } else { ClustersState::Idle },
        league,
        syncing: false,
        computing: false,
        tracked: None,
        demand: None,
        targets: 0,
        planned: 0,
        profitable: 0,
        checked_at: None,
        computed_at: None,
        compute_ms: None,
        error: None,
        engine_error: None,
    }
}

pub fn start(app: &AppHandle, app_root: &Path) {
    let (tx, rx) = mpsc::channel();
    let inner = Inner { status: idle_status(None), reply: None, etag: None, reply_version: 0, computed: None, computed_from: None };
    app.manage(ClustersService { inner: Mutex::new(inner), wake: Mutex::new(tx), root: app_root.to_path_buf() });

    // Цены и набор данных меняются в своих потоках: просыпаемся по их событиям.
    for event in [prices::EVENT, dataset::EVENT_UPDATED] {
        let handle = app.clone();
        app.listen_any(event, move |_| handle.state::<ClustersService>().send(Wake::Changed));
    }

    let app = app.clone();
    thread::Builder::new().name("clusters".into()).spawn(move || run(app, rx)).expect("spawn clusters");
}

fn run(app: AppHandle, wake: Receiver<Wake>) {
    let service = app.state::<ClustersService>();
    let mut next_fetch: Option<Instant> = None;

    loop {
        let league = app.state::<PricesService>().league();
        let switched = service.inner.lock().unwrap().status.league != league;

        if switched {
            switch_league(&service, league.as_deref());
            next_fetch = Some(Instant::now());
            publish(&app, &service);
        }

        if let Some(league) = &league {
            if next_fetch.is_some_and(|at| at <= Instant::now()) {
                let failed = fetch(&app, &service, league);
                next_fetch = Some(Instant::now() + if failed { RETRY } else { REFRESH });
            }
            compute_if_needed(&app, &service, league);
        }

        let timeout = next_fetch.map(|at| at.saturating_duration_since(Instant::now()));
        let received = match timeout {
            Some(timeout) => wake.recv_timeout(timeout),
            None => wake.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };

        match received {
            Ok(Wake::Refresh) => next_fetch = Some(Instant::now()),
            Ok(Wake::Changed) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Новая лига: сброс и её кэш с диска, чтобы список был сразу.
fn switch_league(service: &ClustersService, league: Option<&str>) {
    let cached = league.and_then(|league| {
        let (json, etag) = service.cache_files(league);
        let reply = fs::read(&json).ok().and_then(|b| serde_json::from_slice::<ClustersReply>(&b).ok()).filter(|r| r.league == league)?;
        Some((reply, fs::read_to_string(&etag).ok().map(|s| s.trim().to_string())))
    });
    let mut inner = service.inner.lock().unwrap();

    inner.status = idle_status(league.map(str::to_owned));
    inner.computed = None;
    inner.computed_from = None;
    inner.reply_version += 1;
    inner.reply = None;
    inner.etag = None;

    if let Some((reply, etag)) = cached {
        set_reply(&mut inner, reply, etag);
    }
}

fn set_reply(inner: &mut Inner, reply: ClustersReply, etag: Option<String>) {
    inner.status.state = ClustersState::Ready;
    inner.status.tracked = Some(reply.tracked);
    inner.status.demand = reply.demand.clone();
    inner.status.targets = reply.targets.len() as u32;
    inner.reply = Some(Arc::new(reply));
    inner.etag = etag;
    inner.reply_version += 1;
}

/// Запрос к серверу; `true` — не удался.
fn fetch(app: &AppHandle, service: &ClustersService, league: &str) -> bool {
    let etag = {
        let mut inner = service.inner.lock().unwrap();
        inner.status.syncing = true;
        inner.etag.clone()
    };
    publish(app, service);

    let api = app.state::<Arc<Api>>().inner().clone();
    let mut call = Call::get(format!("/v1/crafting/clusters/{}", encode_segment(league))).timeout(TIMEOUT);
    if let Some(etag) = etag {
        call = call.if_none_match(etag);
    }
    let result = api.send::<ClustersReply>(call);

    if service.inner.lock().unwrap().status.league.as_deref() != Some(league) {
        return false;
    }

    let failed = result.is_err();
    {
        let mut inner = service.inner.lock().unwrap();
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
                set_reply(&mut inner, value, meta.etag);
                inner.status.error = None;
            }
            Ok(Reply::NotModified { .. }) => inner.status.error = None,
            Err(e) => inner.status.error = Some(e.message),
        }
        inner.status.syncing = false;
        inner.status.checked_at = Some(now_ms());
        if inner.reply.is_none() {
            inner.status.state = ClustersState::Missing;
        }
    }
    publish(app, service);
    failed
}

/// Пересчёт, если изменились цели, цены лиги или набор данных.
fn compute_if_needed(app: &AppHandle, service: &ClustersService, league: &str) {
    let catalog = app.state::<DatasetService>().catalog();
    let prices = app.state::<PricesService>();
    let (reply, reply_version, computed_from) = {
        let inner = service.inner.lock().unwrap();
        (inner.reply.clone(), inner.reply_version, inner.computed_from.clone())
    };
    let Some(reply) = reply else { return };
    let engine = match catalog.as_ref().map(|c| c.crafting.clone()) {
        Some(Some(Ok(engine))) => Ok(engine),
        Some(Some(Err(e))) => Err(e),
        Some(None) => Err("в наборе данных нет crafting.json — обновите набор данных".to_owned()),
        None => Err("справочник ещё не загружен".to_owned()),
    };
    let prices_version = prices.version();
    let engine_error = match (&engine, &prices_version) {
        (Err(e), _) => Some(e.clone()),
        (Ok(_), None) => Some("нет цен лиги".to_owned()),
        _ => None,
    };

    if let Some(error) = engine_error {
        let changed = {
            let mut inner = service.inner.lock().unwrap();
            let changed = inner.status.engine_error.as_ref() != Some(&error);
            inner.status.engine_error = Some(error);
            changed
        };
        if changed {
            publish(app, service);
        }
        return;
    }

    let (Ok(engine), Some(prices_version), Some(catalog)) = (engine, prices_version, catalog) else { return };
    let source = format!("{reply_version}|{prices_version}|{}", catalog.manifest.dataset_id);

    if computed_from.as_deref() == Some(source.as_str()) {
        return;
    }

    {
        let mut inner = service.inner.lock().unwrap();
        inner.status.computing = true;
        inner.status.engine_error = None;
    }
    publish(app, service);

    let started = Instant::now();
    let computed = compute(&engine, &LiveData { prices: &prices, catalog: &catalog }, &reply);
    let elapsed = started.elapsed().as_millis() as u64;

    let mut inner = service.inner.lock().unwrap();
    inner.status.computing = false;

    // Пока считали, лигу сменили или пришёл новый ответ: результат устарел, посчитаем снова.
    if inner.status.league.as_deref() == Some(league) && inner.reply_version == reply_version {
        inner.status.planned = computed.rows.iter().filter(|row| row.best.is_some()).count() as u32;
        inner.status.profitable = computed.rows.iter().filter(|row| row.best.as_ref().and_then(|b| b.profit).is_some_and(|p| p > 0.0)).count() as u32;
        inner.status.computed_at = Some(now_ms());
        inner.status.compute_ms = Some(elapsed);
        inner.computed = Some(Arc::new(computed));
        inner.computed_from = Some(source);
    }
    drop(inner);
    publish(app, service);
}

fn publish(app: &AppHandle, service: &ClustersService) {
    let _ = app.emit(EVENT, service.status());
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `invoke("clusters_status")`.
#[tauri::command]
pub fn clusters_status(service: State<ClustersService>) -> ClustersStatus {
    service.status()
}

/// Спросить сервер сейчас (цели и цены сайта торговли).
#[tauri::command]
pub fn clusters_refresh(service: State<ClustersService>) {
    service.send(Wake::Refresh);
}

/// Посчитанные цели текущей лиги: самые играемые сначала. Пусто, пока не посчитаны.
#[tauri::command]
pub fn clusters_list(service: State<ClustersService>) -> Vec<ClusterRow> {
    service.inner.lock().unwrap().computed.as_ref().map(|c| c.rows.clone()).unwrap_or_default()
}

/// Цель целиком: все методы и подходящие энчанты.
#[tauri::command]
pub fn cluster_detail(service: State<ClustersService>, key: String) -> Option<ClusterDetail> {
    service.inner.lock().unwrap().computed.as_ref().and_then(|c| c.details.get(&key).cloned())
}
