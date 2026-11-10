//! Данные расширения браузера в `user.db` (Ф10, `shared/docs/extension-bridge.md`, этап 3):
//! папки, закладки, история и пины. Расширение присылает изменения записей с временем `at`,
//! десктоп отвечает снимком; правки десктопа и сервера уходят расширению снимком же (`data.changed`).
//!
//! Правила, общие с сервером:
//! - изменение из расширения старше последнего изменения записи здесь (правка, приход с сервера,
//!   удаление — надгробия хранятся 90 дней) не применяется: иначе удалённое воскреснет из очереди;
//! - формы записей — как в `/v1/sync`, проверка — `records::check`;
//! - первое подключение: папка расширения с тем же отпечатком (название + набор поисков), что и
//!   папка здесь, склеивается с ней — повторное первое подключение не плодит дубли.

use std::collections::{BTreeSet, HashMap};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::records;
use super::sort_key;
use super::store::Store;
use super::{changed, RejectedRecord, SyncService};

/// Коллекции, которые видит расширение (настройки и watchlist — только у десктопа).
pub const COLLECTIONS: [&str; 4] = ["folders", "bookmarks", "history", "pins"];

/// Снимок не должен выйти за кадр Native Messaging (1 МиБ) — с запасом на конверт.
const MAX_SNAPSHOT_BYTES: usize = 1000 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub collection: String,
    pub id: String,
    /// `null` — запись удалена.
    pub record: Option<Value>,
    /// Когда изменили в расширении, мс.
    pub at: i64,
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// Отпечаток папки: название и набор поисков, без порядка.
fn fingerprint<'a>(title: &str, bookmarks: impl Iterator<Item = &'a Value>) -> String {
    let searches: BTreeSet<String> = bookmarks.map(|b| format!("{}:{}", text(b, "tradeType"), text(b, "slug"))).collect();
    format!("{}|{}", title.trim().to_lowercase(), searches.into_iter().collect::<Vec<_>>().join(","))
}

/// Ключ порядка папки или закладки из расширения совпал с ключом соседа (профили, ещё не видевшие
/// друг друга, выдают новым записям одни и те же `P`, `g`…) — поставить запись сразу за соседом.
/// Иначе её не сдвинуть: между двумя равными ключами места нет (`sort_key::between` откажет).
fn unique_sort_key(store: &Store, collection: &str, id: &str, mut value: Value) -> Value {
    if collection != "folders" && collection != "bookmarks" {
        return value;
    }
    let key = text(&value, "sortKey");
    let folder = text(&value, "folderId");
    let siblings: Vec<String> = store
        .list(collection)
        .unwrap_or_default()
        .iter()
        .filter(|r| text(r, "id") != id && (collection == "folders" || text(r, "folderId") == folder))
        .map(|r| text(r, "sortKey"))
        .collect();
    if !siblings.contains(&key) {
        return value;
    }
    // Ближайший больший ключ — граница сверху: между ним и нашим других соседей нет.
    let next = siblings.iter().filter(|k| **k > key).min();
    if let Ok(fresh) = sort_key::between(Some(&key), next.map(String::as_str)) {
        value["sortKey"] = json!(fresh);
    }
    value
}

/// Все записи для расширения. Если снимок не влезает в кадр — без самых старых пинов.
pub fn snapshot(app: &AppHandle) -> Value {
    let service = app.state::<SyncService>();
    let store = service.store.lock().unwrap();
    let list = |c: &str| store.list(c).unwrap_or_default();
    let mut pins = list("pins");
    pins.sort_by_key(|p| std::cmp::Reverse(text(p, "pinnedAt")));
    let mut value = json!({
        "revision": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        "folders": list("folders"),
        "bookmarks": list("bookmarks"),
        "history": list("history"),
        "pins": pins,
    });
    while value.to_string().len() > MAX_SNAPSHOT_BYTES {
        let Some(pins) = value["pins"].as_array_mut().filter(|p| !p.is_empty()) else { break };
        pins.pop();
        value["truncated"] = json!(true);
    }
    value
}

