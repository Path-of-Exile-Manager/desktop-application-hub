//! Записи синхронизируемых коллекций — те же формы, что `/v1/sync` (`apps/api-hub/src/interfaces/
//! sync/records.ts`), и те же правила, что сущности `packages/domain/src/sync/`: запись, которую
//! сервер отвергнет, не уходит из приложения. Запись хранится в том виде, что вернул `check`:
//! лишние поля отброшены, необязательные заданы явно.

use std::collections::{BTreeMap, BTreeSet};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::account::parse_iso_ms;

/// Коллекции в порядке отправки: папки раньше закладок.
/// Группы билдов — раньше билдов (как папки раньше закладок).
pub const COLLECTIONS: [&str; 9] = [
    "folders", "bookmarks", "history", "pins", "watchlist", "settings", "mapRegexPresets", "pobBuildGroups", "pobBuilds",
];

const MAX_JSON_BYTES: usize = 64 * 1024;
/// Билд — до 256 КБ: код гайда с этапами один бывает 100–200 КБ (`MAX_POB_BUILD_BYTES` на сервере).
const MAX_POB_BUILD_BYTES: usize = 256 * 1024;

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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GameLanguage {
    En,
    Ru,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum WantMode {
    Any,
    All,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ModChoice {
    Avoid,
    Want,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Inclusion {
    Include,
    Exclude,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ThresholdMode {
    Exact,
    Rounded,
}

#[derive(Serialize, Deserialize)]
struct ThresholdRule {
    mode: ThresholdMode,
    any: bool,
}

#[derive(Serialize, Deserialize)]
struct Rarity {
    keys: Vec<String>,
    mode: Inclusion,
}

/// Набор вкладки «RegEx карт» (`packages/domain/src/sync/map-regex-preset.ts`). Ключи модов и
/// свойств проверяются только по формату: семейство, пропавшее из игры, остаётся в наборе.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapRegexPreset {
    id: String,
    name: String,
    lang: GameLanguage,
    want_mode: WantMode,
    mods: BTreeMap<String, ModChoice>,
    numbers: BTreeMap<String, u32>,
    flags: BTreeMap<String, Inclusion>,
    rarity: Rarity,
    yield_rule: ThresholdRule,
    quality_rule: ThresholdRule,
    use_types: bool,
    sort_key: String,
    created_at: String,
}

/// Больше, чем модов (~125) и свойств (~24) карт в игре.
const MAX_PRESET_MODS: usize = 500;
const MAX_PRESET_PROPERTIES: usize = 100;
const MAX_PRESET_KEY: usize = 200;

/// `map:<…>` — ключ семейства мода карты.
fn map_mod_key(key: &str) -> bool {
    key.len() > 4 && key.len() <= MAX_PRESET_KEY && key.starts_with("map:")
}

/// `quantity`, `quality-pack-size`, `type-shaper`: слова из a-z0-9 через «-».
fn map_property_key(key: &str) -> bool {
    key.len() <= MAX_PRESET_KEY && key.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

fn check_map_regex_preset(r: &MapRegexPreset) -> Result<(), String> {
    record_id("id", &r.id)?;
    text("name", &r.name, 40)?;
    if r.mods.len() > MAX_PRESET_MODS || !r.mods.keys().all(|k| map_mod_key(k)) {
        return Err("mods: ключи — map:…, не больше 500".into());
    }
    if r.numbers.len() > MAX_PRESET_PROPERTIES || !r.numbers.iter().all(|(k, v)| map_property_key(k) && (1..=9999).contains(v)) {
        return Err("numbers: ключи свойств, пороги — целые 1–9999".into());
    }
    if r.flags.len() > MAX_PRESET_PROPERTIES || !r.flags.keys().all(|k| map_property_key(k)) {
        return Err("flags: ключи свойств".into());
    }
    let distinct: BTreeSet<&String> = r.rarity.keys.iter().collect();
    if r.rarity.keys.len() > MAX_PRESET_PROPERTIES || distinct.len() != r.rarity.keys.len() || !r.rarity.keys.iter().all(|k| map_property_key(k)) {
        return Err("rarity: разные ключи свойств".into());
    }
    sort_key(&r.sort_key)?;
    date("createdAt", &r.created_at)?;
    json_size("набор", r)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum PobBuildSite {
    Pobbin,
    Pastebin,
    PoeNinja,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PobBuildSource {
    site: PobBuildSite,
    id_on_site: String,
    url: String,
}

/// Билд вкладки «Билды» (`packages/domain/src/sync/pob-build.ts`). Код PoB хранится как есть;
/// `filterOverrides` — форма интерфейса, сервер её не читает.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PobBuild {
    id: String,
    name: String,
    code: String,
    #[serde(default)]
    group_id: Option<String>,
    #[serde(default)]
    source: Option<PobBuildSource>,
    class_name: String,
    #[serde(default)]
    ascendancy: Option<String>,
    #[serde(default)]
    level: Option<u32>,
    #[serde(default)]
    notes: Option<String>,
    manual_prices: BTreeMap<String, f64>,
    filter_overrides: Map<String, Value>,
    sort_key: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PobBuildGroup {
    id: String,
    name: String,
    sort_key: String,
}

const MAX_MANUAL_PRICES: usize = 1000;
const MAX_ROW_KEY: usize = 200;
const MAX_MANUAL_PRICE: f64 = 1_000_000_000.0;

fn optional_text(field: &str, value: &Option<String>, max: usize) -> Result<(), String> {
    match value {
        Some(v) if v.chars().count() > max => Err(format!("{field}: не больше {max} символов")),
        _ => Ok(()),
    }
}

fn check_pob_build(r: &PobBuild) -> Result<(), String> {
    record_id("id", &r.id)?;
    text("name", &r.name, 150)?;
    if r.code.is_empty() || !r.code.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-+/=".contains(&b)) {
        return Err("code: код экспорта PoB (символы base64)".into());
    }
    if let Some(group) = &r.group_id {
        record_id("groupId", group)?;
    }
    if let Some(source) = &r.source {
        let id_ok = (1..=100).contains(&source.id_on_site.len())
            && source.id_on_site.bytes().all(|b| b.is_ascii_alphanumeric() || b"_/-".contains(&b));
        if !id_ok || !source.url.starts_with("https://") || source.url.chars().count() > 500 {
            return Err("source: id на сайте и ссылка https".into());
        }
    }
    text("className", &r.class_name, 40)?;
    optional_text("ascendancy", &r.ascendancy, 40)?;
    if r.level.is_some_and(|level| !(1..=100).contains(&level)) {
        return Err("level: 1–100".into());
    }
    optional_text("notes", &r.notes, 2000)?;
    let prices_ok = r.manual_prices.len() <= MAX_MANUAL_PRICES
        && r.manual_prices.iter().all(|(key, value)| {
            !key.is_empty() && key.chars().count() <= MAX_ROW_KEY && value.is_finite() && (0.0..=MAX_MANUAL_PRICE).contains(value)
        });
    if !prices_ok {
        return Err("manualPrices: ключ строки → цена в chaos от 0".into());
    }
    sort_key(&r.sort_key)?;
    date("createdAt", &r.created_at)?;
    json_size_max("билд", r, MAX_POB_BUILD_BYTES)
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
    json_size_max(field, value, MAX_JSON_BYTES)
}

fn json_size_max(field: &str, value: &impl Serialize, max: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?.len();
    if bytes > max {
        Err(format!("{field}: больше {} КБ JSON", max / 1024))
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
        "mapRegexPresets" => {
            let r: MapRegexPreset = parse(value)?;
            check_map_regex_preset(&r)?;
            serde_json::to_value(r)
        }
        "pobBuilds" => {
            let r: PobBuild = parse(value)?;
            check_pob_build(&r)?;
            serde_json::to_value(r)
        }
        "pobBuildGroups" => {
            let r: PobBuildGroup = parse(value)?;
            record_id("id", &r.id)?;
            text("name", &r.name, 100)?;
            sort_key(&r.sort_key)?;
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
