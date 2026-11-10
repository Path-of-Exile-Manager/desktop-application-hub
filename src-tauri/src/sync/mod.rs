//! Синхронизация данных пользователя с аккаунтом (`/v1/sync`, Ф8 плана интеграции).
//!
//! Данные живут в `user.db` (`store.rs`) и с аккаунтом, и без него; движок только сводит их с
//! сервером. Цикл (поток `sync`):
//!
//! ```text
//! pull since=курсор → применить (изменённое здесь не трогать)
//! push «грязных» пачками (≤1000 на коллекцию, ≤4 МБ) → отвергнутую запись отложить, остальные слать
//! pull с прежним курсором → применить (вернутся и свои записи — безопасно) → новый курсор
//! ```
//!
//! Запуск: при старте, при входе, через ~2 с после изменения здесь, раз в 5 минут и при появлении
//! связи. Первый вход: если и в аккаунте, и здесь есть данные — спросить «Объединить» или «Заменить».
//! Настройки (`settings`) движок принимает с сервера, но десктоп их пока не отправляет (8.6).

pub mod bridge;
mod records;
mod sort_key;
mod store;

use std::collections::BTreeMap;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::account::{send_signed_in_raw, AccountService, AccountState, SignedInError};
use crate::api::{ApiCode, ApiErrorKind, Call};
use crate::paths::AppPaths;
use records::COLLECTIONS;
use store::{DirtyRow, Store};

pub const EVENT: &str = "sync-status";

const INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Пауза после изменения здесь: серия правок уходит одной пачкой.
const DEBOUNCE: Duration = Duration::from_secs(2);
const MAX_PER_COLLECTION: usize = 1000;
/// Тело пачки: у сервера предел 5 МБ, берём с запасом.
const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;