/// Применить изменения из расширения. `first` — первое подключение (`baseRevision: null`).
/// Возвращает отвергнутые записи (неверные по правилам сервера).
pub fn apply(app: &AppHandle, mut changes: Vec<Change>, first: bool) -> Vec<RejectedRecord> {
    let service = app.state::<SyncService>();
    let mut rejected = Vec::new();
    let mut touched: Option<String> = None;
    // Папки раньше закладок: закладке нужна папка (и, при склейке, её новый id).
    changes.sort_by_key(|c| COLLECTIONS.iter().position(|x| *x == c.collection).unwrap_or(usize::MAX));
    {
        let store = service.store.lock().unwrap();

        // Первое подключение: папка расширения → папка здесь с тем же отпечатком.
        let mut folder_map: HashMap<String, String> = HashMap::new();
        let mut desktop_searches: HashMap<String, BTreeSet<String>> = HashMap::new();
        if first {
            let folders = store.list("folders").unwrap_or_default();
            let bookmarks = store.list("bookmarks").unwrap_or_default();
            let mut by_print: HashMap<String, String> = HashMap::new();
            for f in &folders {
                let id = text(f, "id");
                let inside: Vec<&Value> = bookmarks.iter().filter(|b| text(b, "folderId") == id).collect();
                desktop_searches.insert(id.clone(), inside.iter().map(|b| format!("{}:{}", text(b, "tradeType"), text(b, "slug"))).collect());
                by_print.insert(fingerprint(&text(f, "title"), inside.into_iter()), id);
            }
            for c in changes.iter().filter(|c| c.collection == "folders") {
                let Some(record) = &c.record else { continue };
                if store.get("folders", &c.id).is_some() {
                    continue;
                }
                let inside = changes.iter().filter(|b| b.collection == "bookmarks").filter_map(|b| b.record.as_ref()).filter(|b| text(b, "folderId") == c.id);
                if let Some(target) = by_print.get(&fingerprint(&text(record, "title"), inside)) {
                    folder_map.insert(c.id.clone(), target.clone());
                }
            }
        }

        for change in changes {
            let collection = change.collection.as_str();
            if !COLLECTIONS.contains(&collection) {
                rejected.push(RejectedRecord { collection: change.collection.clone(), id: change.id.clone(), reason: "коллекция не синхронизируется с расширением".into() });
                continue;
            }
            // Склеенная папка уже есть здесь.
            if collection == "folders" && folder_map.contains_key(&change.id) {
                continue;
            }
            let mut record = change.record;
            if collection == "bookmarks"
                && let Some(r) = record.as_mut()
                    && let Some(target) = folder_map.get(&text(r, "folderId")) {
                        let key = format!("{}:{}", text(r, "tradeType"), text(r, "slug"));
                        // Такой поиск в склеенной папке уже есть.
                        if desktop_searches.get(target).is_some_and(|s| s.contains(&key)) {
                            continue;
                        }
                        r["folderId"] = json!(target);
                    }
            // Здесь запись менялась позже — изменение из расширения устарело.
            if store.last_change(collection, &change.id).ok().flatten().is_some_and(|last| last > change.at) {
                continue;
            }
            match record {
                Some(value) => match records::check(collection, value) {
                    Ok(value) => {
                        if records::id_of(&value) != Some(change.id.as_str()) {
                            rejected.push(RejectedRecord { collection: change.collection, id: change.id, reason: "id записи не совпадает".into() });
                            continue;
                        }
                        let value = unique_sort_key(&store, collection, &change.id, value);
                        if store.get(collection, &change.id).as_ref() == Some(&value) {
                            continue;
                        }
                        if let Err(e) = store.put_local(collection, &change.id, &value) {
                            rejected.push(RejectedRecord { collection: change.collection, id: change.id, reason: e });
                            continue;
                        }
                        touched = Some(collection.to_string());
                    }
                    Err(reason) => rejected.push(RejectedRecord { collection: change.collection, id: change.id, reason }),
                },
                None => {
                    if store.delete_local(collection, &change.id).unwrap_or(false) {
                        touched = Some(collection.to_string());
                    }
                }
            }
        }
    }
    if let Some(collection) = touched {
        changed(app, &collection);
    }
    rejected
}
