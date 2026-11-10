//! Записи синхронизируемых коллекций — те же формы, что `/v1/sync` (`apps/api-hub/src/interfaces/
//! sync/records.ts`), и те же правила, что сущности `packages/domain/src/sync/`: запись, которую
//! сервер отвергнет, не уходит из приложения. Запись хранится в том виде, что вернул `check`:
//! лишние поля отброшены, необязательные заданы явно.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::account::parse_iso_ms;

/// Коллекции в порядке отправки: папки раньше закладок.
pub const COLLECTIONS: [&str; 6] = ["folders", "bookmarks", "history", "pins", "watchlist", "settings"];

const MAX_JSON_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum TradeType {
    Search,
    Exchange,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Folder {
    id: String,
    title: String,
    icon: String,
    #[serde(default)]
    archived_at: Option<String>,
    sort_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bookmark {
    id: String,
    folder_id: String,
    title: String,
    trade_type: TradeType,
    slug: String,
    #[serde(default)]
    completed_at: Option<String>,
    sort_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    id: String,
    trade_type: TradeType,
    league: String,
    slug: String,
    is_live: bool,
    title: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pin {
    id: String,
    trade_type: TradeType,
    league: String,
    slug: String,
    search_title: String,
    item: Map<String, Value>,
    #[serde(default)]
    price: Option<Map<String, Value>>,
    #[serde(default)]
    seller: Option<Map<String, Value>>,
    pinned_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Watch {
    id: String,
    item_id: String,
    variant_key: String,
    #[serde(default)]
    league_id: Option<String>,
    #[serde(default)]
    note: Option<String>,
    added_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    id: String,
    data: Map<String, Value>,
    schema_version: u32,
}

fn record_id(field: &str, id: &str) -> Result<(), String> {
    if (1..=100).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        Ok(())
    } else {
        Err(format!("{field}: 1–100 символов из A-Z a-z 0-9 _ -"))
    }
}

/// Поиск в адресе сайта торговли: короткий id сохранённого поиска или весь запрос, упакованный
/// в адрес (`H4sI…`, gzip + base64url), — он растёт вместе с запросом, поэтому не id записи.
/// Правило сервера: `packages/domain/src/sync/rules.ts`.
fn trade_slug(value: &str) -> Result<(), String> {
    if (1..=2000).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        Ok(())
    } else {
        Err("slug: 1–2000 символов из A-Z a-z 0-9 _ -".into())
    }
}

fn text(field: &str, value: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > max {
        Err(format!("{field}: от 1 до {max} символов"))
    } else {
        Ok(())
    }
}

fn sort_key(value: &str) -> Result<(), String> {
    if (1..=64).contains(&value.len()) && value.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        Ok(())
    } else {
        Err("sortKey: 1–64 печатных символа ASCII".into())
    }
}

fn date(field: &str, value: &str) -> Result<(), String> {
    parse_iso_ms(value).map(|_| ()).ok_or_else(|| format!("{field}: не дата ISO"))
}

fn optional_date(field: &str, value: &Option<String>) -> Result<(), String> {
    value.as_deref().map_or(Ok(()), |v| date(field, v))
}

fn json_size(field: &str, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?.len();
    if bytes > MAX_JSON_BYTES {
        Err(format!("{field}: больше 64 КБ JSON"))
    } else {
        Ok(())
    }
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("запись не той формы: {e}"))
}

/// Проверить запись коллекции и привести к форме API. Ошибка — словами, с полем.
pub fn check(collection: &str, value: Value) -> Result<Value, String> {
    let out = match collection {
        "folders" => {
            let r: Folder = parse(value)?;
            record_id("id", &r.id)?;
            text("title", &r.title, 200)?;
            text("icon", &r.icon, 32)?;
            optional_date("archivedAt", &r.archived_at)?;
            sort_key(&r.sort_key)?;
            serde_json::to_value(r)
        }
        "bookmarks" => {
            let r: Bookmark = parse(value)?;
            record_id("id", &r.id)?;
            record_id("folderId", &r.folder_id)?;
            text("title", &r.title, 200)?;
            trade_slug(&r.slug)?;
            optional_date("completedAt", &r.completed_at)?;
            sort_key(&r.sort_key)?;
            serde_json::to_value(r)
        }
        "history" => {
            let r: History = parse(value)?;
            record_id("id", &r.id)?;
            text("league", &r.league, 100)?;
            trade_slug(&r.slug)?;
            text("title", &r.title, 200)?;
            date("createdAt", &r.created_at)?;
            serde_json::to_value(r)
        }
        "pins" => {
            let r: Pin = parse(value)?;
            record_id("id", &r.id)?;
            text("league", &r.league, 100)?;
            trade_slug(&r.slug)?;
            text("searchTitle", &r.search_title, 200)?;
            json_size("снимок пина", &serde_json::json!({ "item": r.item, "price": r.price, "seller": r.seller }))?;
            date("pinnedAt", &r.pinned_at)?;
            serde_json::to_value(r)
        }
        "watchlist" => {
            let r: Watch = parse(value)?;
            record_id("id", &r.id)?;
            if r.item_id.trim().is_empty() {
                return Err("itemId: пусто".into());
            }
            item_parser::variant::PriceVariant::parse(&r.variant_key).map_err(|e| format!("variantKey: {e}"))?;
            if let Some(note) = &r.note
                && note.chars().count() > 500 {
                    return Err("note: не больше 500 символов".into());
                }
            date("addedAt", &r.added_at)?;
            serde_json::to_value(r)
        }
        "settings" => {
            let r: Settings = parse(value)?;
            if !["DESKTOP", "EXTENSION", "ADMIN_PANEL"].contains(&r.id.as_str()) {
                return Err("id: вид клиента DESKTOP / EXTENSION / ADMIN_PANEL".into());
            }
            if r.schema_version < 1 {
                return Err("schemaVersion: от 1".into());
            }
            json_size("data", &r.data)?;
            serde_json::to_value(r)
        }
        other => return Err(format!("нет коллекции «{other}»")),
    };
    out.map_err(|e| e.to_string())
}

/// Id записи из её JSON.
pub fn id_of(value: &Value) -> Option<&str> {
    value.get("id").and_then(Value::as_str)
}
