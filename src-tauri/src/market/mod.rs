//! Помощь в оценке билдов (план shared/docs/build-price-tracking.md, 4.4, шаг T6): фоновый
//! «искатель» берёт у сервера задания пула (`POST /v1/market/lease`), ищет на сайте торговли с
//! IP пользователя без входа и отправляет найденные предложения (`POST /v1/market/reports`).
//!
//! Работает, только если пользователь вошёл, у него есть право `builds.track` (`/v1/me`) и
//! «Помогать оценивать билды» включено в настройках. Бюджет — поисков в час (по умолчанию 30);
//! поиски человека в браузере главнее: правило лимита сайта, использованное на 2/3, — пауза до
//! конца его окна. 429 — пауза на `Retry-After`, задания возвращаются в пул.
//! Отслеживание билдов и цены — `tracking.rs` (шаг T7).

pub mod trade_client;
pub mod tracking;

use std::collections::VecDeque;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::account::{send_signed_in_raw, AccountService, AccountState, SignedInError};
use crate::api::{ApiErrorKind, Call};
use trade_client::{report_json, TradeClient, TradeError};

pub const EVENT: &str = "market-status";

/// Право, без которого сервер не выдаёт заданий.
const PERMISSION: &str = "builds.track";
/// Без заданий — спросить снова через столько.
const IDLE_POLL: Duration = Duration::from_secs(120);
/// Право перечитывается так часто (роль могут выдать или отнять).
const PERMISSION_TTL: Duration = Duration::from_secs(30 * 60);
/// Между поисками не меньше.
const SEARCH_GAP: Duration = Duration::from_secs(3);
/// Заданий за раз.
const LEASE_CAPACITY: u32 = 2;
/// Дольше этого ждать лимит сайта, держа аренду, нельзя: вернуть задания в пул.
const MAX_HOLD_WAIT: u64 = 300;
/// Поиски за последние сутки — для строки состояния.
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
const HOUR: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MarketState {
    /// Выключено в настройках.
    Disabled,
    SignedOut,
    /// У аккаунта нет права `builds.track`.
    NotAllowed,
    /// Ждёт заданий или бюджета.
    Idle,
    Searching,
    /// Лимит сайта: до `pausedUntil`.
    Paused,
    /// Нет связи с сервером.
    Offline,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MarketStatus {
    pub state: MarketState,
    pub enabled: bool,
    pub budget_per_hour: u32,
    /// Право `builds.track` по последнему `/v1/me`; null — ещё не знаем.
    pub allowed: Option<bool>,
    pub searches_last_hour: u32,
    pub searches_today: u32,
    /// Пауза из-за лимита сайта, мс с эпохи.
    pub paused_until: Option<u64>,
    pub last_error: Option<String>,
}

/// Настройки из интерфейса: `invoke("market_configure", { settings })`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSettings {
    pub enabled: bool,
    pub budget_per_hour: u32,
}

struct Inner {
    status: MarketStatus,
    searches: VecDeque<Instant>,
    permission_checked: Option<Instant>,
    paused_until: Option<Instant>,
}

pub struct MarketService {
    inner: Mutex<Inner>,
    wake: Sender<()>,
}

impl MarketService {
    /// Искать сейчас («Оценить сейчас», включили помощь).
    pub fn wake(&self) {
        let _ = self.wake.send(());
    }

