//! «Фарм → Боссы»: доход от фарма боссов (`shared/docs/boss-farm.md`, 7.1).
//!
//! Данные — `bosses.json` набора данных (`Catalog.bosses`), расчёт — крейт `farm-engine`. Цена
//! ссылки `ref` из таблицы боссов:
//! - `{ itemId, variantKey? }` — сводная цена лиги (`PricesService`): точный вариант или ближайший
//!   (`appraise::pick`); у камня без `variantKey` — уровень 1 без осквернения (так они падают);
//! - `{ quote }` — принятая цена ключа пула от сервера (`GET /v1/farm/bosses/:league`, ETag, кэш
//!   в памяти; при запросе вкладки, не чаще раза в 5 минут; ответ с ошибкой или 404 — особых цен нет);
//! - `{ none: true }` — не продаётся, 0;
//! - своя цена пользователя (`farm_set_price_override`) перекрывает обе — `user.db`, таблица
//!   `farm_price_overrides`, ключ `(лига, ключ ref)`, не синхронизируется.
//!
//! Общая статистика дропа (`GET /v1/farm/bosses/stats`, ETag, кэш в памяти): первый раз — запрос
//! сразу, дальше — в фоне раз в час и при открытии вкладки (`farm_refresh_stats`); берутся строки
//! с версией текущего `bosses.json`; ошибка — расчёт без статистики (прежний ответ остаётся).
//!
//! Расчёт всех боссов — в пуле блокирующих задач, по боссам в нескольких потоках; результат
//! кэшируется по хэшу (набор, версия таблицы, лига, цены всех `ref` после своих правок, настройки,
//! ревизия статистики). Новые особые цены и статистика, пришедшие в фоне, и правка своей цены —
//! событие `farm-updated`.

use std::collections::{BTreeMap, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use farm_engine::{Boss, BossData, BossEstimate, BossGroup, ChanceSource, DropRef, MonteCarlo, PoolKind};
use item_parser::variant::PriceVariant;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::api::{Api, Call, Reply};
use crate::appraise::pick;
use crate::dataset::model::ItemKind;
use crate::dataset::{Catalog, DatasetService};
use crate::paths::AppPaths;
use crate::prices::{encode_segment, Price, PricesService};
use crate::trade::item_search::variant_spec;
use crate::trade::query::{build_query, search_url};

pub const EVENT: &str = "farm-updated";
/// Особые цены лиги — не чаще раза в 5 минут (и после ошибки тоже).
const QUOTES_REFRESH: Duration = Duration::from_secs(5 * 60);
/// Общая статистика дропа — раз в час; при открытии вкладки — если прошла минута.
const STATS_REFRESH: Duration = Duration::from_secs(60 * 60);
const STATS_ON_OPEN: Duration = Duration::from_secs(60);
/// z для 95 % интервала Уилсона (как у сервера): верх интервала ключа, ни разу не выпавшего.
const WILSON_Z: f64 = 1.96;
const TIMEOUT: Duration = Duration::from_secs(20);

// ---------- настройки из интерфейса ----------

/// Настройки расчёта: выбранный профиль (коллекция `farmProfiles`, её читает и пишет интерфейс)
/// и переключатель «Шансы сообщества» (настройка интерфейса, в профиле её нет).
#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct FarmSettings {
    /// Общий IIQ для пулов `scalesWithQuantity`, в %.
    pub iiq: f64,
    /// «Шансы сообщества»: статистика вместо данных у всех ключей босса со статистикой; без
    /// переключателя — только у шансов `null`.
    pub prefer_community: bool,
    pub bosses: BTreeMap<String, FarmBossSettings>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct FarmBossSettings {
    /// Нет — `defaults` босса из данных.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ttk_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub overhead_sec: Option<f64>,
    /// Своя IIQ для босса (у T17 — своя у каждой карты); нет — общая.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub iiq: Option<f64>,
    /// Свои шансы по ключу дропа: у `independent` — в %, у `one-of` — вес пула.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chances: Option<BTreeMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hidden: Option<bool>,
}

fn engine_settings(settings: &FarmSettings, boss: &Boss, stats: Option<&BossStats>) -> farm_engine::Settings {
    let own = settings.bosses.get(&boss.id);
    let positive = |value: Option<f64>| value.filter(|v| v.is_finite() && *v >= 0.0);

    farm_engine::Settings {
        ttk_sec: positive(own.and_then(|o| o.ttk_sec)),
        overhead_sec: positive(own.and_then(|o| o.overhead_sec)),
        iiq: own.and_then(|o| o.iiq).or(Some(settings.iiq)).filter(|v| v.is_finite()).unwrap_or(0.0),
        chances: own.and_then(|o| o.chances.as_ref()).map(|c| c.iter().map(|(k, v)| (k.clone(), *v)).collect()).unwrap_or_default(),
        community: community_rates(boss, stats),
        prefer_community: settings.prefer_community,
    }
}

/// Шансы сообщества по ключам дропа босса, в % (ожидаемое число штук за убийство). Ключа, ни разу не
/// выпавшего за засчитанные убийства, в ответе нет — его шанс 0.
fn community_rates(boss: &Boss, stats: Option<&BossStats>) -> HashMap<String, f64> {
    let Some(stats) = stats else { return HashMap::new() };
    boss.pools
        .iter()
        .flat_map(|pool| pool.entries.iter())
        .map(|entry| (entry.key.clone(), stats.drops.get(&entry.key).map_or(0.0, |d| d.rate)))
        .filter(|(_, rate)| rate.is_finite())
        .collect()
}

/// Статистика босса для этой версии таблицы.
fn boss_stats<'a>(stats: Option<&'a StatsReply>, version: &str, boss_id: &str) -> Option<&'a BossStats> {
    stats?.bosses.iter().find(|b| b.boss_id == boss_id && b.data_version == version)
}

/// Статистика сообщества строки дропа. Ключ без выпадений: 0 %, верх интервала — z² / (n + z²).
fn community_drop(stats: &BossStats, key: &str) -> FarmCommunityDrop {
    let (rate, low, high) = match stats.drops.get(key) {
        Some(d) => (d.rate, d.low, d.high),
        None => {
            let n = f64::from(stats.kills);
            let z2 = WILSON_Z * WILSON_Z;
            (0.0, 0.0, z2 / (n + z2) * 100.0)
        }
    };
    FarmCommunityDrop { rate, low, high, kills: stats.kills, contributors: stats.contributors }
}

// ---------- ссылка на цену ----------

/// Чем оценивается дроп или предмет входа — как `ref` в `bosses.json`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum FarmRef {
    Item {
        #[serde(rename = "itemId")]
        item_id: String,
        #[serde(rename = "variantKey", default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        variant_key: Option<String>,
    },
    Quote {
        quote: String,
    },
    None {
        none: bool,
    },
}

