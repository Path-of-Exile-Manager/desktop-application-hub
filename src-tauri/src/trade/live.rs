//! Живой поиск лотов из Price check: поиск по спецификации и предложения столбиком рядом с
//! предметом. Идёт с IP пользователя, без входа на сайт (лимиты GGG считаются по IP, поэтому не
//! через сервер). Перед каждым запросом — проверка лимитов из заголовков прошлых ответов: исчерпано
//! правило или сайт ограничил — ответ «подождите N с», без запроса.

use std::sync::Mutex;

use item_parser::Affix;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use super::query::{build_query, TradeSearchSpec};
use crate::dataset::DatasetService;
use crate::market::trade_client::{encode, TradeClient, TradeError};
use crate::prices::PricesService;

/// Предложений за один раз: столько сайт отдаёт в одном fetch.
pub const PAGE: usize = 10;

pub struct LiveTradeService(Mutex<TradeClient>);

impl LiveTradeService {
    pub fn new() -> Self {
        Self(Mutex::new(TradeClient::new("price check")))
    }
}

/// Результат поиска: первые лоты и id остальных — для «Ещё».
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveSearch {
    /// Id поиска на сайте: для «Ещё» и ссылки на эту же выдачу.
    pub query_id: String,
    /// Сколько предложений нашёл сайт (у популярного — 10 000 «и больше»).
    pub total: u32,
    /// Id предложений в порядке сайта (до 100); первые `PAGE` уже в `listings`.
    pub ids: Vec<String>,
    pub listings: Vec<LiveListing>,
    /// Эта выдача на сайте торговли.
    pub url: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveListing {
    pub id: String,
    /// Имя редкого или уникального; у остальных `null`.
    pub name: Option<String>,
    pub type_line: String,
    /// `Normal`, `Magic`, `Rare`, `Unique`, `Gem`, `Currency`…
    pub rarity: Option<String>,
    pub icon: Option<String>,
    pub item_level: Option<u32>,
    pub stack_size: Option<u32>,
    pub corrupted: bool,
    pub identified: bool,
    pub mods: Vec<LiveMod>,
    pub price: Option<LivePrice>,
    /// Последний персонаж продавца — ему пишут в игре.
    pub character: Option<String>,
    /// `online`, `afk`; `null` — не в сети или неизвестно.
    pub status: Option<String>,
    /// Мгновенный выкуп (у торговца, без лички): шёпота нет.
    pub instant_buyout: bool,
    /// Готовое сообщение продавцу (`@имя Hi, I would like to buy…`).
    pub whisper: Option<String>,
    pub indexed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveMod {
    /// `implicit`, `explicit`, `crafted`, `fractured`, `enchant`, `scourge`, `crucible`.
    pub kind: String,
    pub text: String,
    pub affix: Option<Affix>,
    pub tier: Option<u32>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LivePrice {
    pub amount: f64,
    /// Как пишет сайт: `chaos`, `divine`, `alch`…
    pub currency: String,
    /// В chaos по ценам лиги; `null` — валюты нет в справочнике или у неё нет цены.
    pub chaos: Option<f64>,
    /// Иконка валюты из справочника (sha256).
    pub icon_sha256: Option<String>,
}

fn describe(error: TradeError) -> String {
    match error {
        TradeError::RateLimited(wait) => format!("сайт торговли просит подождать {wait} с"),
        TradeError::Failed(message) => message,
    }
}

fn check_limits(client: &TradeClient, policy: &str) -> Result<(), String> {
    match client.wait_strict(policy) {
        0 => Ok(()),
        wait => Err(format!("лимит запросов сайта торговли — подождите {wait} с")),
    }
}

/// Поиск по спецификации в лиге `league` и первые `PAGE` предложений.
#[tauri::command]
pub async fn trade_live_search(app: AppHandle, spec: TradeSearchSpec, league: String) -> Result<LiveSearch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let payload = build_query(&spec)?;
        let service = app.state::<LiveTradeService>();
        let mut client = service.0.lock().unwrap();
        check_limits(&client, "trade-search-request-limit")?;
        let found = client.search(&league, &payload).map_err(describe)?;
        let url = format!("https://www.pathofexile.com/trade/search/{}/{}", encode(&league), found.id);
        let mut listings = Vec::new();
        if !found.result.is_empty() {
            check_limits(&client, "trade-fetch-request-limit")?;
            let raw = client.fetch(&found.result[..found.result.len().min(PAGE)], &found.id).map_err(describe)?;
            listings = parse_listings(&app, &raw);
        }
        Ok(LiveSearch { query_id: found.id, total: found.total, ids: found.result, listings, url })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Следующие предложения того же поиска (не больше `PAGE` id).
#[tauri::command]
pub async fn trade_live_fetch(app: AppHandle, query_id: String, ids: Vec<String>) -> Result<Vec<LiveListing>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<LiveTradeService>();
        let mut client = service.0.lock().unwrap();
        check_limits(&client, "trade-fetch-request-limit")?;
        let raw = client.fetch(&ids[..ids.len().min(PAGE)], &query_id).map_err(describe)?;
        Ok(parse_listings(&app, &raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_listings(app: &AppHandle, raw: &[Value]) -> Vec<LiveListing> {
    let catalog = app.state::<DatasetService>().catalog();
    let prices = app.state::<PricesService>();
    // Цена валюты в chaos: chaos — 1, остальные — по справочнику (`tradeId`) и ценам лиги.
    let currency = |id: &str| -> (Option<f64>, Option<String>) {
        let entry = catalog.as_ref().and_then(|c| c.by_trade_id(id));
        let icon = entry.and_then(|e| e.icon_sha256.clone());
        let chaos = if id == "chaos" {
            Some(1.0)
        } else {
            entry.and_then(|e| prices.variants(&e.id).into_iter().find(|p| p.variant_key.is_empty())).map(|p| p.chaos_value)
        };
        (chaos, icon)
    };
    raw.iter().filter_map(|entry| listing(entry, &currency)).collect()
}

/// Валюта сайта → её цена в chaos и иконка справочника.
type CurrencyRate<'a> = &'a dyn Fn(&str) -> (Option<f64>, Option<String>);

fn listing(entry: &Value, currency: CurrencyRate) -> Option<LiveListing> {
    let item = entry.get("item")?;
    let listing = entry.get("listing")?;
    let text = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(str::to_string);
    let price = listing.get("price").and_then(|price| {
        let amount = price.get("amount")?.as_f64()?;
        let id = price.get("currency")?.as_str()?.to_string();
        let (rate, icon) = currency(&id);
        Some(LivePrice { amount, chaos: rate.map(|r| r * amount), currency: id, icon_sha256: icon })
    });
    let account = listing.get("account");
    let mut mods = Vec::new();
    for (key, kind) in [
        ("enchantMods", "enchant"),
        ("scourgeMods", "scourge"),
        ("implicitMods", "implicit"),
        ("fracturedMods", "fractured"),
        ("explicitMods", "explicit"),
        ("craftedMods", "crafted"),
        ("crucibleMods", "crucible"),
    ] {
        for m in item.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(parsed) = live_mod(m, kind) {
                mods.push(parsed);
            }
        }
    }
    let whisper = text(listing, "whisper");
    Some(LiveListing {
        id: text(entry, "id")?,
        name: text(item, "name").filter(|n| !n.is_empty()),
        type_line: text(item, "typeLine").unwrap_or_default(),
        rarity: text(item, "rarity"),
        icon: text(item, "icon"),
        item_level: item.get("ilvl").and_then(Value::as_u64).map(|v| v as u32),
        stack_size: item.get("stackSize").and_then(Value::as_u64).map(|v| v as u32),
        corrupted: item.get("corrupted").and_then(Value::as_bool).unwrap_or(false),
        identified: item.get("identified").and_then(Value::as_bool).unwrap_or(true),
        mods,
        price,
        character: account.and_then(|a| text(a, "lastCharacterName")),
        status: account.and_then(|a| a.get("online")).and_then(|o| if o.is_null() { None } else { Some(text(o, "status").unwrap_or_else(|| "online".into())) }),
        instant_buyout: whisper.is_none(),
        whisper,
        indexed_at: text(listing, "indexed"),
    })
}

/// Мод предложения: строкой (старый ответ) или объектом `{ description, mods: [{ tier: "S2" }] }`.
fn live_mod(value: &Value, kind: &str) -> Option<LiveMod> {
    let (text, tier_code) = match value {
        Value::String(s) => (s.clone(), None),
        Value::Object(o) => (
            o.get("description")?.as_str()?.to_string(),
            o.get("mods").and_then(Value::as_array).and_then(|m| m.first()).and_then(|m| m.get("tier")).and_then(Value::as_str).map(str::to_string),
        ),
        _ => return None,
    };
    // `P1` — префикс 1-го тира, `S2` — суффикс 2-го; прочие коды (`R1`…) — без пометки.
    let (affix, tier) = match tier_code.as_deref().filter(|c| c.len() > 1 && c.is_char_boundary(1)).map(|c| c.split_at(1)) {
        Some(("P", n)) => (Some(Affix::Prefix), n.parse().ok()),
        Some(("S", n)) => (Some(Affix::Suffix), n.parse().ok()),
        _ => (None, None),
    };
    Some(LiveMod { kind: kind.to_string(), text: strip_markup(&text), affix, tier })
}

/// `[Resistances|Resistance]` → `Resistance`, `[Strength]` → `Strength`: разметка ссылок сайта.
fn strip_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']').map(|c| open + c) else { break };
        out.push_str(&rest[..open]);
        let inner = &rest[open + 1..close];
        out.push_str(inner.rsplit_once('|').map_or(inner, |(_, shown)| shown));
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    out
}