const KEY_CURSOR: &str = "cursor";
const KEY_USER: &str = "user_id";
const KEY_CHOICE: &str = "first_sync_choice";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SyncState {
    /// Без аккаунта: данные только здесь.
    SignedOut,
    Idle,
    Syncing,
    /// Первый вход: и в аккаунте, и здесь есть данные — нужен выбор.
    NeedsChoice,
    /// Нет связи — попробуем позже.
    Offline,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SyncChoice {
    /// Отправить здешнее в аккаунт и взять оттуда остальное.
    Merge,
    /// Выбросить здешнее, взять данные аккаунта.
    Replace,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RejectedRecord {
    pub collection: String,
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncStatus {
    pub state: SyncState,
    /// Живые записи по коллекциям.
    pub counts: BTreeMap<String, u32>,
    /// Изменены здесь и ждут отправки.
    pub pending: u32,
    /// Отвергнуты сервером — не отправляются, пока их не изменят.
    pub rejected: Vec<RejectedRecord>,
    /// Ревизия аккаунта, до которой здешние данные сведены.
    pub revision: Option<i64>,
    /// Последняя удачная синхронизация, мс.
    pub last_synced_at: Option<u64>,
    /// Записей в аккаунте — для вопроса при первом входе.
    pub account_records: Option<u32>,
    pub error: Option<String>,
}

enum Wake {
    Now,
    /// Изменение здесь — после паузы.
    Soon,
}

pub struct SyncService {
    store: Mutex<Store>,
    status: Mutex<SyncStatus>,
    wake: Sender<Wake>,
}

impl SyncService {
    pub fn wake_now(&self) {
        let _ = self.wake.send(Wake::Now);
    }

    fn status(&self) -> SyncStatus {
        self.status.lock().unwrap().clone()
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn start(app: &AppHandle, paths: &AppPaths) -> Result<(), String> {
    let store = Store::open(&paths.file("user.db"))?;
    let (counts, pending) = store.counts()?;
    let status = SyncStatus {
        state: SyncState::SignedOut,
        counts,
        pending,
        rejected: Vec::new(),
        revision: store.state(KEY_CURSOR).and_then(|c| c.parse().ok()),
        last_synced_at: None,
        account_records: None,
        error: None,
    };
    let (wake, rx) = mpsc::channel();
    app.manage(SyncService { store: Mutex::new(store), status: Mutex::new(status), wake });

    let app = app.clone();
    thread::Builder::new()
        .name("sync".into())
        .spawn(move || {
            let mut next = Some(Wake::Now);
            loop {
                let msg = match next.take() {
                    Some(m) => Ok(m),
                    None => rx.recv_timeout(INTERVAL),
                };
                match msg {
                    Err(RecvTimeoutError::Disconnected) => return,
                    Ok(Wake::Soon) => {
                        // Дождаться конца серии правок; «сейчас» прерывает паузу.
                        loop {
                            match rx.recv_timeout(DEBOUNCE) {
                                Ok(Wake::Soon) => continue,
                                Ok(Wake::Now) | Err(RecvTimeoutError::Timeout) => break,
                                Err(RecvTimeoutError::Disconnected) => return,
                            }
                        }
                    }
                    Ok(Wake::Now) | Err(RecvTimeoutError::Timeout) => {}
                }
                run(&app);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn publish(app: &AppHandle, update: impl FnOnce(&mut SyncStatus)) {
    let service = app.state::<SyncService>();
    let snapshot = {
        let store = service.store.lock().unwrap();
        let mut status = service.status.lock().unwrap();
        update(&mut status);
        if let Ok((counts, pending)) = store.counts() {
            status.counts = counts;
            status.pending = pending;
        }
        status.rejected = store.rejected().unwrap_or_default().into_iter().map(|(collection, id, reason)| RejectedRecord { collection, id, reason }).collect();
        status.revision = store.state(KEY_CURSOR).and_then(|c| c.parse().ok());
        status.clone()
    };
    let _ = app.emit(EVENT, snapshot);
}

enum Failure {
    NeedsChoice(u32),
    Offline(String),
    Error(String),
}

impl From<SignedInError> for Failure {
    fn from(e: SignedInError) -> Self {
        match &e {
            SignedInError::Api(api) if matches!(api.kind, ApiErrorKind::Network | ApiErrorKind::Timeout | ApiErrorKind::RateLimited | ApiErrorKind::Unconfigured) => Failure::Offline(e.message()),
            SignedInError::Auth(m) if m.contains("связи") => Failure::Offline(m.clone()),
            _ => Failure::Error(e.message()),
        }
    }
}

fn run(app: &AppHandle) {
    let account = app.state::<AccountService>().status();
    let user_id = match (account.state, account.user) {
        (AccountState::SignedIn, Some(user)) => user.id,
        _ => {
            publish(app, |s| {
                s.state = SyncState::SignedOut;
                s.error = None;
                s.account_records = None;
            });
            return;
        }
    };
    // Другой аккаунт, чем в прошлый раз: здешние данные для него новые, курсор — с нуля.
    {
        let service = app.state::<SyncService>();
        let store = service.store.lock().unwrap();
        let last = store.state(KEY_USER);
        if last.as_deref() != Some(user_id.as_str()) {
            if last.is_some() {
                let _ = store.mark_all_dirty();
            }
            let _ = store.set_state(KEY_CURSOR, None);
            let _ = store.set_state(KEY_CHOICE, None);
            let _ = store.set_state(KEY_USER, Some(&user_id));
        }
    }
    publish(app, |s| {
        s.state = SyncState::Syncing;
        s.error = None;
    });
    match cycle(app) {
        Ok(()) => publish(app, |s| {
            s.state = SyncState::Idle;
            s.last_synced_at = Some(now_ms());
            s.account_records = None;
        }),
        Err(Failure::NeedsChoice(n)) => publish(app, |s| {
            s.state = SyncState::NeedsChoice;
            s.account_records = Some(n);
        }),
        Err(Failure::Offline(m)) => publish(app, |s| {
            s.state = SyncState::Offline;
            s.error = Some(m);
        }),
        Err(Failure::Error(m)) => publish(app, |s| {
            s.state = SyncState::Error;
            s.error = Some(m);
        }),
    }
}

#[derive(Deserialize)]
struct Pull {
    revision: i64,
    full: bool,
    #[serde(default)]
    upserts: BTreeMap<String, Vec<Value>>,
    #[serde(default)]
    deletes: BTreeMap<String, Vec<String>>,
}

impl Pull {
    fn upsert_count(&self) -> u32 {
        self.upserts.values().map(|v| v.len() as u32).sum()
    }
}

fn pull(app: &AppHandle, since: i64) -> Result<Pull, Failure> {
    Ok(send_signed_in_raw::<Pull>(app, || Call::get("/v1/sync").query("since", since.to_string()).timeout(Duration::from_secs(60)))?)
}

fn apply(app: &AppHandle, pull: &Pull) -> Result<(), Failure> {
    let service = app.state::<SyncService>();
    // Изменились ли данные, которые видит расширение: тогда отправить ему новый снимок.
    let mut bridge_changed = false;
    {
        let store = service.store.lock().unwrap();
        if pull.full {
            let records: Vec<(String, String, Value)> = pull
                .upserts
                .iter()
                .flat_map(|(c, list)| list.iter().filter_map(move |v| records::id_of(v).map(|id| (c.clone(), id.to_string(), v.clone()))))
                .collect();
            store.replace_clean(&records).map_err(Failure::Error)?;
            bridge_changed = true;
        } else {
            for (collection, list) in &pull.upserts {
                for value in list {
                    if let Some(id) = records::id_of(value) {
                        let changed = store.apply_upsert(collection, id, value).map_err(Failure::Error)?;
                        bridge_changed |= changed && bridge::COLLECTIONS.contains(&collection.as_str());
                    }
                }
            }
            for (collection, ids) in &pull.deletes {
                for id in ids {
                    let changed = store.apply_delete(collection, id).map_err(Failure::Error)?;
                    bridge_changed |= changed && bridge::COLLECTIONS.contains(&collection.as_str());
                }
            }
        }
        store.set_state(KEY_CURSOR, Some(&pull.revision.to_string())).map_err(Failure::Error)?;
    }
    if bridge_changed {
        crate::extension::data_changed(app);
    }
    Ok(())
}

fn cycle(app: &AppHandle) -> Result<(), Failure> {
    let service = app.state::<SyncService>();
    let cursor: Option<i64> = service.store.lock().unwrap().state(KEY_CURSOR).and_then(|c| c.parse().ok());
    let first = pull(app, cursor.unwrap_or(0))?;

    if cursor.is_none() && first.upsert_count() > 0 {
        let store = service.store.lock().unwrap();
        if store.has_unsynced().map_err(Failure::Error)? {
            match store.state(KEY_CHOICE).as_deref() {
                Some("merge") => {}
                Some("replace") => store.clear().map_err(Failure::Error)?,
                _ => return Err(Failure::NeedsChoice(first.upsert_count())),
            }
        }
    }
    apply(app, &first)?;
    service.store.lock().unwrap().set_state(KEY_CHOICE, None).map_err(Failure::Error)?;

    if push(app)? {
        // Свои же записи вернутся с новыми ревизиями — так курсор дойдёт до ревизии своей пачки.
        let second = pull(app, first.revision)?;
        apply(app, &second)?;
    }
    Ok(())
}

/// Одна пачка: тело запроса и какие строки в нём (по коллекции и номеру — для ошибки `-700002`).
struct Batch<'a> {
    upserts: Map<String, Value>,
    deletes: Map<String, Value>,
    rows: Vec<&'a DirtyRow>,
    bytes: usize,
}

fn batches(rows: &[DirtyRow]) -> Vec<Batch<'_>> {
    let mut out: Vec<Batch> = Vec::new();
    for row in rows {
        let size = row.data.as_ref().map(|d| d.to_string().len()).unwrap_or(row.id.len()) + 8;
        let fits = out.last().is_some_and(|b| {
            let kind = if row.data.is_some() { &b.upserts } else { &b.deletes };
            let used = kind.get(&row.collection).and_then(Value::as_array).map_or(0, Vec::len);
            used < MAX_PER_COLLECTION && b.bytes + size <= MAX_BATCH_BYTES
        });
        if !fits {
            out.push(Batch { upserts: Map::new(), deletes: Map::new(), rows: Vec::new(), bytes: 0 });
        }
        let batch = out.last_mut().expect("batch");
        let (target, item) = match &row.data {
            Some(data) => (&mut batch.upserts, data.clone()),
            None => (&mut batch.deletes, Value::String(row.id.clone())),
        };
        target.entry(row.collection.clone()).or_insert_with(|| Value::Array(Vec::new())).as_array_mut().expect("array").push(item);
        batch.rows.push(row);
        batch.bytes += size;
    }
    out
}

/// Строка пачки, на которую указывает поле ошибки: `upserts.bookmarks[3]`, `upserts.watchlist[0].itemId`,
/// `bookmarks:<id>` (`-700000`).
fn row_of<'a>(batch: &Batch<'a>, field: &str) -> Option<&'a DirtyRow> {
    if let Some((collection, id)) = field.split_once(':') {
        return batch.rows.iter().copied().find(|r| r.collection == collection && r.id == id);
    }
    let (kind, rest) = field.split_once('.')?;
    let (collection, rest) = rest.split_once('[')?;
    let index: usize = rest.split(']').next()?.parse().ok()?;
    let upsert = kind == "upserts";
    batch.rows.iter().copied().filter(|r| r.collection == collection && r.data.is_some() == upsert).nth(index)
}

/// Отправить всё изменённое здесь. `true` — что-то ушло.
fn push(app: &AppHandle) -> Result<bool, Failure> {
    let service = app.state::<SyncService>();
    let mut sent = false;
    // Каждый отказ откладывает одну запись, поэтому круг конечен.
    loop {
        let rows = service.store.lock().unwrap().dirty().map_err(Failure::Error)?;
        if rows.is_empty() {
            return Ok(sent);
        }
        let mut rejected_one = false;
        for batch in batches(&rows) {
            let body = json!({ "upserts": batch.upserts, "deletes": batch.deletes });
            match send_signed_in_raw::<Value>(app, || Call::post("/v1/sync", body.clone()).timeout(Duration::from_secs(60))) {
                Ok(_) => {
                    service.store.lock().unwrap().mark_pushed(&batch.rows).map_err(Failure::Error)?;
                    sent = true;
                }
                Err(SignedInError::Api(e)) if e.has(ApiCode::SyncRecordInvalid) || e.has(ApiCode::WatchlistItemNotFound) || e.has(ApiCode::SyncChangeConflict) => {
                    let culprit = e.errors.iter().find_map(|fe| fe.field.as_deref().and_then(|f| row_of(&batch, f)));
                    let Some(row) = culprit else { return Err(Failure::Error(e.message)) };
                    let reason = if e.has(ApiCode::WatchlistItemNotFound) { "предмета нет в справочнике сервера".to_string() } else { e.errors.first().map(|fe| fe.message.clone()).unwrap_or(e.message) };
                    service.store.lock().unwrap().mark_rejected(row, &reason).map_err(Failure::Error)?;
                    rejected_one = true;
                    // Остальные записи этой и следующих пачек — новым кругом, уже без отвергнутой.
                    break;
                }
                Err(e) => return Err(e.into()),
            }
        }
        if !rejected_one {
            return Ok(sent);
        }
    }
}

/// Изменение здесь: отправить на сервер после паузы, а если это данные расширения — и ему.
fn changed(app: &AppHandle, collection: &str) {
    let service = app.state::<SyncService>();
    let _ = service.wake.send(Wake::Soon);
    publish(app, |_| {});
    if bridge::COLLECTIONS.contains(&collection) {
        crate::extension::data_changed(app);
    }
}

#[tauri::command]
pub fn sync_status(service: State<SyncService>) -> SyncStatus {
    service.status()
}

#[tauri::command]
pub fn sync_now(service: State<SyncService>) {
    service.wake_now();
}

/// Ответ на вопрос первого входа.
#[tauri::command]
pub fn sync_resolve(service: State<SyncService>, choice: SyncChoice) -> Result<(), String> {
    let value = match choice {
        SyncChoice::Merge => "merge",
        SyncChoice::Replace => "replace",
    };
    service.store.lock().unwrap().set_state(KEY_CHOICE, Some(value))?;
    service.wake_now();
    Ok(())
}

/// Живые записи коллекции (`folders`, `bookmarks`, `history`, `pins`, `watchlist`, `settings`).
#[tauri::command]
pub fn sync_records(service: State<SyncService>, collection: String) -> Result<Vec<Value>, String> {
    if !COLLECTIONS.contains(&collection.as_str()) {
        return Err(format!("нет коллекции «{collection}»"));
    }
    service.store.lock().unwrap().list(&collection)
}

/// Создать или изменить запись. Без `id` — получит новый. Возвращает запись, как она сохранена.
#[tauri::command]
pub fn sync_put(app: AppHandle, service: State<SyncService>, collection: String, mut record: Value) -> Result<Value, String> {
    if collection == "settings" {
        return Err("настройки пока не синхронизируются".into());
    }
    if let Some(obj) = record.as_object_mut()
        && !obj.get("id").is_some_and(Value::is_string) {
            obj.insert("id".into(), Value::String(uuid::Uuid::now_v7().simple().to_string()));
        }
    let record = records::check(&collection, record)?;
    let id = records::id_of(&record).ok_or("у записи нет id")?.to_string();
    service.store.lock().unwrap().put_local(&collection, &id, &record)?;
    changed(&app, &collection);
    Ok(record)
}

#[tauri::command]
pub fn sync_delete(app: AppHandle, service: State<SyncService>, collection: String, id: String) -> Result<bool, String> {
    let deleted = service.store.lock().unwrap().delete_local(&collection, &id)?;
    if deleted {
        changed(&app, &collection);
    }
    Ok(deleted)
}

/// `sortKey` между двумя соседями (любой может отсутствовать).
#[tauri::command]
pub fn sync_sort_key_between(before: Option<String>, after: Option<String>) -> Result<String, String> {
    sort_key::between(before.as_deref(), after.as_deref())
}