impl FarmRef {
    fn from_drop(drop_ref: &DropRef) -> Option<Self> {
        match drop_ref {
            DropRef::Item { item_id, variant_key } => Some(Self::Item { item_id: item_id.clone(), variant_key: variant_key.clone() }),
            DropRef::Quote { quote } => Some(Self::Quote { quote: quote.clone() }),
            DropRef::None { none } => Some(Self::None { none: *none }),
            DropRef::Unknown(_) => None,
        }
    }

    /// Ключ своей цены и кэша цен: `item:<id>`, `item:<id>#<вариант>`, `quote:<id>`, `none`.
    fn key(&self) -> String {
        match self {
            Self::Item { item_id, variant_key: Some(variant) } if !variant.is_empty() => format!("item:{item_id}#{variant}"),
            Self::Item { item_id, .. } => format!("item:{item_id}"),
            Self::Quote { quote } => format!("quote:{quote}"),
            Self::None { .. } => "none".to_owned(),
        }
    }
}

fn ref_key(drop_ref: &DropRef) -> Option<String> {
    FarmRef::from_drop(drop_ref).map(|r| r.key())
}

// ---------- цены ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FarmPriceSource {
    /// Сводная цена лиги (`/v1/prices`).
    Aggregate,
    /// Принятая цена ключа пула (`/v1/farm/bosses`).
    Quote,
    /// Своя цена пользователя.
    Own,
    /// `{ none: true }` — не продаётся, 0.
    None,
    /// Цены нет.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmPrice {
    /// Цена штуки в расчёте, chaos; `null` — цены нет.
    pub chaos: Option<f64>,
    pub source: FarmPriceSource,
    /// Цена рынка (сводная или особая) — и под своей ценой.
    pub market_chaos: Option<f64>,
    /// Своя цена пользователя.
    pub own_chaos: Option<f64>,
    /// Когда посчитана цена рынка (ISO): `updatedAt` сводной, `fetchedAt` особой.
    pub updated_at: Option<String>,
    /// Сводная: вариант, чья цена взята.
    pub variant_key: Option<String>,
    /// Сводная: точный вариант (`false` — ближайший).
    pub exact: Option<bool>,
    /// Сводная: `false` — у источников не было годных значений.
    pub reliable: Option<bool>,
    /// Особая: статус ключа пула (`OK`, `NO_MARKET`, `FAILED`…).
    pub quote_status: Option<String>,
    /// Особая: самый дешёвый лот, chaos.
    pub min_chaos: Option<f64>,
    /// Особая: найдено лотов.
    pub total: Option<u32>,
}

impl FarmPrice {
    fn missing() -> Self {
        Self {
            chaos: None,
            source: FarmPriceSource::Missing,
            market_chaos: None,
            own_chaos: None,
            updated_at: None,
            variant_key: None,
            exact: None,
            reliable: None,
            quote_status: None,
            min_chaos: None,
            total: None,
        }
    }
}

/// Ответ `GET /v1/farm/bosses/:league`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotesReply {
    /// Сервер ищет особые цены лиги.
    #[serde(default)]
    pub tracked: bool,
    #[serde(default)]
    pub quotes: Vec<QuoteState>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteState {
    pub id: String,
    #[serde(default)]
    pub status: String,
    pub price_chaos: Option<f64>,
    pub min_chaos: Option<f64>,
    pub total: Option<u32>,
    pub fetched_at: Option<String>,
}

/// Ответ `GET /v1/farm/bosses/stats`: все версии таблицы, прошедшие порог (убийств ≥ 30,
/// участников ≥ 3).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct StatsReply {
    #[serde(default)]
    pub bosses: Vec<BossStats>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BossStats {
    pub boss_id: String,
    pub data_version: String,
    pub kills: u32,
    pub contributors: u32,
    /// Ключ дропа → статистика; ни разу не выпавших ключей нет.
    #[serde(default)]
    pub drops: HashMap<String, DropStats>,
}

/// В % ожидаемого числа штук за убийство — те же единицы, что `chance` таблицы.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct DropStats {
    pub rate: f64,
    pub low: f64,
    pub high: f64,
}

/// Откуда берутся цены для одного расчёта.
pub struct PriceInputs<'a> {
    /// Вид предмета справочника (камни оцениваются уровнем 1).
    pub kind_of: &'a dyn Fn(&str) -> Option<ItemKind>,
    /// Сводные цены предмета в лиге; пусто — цен лиги нет.
    pub variants: &'a dyn Fn(&str) -> Vec<Price>,
    pub quotes: Option<&'a QuotesReply>,
    /// Свои цены по ключу `ref`.
    pub own: &'a HashMap<String, f64>,
}

/// Вариант, который ищем у сводных цен: из `variantKey`, у камня без него — уровень 1.
fn wanted_variant(variant_key: Option<&str>, kind: Option<ItemKind>) -> (PriceVariant, String) {
    match variant_key {
        Some(key) => (PriceVariant::parse(key).unwrap_or_default(), key.to_owned()),
        None if kind == Some(ItemKind::Gem) => {
            let wanted = PriceVariant { level: Some(1), ..PriceVariant::default() };
            let key = wanted.key();
            (wanted, key)
        }
        None => (PriceVariant::default(), String::new()),
    }
}

fn resolve(drop_ref: &FarmRef, inputs: &PriceInputs) -> FarmPrice {
    let mut price = FarmPrice::missing();

    match drop_ref {
        FarmRef::None { .. } => {
            price.chaos = Some(0.0);
            price.source = FarmPriceSource::None;
            return price;
        }
        FarmRef::Item { item_id, variant_key } => {
            let variants = (inputs.variants)(item_id);
            let (wanted, key) = wanted_variant(variant_key.as_deref(), (inputs.kind_of)(item_id));
            if let Some((found, exact)) = pick(&wanted, &key, &variants) {
                price.chaos = Some(found.chaos_value);
                price.source = FarmPriceSource::Aggregate;
                price.updated_at = Some(found.updated_at);
                price.variant_key = Some(found.variant_key);
                price.exact = Some(exact);
                price.reliable = Some(found.reliable);
            }
        }
        FarmRef::Quote { quote } => {
            if let Some(state) = inputs.quotes.and_then(|reply| reply.quotes.iter().find(|q| q.id == *quote)) {
                price.quote_status = Some(state.status.clone());
                price.min_chaos = state.min_chaos;
                price.total = state.total;
                price.updated_at = state.fetched_at.clone();
                if let Some(chaos) = state.price_chaos.filter(|c| c.is_finite()) {
                    price.chaos = Some(chaos);
                    price.source = FarmPriceSource::Quote;
                }
            }
        }
    }

    price.market_chaos = price.chaos;
    if let Some(own) = inputs.own.get(&drop_ref.key()).copied() {
        price.own_chaos = Some(own);
        price.chaos = Some(own);
        price.source = FarmPriceSource::Own;
    }
    price
}