    /// Право `builds.track` по последней проверке.
    pub fn allowed(&self) -> Option<bool> {
        self.inner.lock().unwrap().status.allowed
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn start(app: &AppHandle) {
    let (wake, wakes) = mpsc::channel();
    app.manage(MarketService {
        inner: Mutex::new(Inner {
            status: MarketStatus {
                state: MarketState::Disabled,
                enabled: false,
                budget_per_hour: 30,
                allowed: None,
                searches_last_hour: 0,
                searches_today: 0,
                paused_until: None,
                last_error: None,
            },
            searches: VecDeque::new(),
            permission_checked: None,
            paused_until: None,
        }),
        wake,
    });
    let app = app.clone();
    let _ = thread::Builder::new().name("market".into()).spawn(move || {
        let mut client = TradeClient::new("build price helper");
        loop {
            let wait = step(&app, &mut client);
            match wakes.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            // Несколько пробуждений подряд — один шаг.
            while wakes.try_recv().is_ok() {}
        }
    });
}

fn update(app: &AppHandle, change: impl FnOnce(&mut Inner)) {
    let service = app.state::<MarketService>();
    let status = {
        let mut inner = service.inner.lock().unwrap();
        change(&mut inner);
        let now = Instant::now();
        while inner.searches.front().is_some_and(|at| now.duration_since(*at) > DAY) {
            inner.searches.pop_front();
        }
        inner.status.searches_today = inner.searches.len() as u32;
        inner.status.searches_last_hour = inner.searches.iter().filter(|at| now.duration_since(**at) <= HOUR).count() as u32;
        inner.status.paused_until = inner.paused_until.filter(|until| *until > now).map(|until| now_ms() + until.duration_since(now).as_millis() as u64);
        inner.status.clone()
    };
    let _ = app.emit(EVENT, status);
}

fn set_state(app: &AppHandle, state: MarketState, error: Option<String>) {
    update(app, |inner| {
        inner.status.state = state;
        if error.is_some() || state != MarketState::Offline {
            inner.status.last_error = error;
        }
    });
}

/// Один шаг искателя; возвращает, сколько ждать до следующего.
fn step(app: &AppHandle, client: &mut TradeClient) -> Duration {
    let service = app.state::<MarketService>();
    let (enabled, budget) = {
        let inner = service.inner.lock().unwrap();
        (inner.status.enabled, inner.status.budget_per_hour)
    };
    if app.state::<AccountService>().status().state != AccountState::SignedIn {
        update(app, |inner| {
            inner.status.allowed = None;
            inner.permission_checked = None;
        });
        set_state(app, MarketState::SignedOut, None);
        return IDLE_POLL;
    }
    if let Err(wait) = check_permission(app) {
        return wait;
    }
    if !enabled || budget == 0 {
        set_state(app, MarketState::Disabled, None);
        return IDLE_POLL;
    }
    let paused = app.state::<MarketService>().inner.lock().unwrap().paused_until.filter(|until| *until > Instant::now());
    if let Some(until) = paused {
        set_state(app, MarketState::Paused, None);
        return until.saturating_duration_since(Instant::now()).max(Duration::from_secs(1));
    }
    let used = app.state::<MarketService>().inner.lock().unwrap().searches.iter().filter(|at| at.elapsed() <= HOUR).count() as u32;
    if used >= budget {
        set_state(app, MarketState::Idle, None);
        // Следующее место в бюджете — когда самый старый поиск часа выйдет из окна.
        let oldest = app.state::<MarketService>().inner.lock().unwrap().searches.iter().find(|at| at.elapsed() <= HOUR).copied();
        return oldest.map(|at| HOUR.saturating_sub(at.elapsed()) + Duration::from_secs(1)).unwrap_or(IDLE_POLL);
    }
    let capacity = LEASE_CAPACITY.min(budget - used);
    let tasks: Value = match send_signed_in_raw(app, || Call::post("/v1/market/lease", json!({ "capacity": capacity }))) {
        Ok(value) => value,
        Err(e) => return failed_request(app, e),
    };
    let tasks = tasks.get("tasks").and_then(Value::as_array).cloned().unwrap_or_default();
    if tasks.is_empty() {
        set_state(app, MarketState::Idle, None);
        return IDLE_POLL;
    }
    set_state(app, MarketState::Searching, None);

    let mut reports = Vec::new();
    let mut paused_for: Option<u64> = None;
    for task in &tasks {
        let lease_id = task.get("leaseId").and_then(Value::as_str).unwrap_or_default();
        let league = task.get("league").and_then(Value::as_str).unwrap_or_default();
        let payload = task.get("payload").cloned().unwrap_or(Value::Null);
        let searched_at = iso_now();
        if let Some(wait) = paused_for {
            reports.push(report_json(lease_id, &searched_at, Err(&TradeError::RateLimited(wait))));
            continue;
        }
        let wait = client.search_wait();
        if wait > MAX_HOLD_WAIT {
            paused_for = Some(wait);
            reports.push(report_json(lease_id, &searched_at, Err(&TradeError::RateLimited(wait))));
            continue;
        }
        let gap = app.state::<MarketService>().inner.lock().unwrap().searches.back().map(|at| SEARCH_GAP.saturating_sub(at.elapsed())).unwrap_or_default();
        thread::sleep(gap.max(Duration::from_secs(wait)));
        update(app, |inner| inner.searches.push_back(Instant::now()));
        let outcome = client.quote(league, &payload);
        match &outcome {
            Err(TradeError::RateLimited(wait)) => paused_for = Some(*wait),
            Err(TradeError::Failed(message)) => update(app, |inner| inner.status.last_error = Some(message.clone())),
            Ok(_) => {}
        }
        reports.push(match outcome {
            Ok(found) => report_json(lease_id, &searched_at, Ok(found)),
            Err(e) => report_json(lease_id, &searched_at, Err(&e)),
        });
    }

    if let Some(wait) = paused_for {
        update(app, |inner| inner.paused_until = Some(Instant::now() + Duration::from_secs(wait)));
    }
    if let Err(e) = send_signed_in_raw::<Value>(app, || Call::post("/v1/market/reports", json!({ "reports": reports }))) {
        return failed_request(app, e);
    }
    if paused_for.is_some() {
        set_state(app, MarketState::Paused, Some("лимит сайта торговли — пауза".into()));
        return Duration::from_secs(paused_for.unwrap_or(60));
    }
    // Заданий могло остаться ещё — сразу следующий шаг (бюджет и пауза между поисками проверятся).
    Duration::from_secs(1)
}

/// Право `builds.track`: из кэша или `/v1/me`. Ошибка — сколько ждать до следующего шага.
fn check_permission(app: &AppHandle) -> Result<(), Duration> {
    let fresh = app.state::<MarketService>().inner.lock().unwrap().permission_checked.is_some_and(|at| at.elapsed() < PERMISSION_TTL);
    if !fresh {
        match send_signed_in_raw::<Value>(app, || Call::get("/v1/me")) {
            Ok(me) => {
                let allowed = me.get("permissions").and_then(Value::as_array).is_some_and(|list| list.iter().any(|p| p.as_str() == Some(PERMISSION)));
                update(app, |inner| {
                    inner.status.allowed = Some(allowed);
                    inner.permission_checked = Some(Instant::now());
                });
            }
            Err(e) => return Err(failed_request(app, e)),
        }
    }
    if app.state::<MarketService>().allowed() == Some(false) {
        set_state(app, MarketState::NotAllowed, None);
        return Err(IDLE_POLL);
    }
    Ok(())
}

fn failed_request(app: &AppHandle, error: SignedInError) -> Duration {
    let offline = matches!(&error, SignedInError::Api(e) if matches!(e.kind, ApiErrorKind::Network | ApiErrorKind::Timeout | ApiErrorKind::Unconfigured));
    if let SignedInError::Api(e) = &error {
        // Право отняли: сервер отвечает 403 — перечитать /v1/me.
        if e.status == Some(403) {
            update(app, |inner| inner.permission_checked = None);
        }
    }
    set_state(app, if offline { MarketState::Offline } else { MarketState::Idle }, Some(error.message()));
    IDLE_POLL
}

fn iso_now() -> String {
    let ms = now_ms();
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, (rem % 3600) / 60, rem % 60, ms % 1000)
}

/// Дни от 1970-01-01 → дата (алгоритм Говарда Хиннанта).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[tauri::command]
pub fn market_status(service: State<MarketService>) -> MarketStatus {
    service.inner.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn market_configure(app: AppHandle, settings: MarketSettings) {
    update(&app, |inner| {
        inner.status.enabled = settings.enabled;
        inner.status.budget_per_hour = settings.budget_per_hour.min(60);
    });
    app.state::<MarketService>().wake();
}