/// Цены всех `ref` таблицы по ключу.
pub fn price_book(data: &BossData, inputs: &PriceInputs) -> HashMap<String, FarmPrice> {
    let mut book = HashMap::new();
    let refs = data.bosses.iter().flat_map(|boss| boss.entry.iter().map(|e| &e.drop_ref).chain(boss.pools.iter().flat_map(|p| p.entries.iter().map(|e| &e.drop_ref))));

    for drop_ref in refs {
        let Some(farm_ref) = FarmRef::from_drop(drop_ref) else { continue };
        book.entry(farm_ref.key()).or_insert_with(|| resolve(&farm_ref, inputs));
    }
    book
}

fn book_price<'a>(book: &'a HashMap<String, FarmPrice>, drop_ref: &DropRef) -> Option<&'a FarmPrice> {
    ref_key(drop_ref).and_then(|key| book.get(&key))
}

/// Все боссы таблицы — по боссам в нескольких потоках; Монте-Карло 20 000 прогонов, seed постоянный.
pub fn estimate_all(data: &BossData, book: &HashMap<String, FarmPrice>, settings: &FarmSettings, stats: Option<&StatsReply>) -> Vec<BossEstimate> {
    let price = |drop_ref: &DropRef| book_price(book, drop_ref).and_then(|p| p.chaos);
    let threads = thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, 8);
    let chunk = data.bosses.len().div_ceil(threads).max(1);

    thread::scope(|scope| {
        let handles: Vec<_> = data
            .bosses
            .chunks(chunk)
            .map(|bosses| {
                let price = &price;
                scope.spawn(move || {
                    bosses
                        .iter()
                        .map(|boss| {
                            let settings = engine_settings(settings, boss, boss_stats(stats, &data.version, &boss.id));
                            farm_engine::estimate(boss, price, &settings, MonteCarlo::default())
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|handle| handle.join().expect("farm estimate thread")).collect()
    })
}

// ---------- ответы команд ----------

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct FarmText {
    pub en: String,
    pub ru: Option<String>,
}

impl From<&farm_engine::data::LocalizedText> for FarmText {
    fn from(text: &farm_engine::data::LocalizedText) -> Self {
        Self { en: text.en.clone(), ru: text.ru.clone() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum FarmBossGroup {
    Pinnacle,
    PinnacleUber,
    Invitation,
    T17,
    League,
    Other,
    Unknown,
}

impl From<BossGroup> for FarmBossGroup {
    fn from(group: BossGroup) -> Self {
        match group {
            BossGroup::Pinnacle => Self::Pinnacle,
            BossGroup::PinnacleUber => Self::PinnacleUber,
            BossGroup::Invitation => Self::Invitation,
            BossGroup::T17 => Self::T17,
            BossGroup::League => Self::League,
            BossGroup::Other => Self::Other,
            BossGroup::Unknown => Self::Unknown,
        }
    }
}

/// Доход за час по Монте-Карло, прибыль за вычетом входа каждого убийства.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmHourRisk {
    /// Убийств в прогоне: round(убийств в час), не меньше 1.
    pub kills: u32,
    pub runs: u32,
    pub mean: f64,
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
    /// Доля прогонов с прибылью < 0.
    pub loss_chance: f64,
}

/// Итоги босса для строки таблицы.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmSummary {
    /// Σ qty × цена; `null` — у входа нет цены.
    pub entry_cost: Option<f64>,
    /// Ожидаемый доход дропа за убийство.
    pub ev: f64,
    /// σ дохода за убийство.
    pub sigma: f64,
    /// EV − вход; `null` — у входа нет цены.
    pub profit: Option<f64>,
    pub ttk_sec: Option<f64>,
    pub overhead_sec: Option<f64>,
    pub kills_per_hour: Option<f64>,
    pub profit_per_hour: Option<f64>,
    pub hour: Option<FarmHourRisk>,
    /// Доля EV от дропов с вероятностью < 5 %; `null` — EV ≤ 0.
    pub rare_share: Option<f64>,
    /// Ключ самого большого по вкладу редкого дропа.
    pub rare_top: Option<String>,
    /// Ключи дропов без цены (в EV — 0).
    pub unpriced: Vec<String>,
    /// Ключи с неизвестным шансом (в EV не входят).
    pub unknown_chance: Vec<String>,
}

impl From<&BossEstimate> for FarmSummary {
    fn from(e: &BossEstimate) -> Self {
        Self {
            entry_cost: e.entry_cost,
            ev: e.ev,
            sigma: e.sigma,
            profit: e.profit,
            ttk_sec: e.ttk_sec,
            overhead_sec: e.overhead_sec,
            kills_per_hour: e.kills_per_hour,
            profit_per_hour: e.profit_per_hour,
            hour: e.hour.map(|h| FarmHourRisk { kills: h.kills, runs: h.runs, mean: h.mean, p10: h.p10, p50: h.p50, p90: h.p90, loss_chance: h.loss_chance }),
            rare_share: e.rare_share,
            rare_top: e.rare_top.clone(),
            unpriced: e.unpriced.clone(),
            unknown_chance: e.unknown_chance.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmBossRow {
    pub id: String,
    pub group: FarmBossGroup,
    pub name: FarmText,
    pub icon_item_id: Option<String>,
    /// Иконка (`pmicon`), если предмет есть в справочнике.
    pub icon_sha256: Option<String>,
    /// Скрыт в настройках.
    pub hidden: bool,
    /// Заметка патча: `new` | `changed`.
    pub patch_tag: Option<String>,
    pub summary: FarmSummary,
    /// Самая старая принятая особая цена, использованная в расчёте босса (ISO).
    pub oldest_quote_at: Option<String>,
    /// Общая статистика дропа этой версии таблицы; `null` — нет (мало убийств или участников).
    pub community: Option<FarmBossCommunity>,
}

/// Сколько убийств и людей за статистикой босса.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmBossCommunity {
    pub kills: u32,
    pub contributors: u32,
}

/// Статистика сообщества строки дропа: в % ожидаемого числа штук за убийство (как `chance`
/// `independent`), с 95 % интервалом.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmCommunityDrop {
    pub rate: f64,
    pub low: f64,
    pub high: f64,
    pub kills: u32,
    pub contributors: u32,
}

/// Общая статистика дропа с сервера.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmCommunityStatus {
    /// Боссов со статистикой для версии таблицы.
    pub bosses: u32,
    /// Конец последнего запроса, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    pub syncing: bool,
    /// Ошибка последнего запроса; расчёт идёт с прежней статистикой или без неё.
    pub error: Option<String>,
}

/// Особые цены лиги с сервера.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmQuotesStatus {
    /// Сервер ищет особые цены лиги; `null` — ответа ещё не было.
    pub tracked: Option<bool>,
    /// Ключей с принятой ценой.
    pub priced: u32,
    /// Конец последнего запроса, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    pub syncing: bool,
    /// Ошибка последнего запроса (404 — сервер ещё не отдаёт особые цены); расчёт идёт без них.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmTable {
    pub league: String,
    pub dataset_id: String,
    /// Версия таблицы шансов.
    pub data_version: String,
    /// Сводные цены этой лиги загружены (лига совпадает с текущей лигой цен).
    pub prices_ready: bool,
    /// Самая свежая сводная цена лиги (ISO).
    pub prices_updated_at: Option<String>,
    pub quotes: FarmQuotesStatus,
    pub community: FarmCommunityStatus,
    /// Самая старая принятая особая цена в расчёте (ISO).
    pub oldest_quote_at: Option<String>,
    /// Своих цен в лиге.
    pub own_prices: u32,
    pub bosses: Vec<FarmBossRow>,
    /// Когда посчитано, мс с 1970-01-01, и сколько считалось.
    pub computed_at: u64,
    pub compute_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum FarmPoolKind {
    OneOf,
    Independent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FarmChanceSource {
    Data,
    User,
    Community,
    /// Шанс не опубликован и не задан — в EV не входит.
    Unknown,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmEntryLine {
    /// `null` — незнакомая форма ссылки в данных.
    #[serde(rename = "ref")]
    pub drop_ref: Option<FarmRef>,
    pub ref_key: Option<String>,
    pub name: FarmText,
    pub icon_item_id: Option<String>,
    pub icon_sha256: Option<String>,
    pub qty: f64,
    pub price: FarmPrice,
    /// qty × цена.
    pub cost: Option<f64>,
    /// Поиск на сайте торговли.
    pub trade_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmDropLine {
    /// Ключ дропа у босса (свои шансы, журнал).
    pub key: String,
    #[serde(rename = "ref")]
    pub drop_ref: Option<FarmRef>,
    pub ref_key: Option<String>,
    pub name: FarmText,
    pub icon_item_id: Option<String>,
    pub icon_sha256: Option<String>,
    pub chance_source: FarmChanceSource,
    /// Из данных: вес `one-of` или шанс `independent` в %; `null` — не опубликован.
    pub data_weight: Option<f64>,
    pub data_chance: Option<f64>,
    /// Свой шанс (вес) из настроек.
    pub own_chance: Option<f64>,
    /// Общая статистика дропа; `null` — у босса её нет.
    pub community: Option<FarmCommunityDrop>,
    /// Шанс, что выпадет хотя бы одна штука.
    pub probability: Option<f64>,
    /// Ожидаемое число штук за убийство.
    pub expected: Option<f64>,
    pub price: FarmPrice,
    /// `false` у `{ none: true }`.
    pub sellable: bool,
    /// Вклад в EV за убийство.
    pub value: f64,
    pub trade_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmPool {
    pub id: String,
    pub kind: FarmPoolKind,
    pub scales_with_quantity: bool,
    pub drops: Vec<FarmDropLine>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmArea {
    pub id: String,
    pub name: Option<FarmText>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmQuantityStep {
    pub iiq: f64,
    pub mult: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmPatch {
    pub tag: String,
    pub text: FarmText,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmBossDetail {
    pub league: String,
    pub dataset_id: String,
    pub data_version: String,
    pub prices_ready: bool,
    pub prices_updated_at: Option<String>,
    pub quotes: FarmQuotesStatus,
    pub boss: FarmBossRow,
    /// Арены для `Client.txt`; `null` — своей арены нет.
    pub areas: Option<Vec<FarmArea>>,
    /// Оценка TTK и накладных из данных.
    pub default_ttk_sec: Option<f64>,
    pub default_overhead_sec: Option<f64>,
    /// IIQ в расчёте и множитель шансов пулов `scalesWithQuantity`.
    pub iiq: f64,
    pub quantity_multiplier: f64,
    /// IIQ, при котором записаны шансы данных.
    pub quantity_default: f64,
    /// Ступени T17.
    pub quantity_steps: Option<Vec<FarmQuantityStep>>,
    pub notes: Option<FarmText>,
    pub patch: Option<FarmPatch>,
    pub sources: Vec<String>,
    pub entry: Vec<FarmEntryLine>,
    pub pools: Vec<FarmPool>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmUpdated {
    /// `null` — пришла общая статистика (она одна на все лиги).
    pub league: Option<String>,
}

// ---------- свои цены: user.db ----------

/// Свои цены `farm_price_overrides` в `user.db`: только локально. Своя версия схемы
/// (`farm_meta`): `user_version` базы принадлежит синхронизации (`sync/store.rs`).
struct OverrideStore {
    conn: Connection,
}

const OVERRIDES_SCHEMA: i64 = 1;

fn db_err(e: rusqlite::Error) -> String {
    format!("user.db (фарм): {e}")
}

impl OverrideStore {
    fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(db_err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(db_err)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS farm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(db_err)?;
        let version: i64 = self
            .conn
            .query_row("SELECT value FROM farm_meta WHERE key = 'schema'", [], |r| r.get::<_, String>(0))
            .optional()
            .map_err(db_err)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if version > OVERRIDES_SCHEMA {
            return Err(format!("свои цены фарма в user.db новее приложения (схема {version}) — обновите приложение"));
        }
        if version < 1 {
            self.conn
                .execute_batch(
                    "BEGIN;
                     CREATE TABLE farm_price_overrides (
                       league TEXT NOT NULL,
                       ref_key TEXT NOT NULL,
                       chaos REAL NOT NULL,
                       updated_at INTEGER NOT NULL,
                       PRIMARY KEY (league, ref_key)
                     );
                     INSERT INTO farm_meta (key, value) VALUES ('schema', '1')
                       ON CONFLICT (key) DO UPDATE SET value = excluded.value;
                     COMMIT;",
                )
                .map_err(db_err)?;
        }
        Ok(())
    }

    fn list(&self, league: &str) -> Result<HashMap<String, f64>, String> {
        let mut statement = self.conn.prepare_cached("SELECT ref_key, chaos FROM farm_price_overrides WHERE league = ?1").map_err(db_err)?;
        let rows = statement.query_map(params![league], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))).map_err(db_err)?;
        rows.collect::<Result<HashMap<_, _>, _>>().map_err(db_err)
    }

    fn set(&self, league: &str, key: &str, chaos: Option<f64>) -> Result<(), String> {
        match chaos {
            Some(chaos) => self
                .conn
                .execute(
                    "INSERT INTO farm_price_overrides (league, ref_key, chaos, updated_at) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT (league, ref_key) DO UPDATE SET chaos = excluded.chaos, updated_at = excluded.updated_at",
                    params![league, key, chaos, now_ms() as i64],
                )
                .map_err(db_err)?,
            None => self.conn.execute("DELETE FROM farm_price_overrides WHERE league = ?1 AND ref_key = ?2", params![league, key]).map_err(db_err)?,
        };
        Ok(())
    }
}

// ---------- служба ----------

#[derive(Default)]
struct LeagueQuotes {
    reply: Option<Arc<QuotesReply>>,
    etag: Option<String>,
    attempted: Option<Instant>,
    checked_at: Option<u64>,
    syncing: bool,
    error: Option<String>,
}

impl LeagueQuotes {
    fn status(&self) -> FarmQuotesStatus {
        FarmQuotesStatus {
            tracked: self.reply.as_ref().map(|r| r.tracked),
            priced: self.reply.as_ref().map_or(0, |r| r.quotes.iter().filter(|q| q.price_chaos.is_some()).count() as u32),
            checked_at: self.checked_at,
            syncing: self.syncing,
            error: self.error.clone(),
        }
    }
}

/// Общая статистика дропа: один ответ на все лиги и версии таблицы.
#[derive(Default)]
struct CommunityStats {
    reply: Option<Arc<StatsReply>>,
    /// Растёт с каждым новым ответом: ключ кэша расчёта.
    revision: u64,
    etag: Option<String>,
    attempted: Option<Instant>,
    checked_at: Option<u64>,
    syncing: bool,
    error: Option<String>,
}

impl CommunityStats {
    fn status(&self, version: &str) -> FarmCommunityStatus {
        FarmCommunityStatus {
            bosses: self.reply.as_ref().map_or(0, |r| r.bosses.iter().filter(|b| b.data_version == version).count() as u32),
            checked_at: self.checked_at,
            syncing: self.syncing,
            error: self.error.clone(),
        }
    }
}

/// Посчитанная таблица одной лиги.
struct Computed {
    key: u64,
    book: HashMap<String, FarmPrice>,
    estimates: Vec<BossEstimate>,
    computed_at: u64,
    compute_ms: u64,
}

pub struct FarmService {
    quotes: Mutex<HashMap<String, LeagueQuotes>>,
    stats: Mutex<CommunityStats>,
    store: Mutex<Result<OverrideStore, String>>,
    computed: Mutex<Option<Arc<Computed>>>,
    /// Один расчёт за раз: два одинаковых запроса не считают дважды.
    computing: Mutex<()>,
}

pub fn start(app: &AppHandle, paths: &AppPaths) {
    app.manage(FarmService {
        quotes: Mutex::new(HashMap::new()),
        stats: Mutex::new(CommunityStats::default()),
        store: Mutex::new(OverrideStore::open(&paths.file("user.db"))),
        computed: Mutex::new(None),
        computing: Mutex::new(()),
    });
}

/// Особые цены лиги: первый раз — запрос сразу, дальше — в фоне, если прошло 5 минут.
fn quotes_for(app: &AppHandle, league: &str) -> (Option<Arc<QuotesReply>>, FarmQuotesStatus) {
    let service = app.state::<FarmService>();
    let (first, stale) = {
        let mut quotes = service.quotes.lock().unwrap();
        let state = quotes.entry(league.to_owned()).or_default();
        let first = state.attempted.is_none();
        let stale = !state.syncing && state.attempted.is_some_and(|at| at.elapsed() >= QUOTES_REFRESH);
        if first || stale {
            state.attempted = Some(Instant::now());
            state.syncing = true;
        }
        (first, stale)
    };

    if first {
        fetch_quotes(app, league);
    } else if stale {
        let app = app.clone();
        let league = league.to_owned();
        let _ = thread::Builder::new().name("farm-quotes".into()).spawn(move || {
            if fetch_quotes(&app, &league) {
                let _ = app.emit(EVENT, FarmUpdated { league: Some(league) });
            }
        });
    }

    let quotes = service.quotes.lock().unwrap();
    let state = &quotes[league];
    (state.reply.clone(), state.status())
}

/// Запрос `GET /v1/farm/bosses/:league`; `true` — пришли новые цены.
fn fetch_quotes(app: &AppHandle, league: &str) -> bool {
    let service = app.state::<FarmService>();
    let etag = service.quotes.lock().unwrap().get(league).and_then(|s| s.etag.clone());
    let api = app.state::<Arc<Api>>().inner().clone();
    let mut call = Call::get(format!("/v1/farm/bosses/{}", encode_segment(league))).timeout(TIMEOUT);
    if let Some(etag) = etag {
        call = call.if_none_match(etag);
    }
    let result = api.send::<QuotesReply>(call);

    let mut quotes = service.quotes.lock().unwrap();
    let state = quotes.entry(league.to_owned()).or_default();
    state.syncing = false;
    state.checked_at = Some(now_ms());
    match result {
        Ok(Reply::Fresh { value, meta }) => {
            state.reply = Some(Arc::new(value));
            state.etag = meta.etag;
            state.error = None;
            true
        }
        Ok(Reply::NotModified { .. }) => {
            state.error = None;
            false
        }
        Err(e) => {
            state.error = Some(if e.status == Some(404) { "сервер не отдаёт особые цены боссов (404)".to_owned() } else { e.message });
            false
        }
    }
}

/// Общая статистика: первый раз — запрос сразу, дальше — в фоне, если прошёл час.
/// Возвращает ответ и его ревизию.
fn stats_for(app: &AppHandle) -> (Option<Arc<StatsReply>>, u64) {
    let service = app.state::<FarmService>();
    let (first, stale) = {
        let mut stats = service.stats.lock().unwrap();
        let first = stats.attempted.is_none();
        let stale = !stats.syncing && stats.attempted.is_some_and(|at| at.elapsed() >= STATS_REFRESH);
        if first || stale {
            stats.attempted = Some(Instant::now());
            stats.syncing = true;
        }
        (first, stale)
    };

    if first {
        fetch_stats(app);
    } else if stale {
        refresh_stats_in_background(app);
    }

    let stats = service.stats.lock().unwrap();
    (stats.reply.clone(), stats.revision)
}

/// Запрос в фоне; пришли новые данные — `farm-updated` без лиги (статистика общая).
fn refresh_stats_in_background(app: &AppHandle) {
    let app = app.clone();
    let _ = thread::Builder::new().name("farm-stats".into()).spawn(move || {
        if fetch_stats(&app) {
            let _ = app.emit(EVENT, FarmUpdated { league: None });
        }
    });
}

/// Запрос `GET /v1/farm/bosses/stats`; `true` — пришла новая статистика. Ошибка — прежний ответ
/// остаётся (статистика меняется раз в час), текст ошибки — в статусе.
fn fetch_stats(app: &AppHandle) -> bool {
    let service = app.state::<FarmService>();
    let etag = service.stats.lock().unwrap().etag.clone();
    let api = app.state::<Arc<Api>>().inner().clone();
    let mut call = Call::get("/v1/farm/bosses/stats").timeout(TIMEOUT);
    if let Some(etag) = etag {
        call = call.if_none_match(etag);
    }
    let result = api.send::<StatsReply>(call);

    let mut stats = service.stats.lock().unwrap();
    stats.syncing = false;
    stats.checked_at = Some(now_ms());
    match result {
        Ok(Reply::Fresh { value, meta }) => {
            stats.reply = Some(Arc::new(value));
            stats.revision += 1;
            stats.etag = meta.etag;
            stats.error = None;
            true
        }
        Ok(Reply::NotModified { .. }) => {
            stats.error = None;
            false
        }
        Err(e) => {
            stats.error = Some(if e.status == Some(404) { "сервер не отдаёт статистику дропа (404)".to_owned() } else { e.message });
            false
        }
    }
}

/// Всё для ответа команды: данные, цены, посчитанная таблица.
struct Prepared {
    catalog: Arc<Catalog>,
    data: Arc<BossData>,
    computed: Arc<Computed>,
    quotes: FarmQuotesStatus,
    stats: Option<Arc<StatsReply>>,
    community: FarmCommunityStatus,
    prices_ready: bool,
    prices_updated_at: Option<String>,
    own_prices: u32,
}

fn boss_data(catalog: &Catalog) -> Result<Arc<BossData>, String> {
    match &catalog.bosses {
        None => Err("в наборе данных нет bosses.json — обновите набор данных".to_owned()),
        Some(Err(e)) => Err(format!("{e} — обновите приложение")),
        Some(Ok(data)) => Ok(data.clone()),
    }
}

/// Own prices of the league (`farm_price_overrides`); the store did not open — none.
fn own_prices(app: &AppHandle, league: &str) -> Result<HashMap<String, f64>, String> {
    match &*app.state::<FarmService>().store.lock().unwrap() {
        Ok(store) => store.list(league),
        Err(_) => Ok(HashMap::new()),
    }
}

/// Aggregate prices count only for the current price league that has loaded.
fn prices_ready(app: &AppHandle, league: &str) -> bool {
    let prices = app.state::<PricesService>();
    prices.league().as_deref() == Some(league) && prices.version().is_some()
}

/// Runs `f` with the price inputs of a league: aggregate prices (if it is the current price
/// league), special quotes, own prices.
fn with_inputs<T>(app: &AppHandle, catalog: &Catalog, league: &str, quotes: Option<&QuotesReply>, own: &HashMap<String, f64>, f: impl FnOnce(&PriceInputs) -> T) -> T {
    let prices = app.state::<PricesService>();
    let no_prices = |_: &str| Vec::new();
    let league_prices = |item_id: &str| prices.variants(item_id);
    let variants: &dyn Fn(&str) -> Vec<Price> = if prices_ready(app, league) { &league_prices } else { &no_prices };
    let kind_of = |item_id: &str| catalog.get(item_id).map(|item| item.kind);
    f(&PriceInputs { kind_of: &kind_of, variants, quotes, own })
}

fn prepare(app: &AppHandle, league: &str, settings: &FarmSettings) -> Result<Prepared, String> {
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let data = boss_data(&catalog)?;
    // Первые запросы особых цен лиги и статистики идут параллельно.
    let ((stats, stats_revision), (reply, quotes)) = thread::scope(|scope| {
        let stats = scope.spawn(|| stats_for(app));
        let quotes = quotes_for(app, league);
        (stats.join().expect("farm stats thread"), quotes)
    });
    let service = app.state::<FarmService>();
    let community = service.stats.lock().unwrap().status(&data.version);
    let own = own_prices(app, league)?;

    let prices = app.state::<PricesService>();
    let prices_ready = prices_ready(app, league);
    let prices_updated_at = if prices_ready { prices.status().newest_update } else { None };
    let book = with_inputs(app, &catalog, league, reply.as_deref(), &own, |inputs| price_book(&data, inputs));
    let key = cache_key(&catalog.manifest.dataset_id, &data.version, league, &book, settings, stats_revision);

    // Замок кэша — только на чтение и запись, не на время расчёта.
    let cached = || service.computed.lock().unwrap().as_ref().filter(|c| c.key == key).cloned();
    let hit = cached();
    let computed = match hit {
        Some(computed) => computed,
        None => {
            let _guard = service.computing.lock().unwrap();
            let hit = cached();
            match hit {
                Some(computed) => computed,
                None => {
                    let started = Instant::now();
                    let estimates = estimate_all(&data, &book, settings, stats.as_deref());
                    let computed = Arc::new(Computed { key, book, estimates, computed_at: now_ms(), compute_ms: started.elapsed().as_millis() as u64 });
                    *service.computed.lock().unwrap() = Some(computed.clone());
                    computed
                }
            }
        }
    };

    Ok(Prepared { catalog, data, computed, quotes, stats, community, prices_ready, prices_updated_at, own_prices: own.len() as u32 })
}

fn cache_key(dataset_id: &str, version: &str, league: &str, book: &HashMap<String, FarmPrice>, settings: &FarmSettings, stats_revision: u64) -> u64 {
    let mut hasher = DefaultHasher::new();
    (dataset_id, version, league, stats_revision).hash(&mut hasher);
    let mut keys: Vec<&String> = book.keys().collect();
    keys.sort();
    for key in keys {
        key.hash(&mut hasher);
        book[key].chaos.map(f64::to_bits).hash(&mut hasher);
    }
    serde_json::to_string(settings).unwrap_or_default().hash(&mut hasher);
    hasher.finish()
}

/// Самая старая принятая особая цена среди `ref` босса.
fn oldest_quote(boss: &Boss, book: &HashMap<String, FarmPrice>) -> Option<String> {
    boss.entry
        .iter()
        .map(|e| &e.drop_ref)
        .chain(boss.pools.iter().flat_map(|p| p.entries.iter().map(|e| &e.drop_ref)))
        .filter_map(|r| book_price(book, r))
        .filter(|p| p.source == FarmPriceSource::Quote)
        .filter_map(|p| p.updated_at.clone())
        .min()
}

fn boss_row(catalog: &Catalog, boss: &Boss, estimate: &BossEstimate, book: &HashMap<String, FarmPrice>, settings: &FarmSettings, stats: Option<&BossStats>) -> FarmBossRow {
    FarmBossRow {
        id: boss.id.clone(),
        group: boss.group.into(),
        name: (&boss.name).into(),
        icon_item_id: boss.icon_item_id.clone(),
        icon_sha256: boss.icon_item_id.as_deref().and_then(|id| catalog.get(id)).and_then(|item| item.icon_sha256.clone()),
        hidden: settings.bosses.get(&boss.id).and_then(|s| s.hidden).unwrap_or(false),
        patch_tag: boss.patch.as_ref().map(|p| p.tag.clone()),
        summary: estimate.into(),
        oldest_quote_at: oldest_quote(boss, book),
        community: stats.map(|s| FarmBossCommunity { kills: s.kills, contributors: s.contributors }),
    }
}

/// Название, иконка и поиск на сайте торговли для ссылки.
struct RefView {
    name: FarmText,
    icon_item_id: Option<String>,
    icon_sha256: Option<String>,
    trade_url: Option<String>,
}

fn ref_view(catalog: &Catalog, data: &BossData, league: &str, drop_ref: &DropRef, fallback: &str) -> RefView {
    let icon = |id: Option<&str>| id.and_then(|id| catalog.get(id)).and_then(|item| item.icon_sha256.clone());
    match drop_ref {
        DropRef::Item { item_id, variant_key } => {
            let item = catalog.get(item_id);
            let trade_url = item.and_then(|item| {
                let (_, key) = wanted_variant(variant_key.as_deref(), Some(item.kind));
                let stats = catalog.trade_stats.as_ref().and_then(|s| s.as_ref().ok()).map(|s| s.as_ref());
                let spec = variant_spec(catalog, stats, item, &key).ok()?;
                build_query(&spec).ok().map(|payload| search_url(league, &payload))
            });
            RefView {
                name: item.map_or_else(|| FarmText { en: item_id.clone(), ru: None }, |item| FarmText { en: item.name.en.clone(), ru: item.name.ru.clone() }),
                icon_item_id: Some(item_id.clone()),
                icon_sha256: icon(Some(item_id)),
                trade_url,
            }
        }
        DropRef::Quote { quote } => match data.quote(quote) {
            Some(q) => RefView {
                name: (&q.label).into(),
                icon_item_id: q.item_id.clone(),
                icon_sha256: icon(q.item_id.as_deref()),
                trade_url: (!q.query.is_null()).then(|| search_url(league, &q.query)),
            },
            None => RefView { name: FarmText { en: quote.clone(), ru: None }, icon_item_id: None, icon_sha256: None, trade_url: None },
        },
        _ => RefView { name: FarmText { en: fallback.to_owned(), ru: None }, icon_item_id: None, icon_sha256: None, trade_url: None },
    }
}

fn price_of(book: &HashMap<String, FarmPrice>, drop_ref: &DropRef) -> FarmPrice {
    book_price(book, drop_ref).cloned().unwrap_or_else(FarmPrice::missing)
}

fn detail(prepared: &Prepared, league: &str, boss_id: &str, settings: &FarmSettings) -> Result<FarmBossDetail, String> {
    let Prepared { catalog, data, computed, .. } = prepared;
    let index = data.bosses.iter().position(|b| b.id == boss_id).ok_or_else(|| format!("босса {boss_id} нет в таблице"))?;
    let boss = &data.bosses[index];
    let estimate = &computed.estimates[index];
    let book = &computed.book;
    let stats = boss_stats(prepared.stats.as_deref(), &data.version, boss_id);
    let engine = engine_settings(settings, boss, stats);

    let entry = boss
        .entry
        .iter()
        .zip(&estimate.entry)
        .map(|(item, line)| {
            let view = ref_view(catalog, data, league, &item.drop_ref, "?");
            FarmEntryLine {
                drop_ref: FarmRef::from_drop(&item.drop_ref),
                ref_key: ref_key(&item.drop_ref),
                name: view.name,
                icon_item_id: view.icon_item_id,
                icon_sha256: view.icon_sha256,
                qty: item.qty,
                price: price_of(book, &item.drop_ref),
                cost: line.price.map(|p| p * item.qty),
                trade_url: view.trade_url,
            }
        })
        .collect();

    let mut lines = estimate.drops.iter();
    let pools = boss
        .pools
        .iter()
        .map(|pool| FarmPool {
            id: pool.id.clone(),
            kind: match pool.kind {
                PoolKind::OneOf => FarmPoolKind::OneOf,
                PoolKind::Independent => FarmPoolKind::Independent,
                PoolKind::Unknown => FarmPoolKind::Unknown,
            },
            scales_with_quantity: pool.scales_with_quantity,
            drops: pool
                .entries
                .iter()
                .zip(lines.by_ref())
                .map(|(entry, line)| {
                    let view = ref_view(catalog, data, league, &entry.drop_ref, &entry.key);
                    FarmDropLine {
                        key: entry.key.clone(),
                        drop_ref: FarmRef::from_drop(&entry.drop_ref),
                        ref_key: ref_key(&entry.drop_ref),
                        name: view.name,
                        icon_item_id: view.icon_item_id,
                        icon_sha256: view.icon_sha256,
                        chance_source: match line.source {
                            ChanceSource::Data => FarmChanceSource::Data,
                            ChanceSource::User => FarmChanceSource::User,
                            ChanceSource::Community => FarmChanceSource::Community,
                            ChanceSource::Unknown => FarmChanceSource::Unknown,
                        },
                        data_weight: entry.weight,
                        data_chance: entry.chance,
                        own_chance: engine.chances.get(&entry.key).copied(),
                        community: stats.map(|s| community_drop(s, &entry.key)),
                        probability: line.probability,
                        expected: line.expected,
                        price: price_of(book, &entry.drop_ref),
                        sellable: line.sellable,
                        value: line.value,
                        trade_url: view.trade_url,
                    }
                })
                .collect(),
        })
        .collect();

    let areas = boss.area_ids.as_ref().map(|ids| {
        ids.iter().map(|id| FarmArea { id: id.clone(), name: data.areas.iter().find(|a| a.id == *id).map(|a| (&a.name).into()) }).collect()
    });

    Ok(FarmBossDetail {
        league: league.to_owned(),
        dataset_id: catalog.manifest.dataset_id.clone(),
        data_version: data.version.clone(),
        prices_ready: prepared.prices_ready,
        prices_updated_at: prepared.prices_updated_at.clone(),
        quotes: prepared.quotes.clone(),
        boss: boss_row(catalog, boss, estimate, book, settings, stats),
        areas,
        default_ttk_sec: boss.defaults.map(|d| d.ttk_sec),
        default_overhead_sec: boss.defaults.map(|d| d.overhead_sec),
        iiq: engine.iiq,
        quantity_multiplier: farm_engine::quantity_multiplier(boss, engine.iiq),
        quantity_default: boss.quantity.default,
        quantity_steps: boss.quantity.steps.as_ref().map(|steps| steps.iter().map(|s| FarmQuantityStep { iiq: s.iiq, mult: s.mult }).collect()),
        notes: boss.notes.as_ref().map(Into::into),
        patch: boss.patch.as_ref().map(|p| FarmPatch { tag: p.tag.clone(), text: (&p.text).into() }),
        sources: boss.sources.clone(),
        entry,
        pools,
    })
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ---------- команды ----------

/// Таблица боссов лиги: итоги каждого босса и свежесть цен. Ошибка — нет справочника или
/// `bosses.json` (текст — что сделать). Считается в фоне, повтор с теми же ценами и настройками —
/// из кэша.
#[tauri::command]
pub async fn farm_bosses(app: AppHandle, league: String, settings: FarmSettings) -> Result<FarmTable, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&app, &league, &settings)?;
        let Prepared { catalog, data, computed, .. } = &prepared;
        let bosses: Vec<FarmBossRow> = data
            .bosses
            .iter()
            .zip(&computed.estimates)
            .map(|(boss, estimate)| boss_row(catalog, boss, estimate, &computed.book, &settings, boss_stats(prepared.stats.as_deref(), &data.version, &boss.id)))
            .collect();
        let oldest_quote_at = bosses.iter().filter_map(|b| b.oldest_quote_at.clone()).min();

        Ok(FarmTable {
            league,
            dataset_id: catalog.manifest.dataset_id.clone(),
            data_version: data.version.clone(),
            prices_ready: prepared.prices_ready,
            prices_updated_at: prepared.prices_updated_at.clone(),
            quotes: prepared.quotes.clone(),
            community: prepared.community.clone(),
            oldest_quote_at,
            own_prices: prepared.own_prices,
            bosses,
            computed_at: computed.computed_at,
            compute_ms: computed.compute_ms,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Босс целиком: вход, пулы, строки дропа с шансом, ценой, её источником и свежестью, вкладом в
/// EV и ссылками на сайт торговли.
#[tauri::command]
pub async fn farm_boss(app: AppHandle, league: String, boss_id: String, settings: FarmSettings) -> Result<FarmBossDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&app, &league, &settings)?;
        detail(&prepared, &league, &boss_id, &settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Своя цена `ref` в лиге, chaos; `null` — убрать. Перекрывает сводную и особую цену.
#[tauri::command]
pub async fn farm_set_price_override(app: AppHandle, league: String, drop_ref: FarmRef, chaos: Option<f64>) -> Result<(), String> {
    if matches!(drop_ref, FarmRef::None { .. }) {
        return Err("у «не продаётся» своей цены нет".into());
    }
    if chaos.is_some_and(|c| !c.is_finite() || c < 0.0) {
        return Err("цена — неотрицательное число".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<FarmService>();
        match &*service.store.lock().unwrap() {
            Ok(store) => store.set(&league, &drop_ref.key(), chaos)?,
            Err(e) => return Err(e.clone()),
        }
        let _ = app.emit(EVENT, FarmUpdated { league: Some(league) });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Вкладку открыли: перечитать общую статистику в фоне (ETag — обычно 304), если с прошлого
/// запроса прошла минута. Новая статистика — `farm-updated` без лиги. Первый запрос делает расчёт.
#[tauri::command]
pub fn farm_refresh_stats(app: AppHandle) {
    let service = app.state::<FarmService>();
    {
        let mut stats = service.stats.lock().unwrap();
        if stats.syncing || stats.attempted.is_none_or(|at| at.elapsed() < STATS_ON_OPEN) {
            return;
        }
        stats.attempted = Some(Instant::now());
        stats.syncing = true;
    }
    refresh_stats_in_background(&app);
}

// ---------- journal (`bossKills`, shared/docs/boss-farm.md 7.4) ----------

/// Prices of one kill at the moment it is written: the journal keeps them in the record (decision
/// 12 — actual income at the prices of the moment), so a later price change does not rewrite it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmKillPrices {
    pub league: String,
    /// `version` of `bosses.json`: `dataVersion` of the record.
    pub data_version: String,
    /// Σ qty × price of the entry items; `null` — one of them has no price.
    pub entry_chaos: Option<f64>,
    /// Price of one piece by drop key of the boss's pools; `null` — no price.
    #[ts(type = "Record<string, number | null>")]
    pub drops: BTreeMap<String, Option<f64>>,
    /// Price of one piece of other catalog items (`extra`), as asked.
    #[ts(type = "Record<string, number | null>")]
    pub extra: BTreeMap<String, Option<f64>>,
}

/// Current prices of a boss's entry and drops in a league (own prices first, like the calculator).
pub(crate) fn kill_prices(app: &AppHandle, league: &str, boss_id: &str, extra: &[String]) -> Result<FarmKillPrices, String> {
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let data = boss_data(&catalog)?;
    let boss = data.boss(boss_id).ok_or_else(|| format!("босса «{boss_id}» нет в таблице"))?;
    let (reply, _) = quotes_for(app, league);
    let own = own_prices(app, league)?;
    Ok(with_inputs(app, &catalog, league, reply.as_deref(), &own, |inputs| {
        let price = |drop_ref: &DropRef| FarmRef::from_drop(drop_ref).and_then(|r| resolve(&r, inputs).chaos);
        let entry_chaos = boss.entry.iter().try_fold(0.0, |sum, e| price(&e.drop_ref).map(|p| sum + p * e.qty));
        let drops = boss.pools.iter().flat_map(|p| &p.entries).map(|e| (e.key.clone(), price(&e.drop_ref))).collect();
        let extra = extra.iter().map(|id| (id.clone(), resolve(&FarmRef::Item { item_id: id.clone(), variant_key: None }, inputs).chaos)).collect();
        FarmKillPrices { league: league.to_owned(), data_version: data.version.clone(), entry_chaos, drops, extra }
    }))
}

/// Prices for a journal record: entry, every drop of the boss and the asked catalog items.
#[tauri::command]
pub async fn farm_kill_prices(app: AppHandle, league: String, boss_id: String, extra: Vec<String>) -> Result<FarmKillPrices, String> {
    tauri::async_runtime::spawn_blocking(move || kill_prices(&app, &league, &boss_id, &extra)).await.map_err(|e| e.to_string())?
}

/// What K kills of a boss are expected to bring by its current estimate (`farm_engine::expect_kills`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmKillsExpectation {
    pub kills: u32,
    /// K × EV: drops only.
    pub income: f64,
    /// K × (EV − entry); `null` — no entry price.
    pub profit: Option<f64>,
    /// σ · √K of the drop income.
    pub sigma: f64,
}

/// Expected income of the journal's kills, by boss: the same estimate as the calculator (current
/// prices and the given profile settings), not the prices of the kills' moments.
#[tauri::command]
pub async fn farm_expect_kills(app: AppHandle, league: String, settings: FarmSettings, kills: BTreeMap<String, u32>) -> Result<BTreeMap<String, FarmKillsExpectation>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&app, &league, &settings)?;
        Ok(prepared
            .data
            .bosses
            .iter()
            .zip(&prepared.computed.estimates)
            .filter_map(|(boss, estimate)| {
                let count = *kills.get(&boss.id)?;
                let e = farm_engine::expect_kills(estimate, count);
                Some((boss.id.clone(), FarmKillsExpectation { kills: e.kills, income: e.income, profit: e.profit, sigma: e.sigma }))
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
