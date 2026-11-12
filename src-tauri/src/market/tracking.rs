//! Отслеживание цены билда (план shared/docs/build-price-tracking.md, шаг T7): снимок всех этапов
//! для сервера и команды экрана сборки. Снимок строит то же `pob_stage::stage`, что и экран:
//! уникальные, камни и белые базы — по id справочника и варианту цены, редкие и волшебные — по
//! лестнице из трёх поисков сайта торговли (все моды → суммы + 4 главных → суммы + 2 главных).
//! Правки фильтров пользователя в снимок не идут: у подписчиков одного кода поиски общие.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use pob_parser::{PobBuild, PobRarity};

use crate::account::{send_signed_in_raw, SignedInError};
use crate::api::Call;
use crate::dataset::DatasetService;
use crate::pob_stage::{stage, PobStageRow};
use crate::prices::PricesService;
use crate::trade::query::{build_query, TradeSearchSpec};

use super::MarketService;

/// Этапов в снимке — как и на сервере.
const MAX_STAGES: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrackingSummary {
    pub record_id: String,
    pub league: String,
    pub active_stage: u32,
    pub disabled_stages: Vec<u32>,
    pub stages: u32,
    pub trade_keys: u32,
    pub refresh_requested_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RowTrade {
    /// `NEW`, `OK`, `NO_MARKET`, `UNCONFIRMED`, `FAILED`.
    pub status: String,
    /// Ступень поиска: 0 — все моды, 1 — суммы и 4 главных, 2 — суммы и 2 главных.
    pub level: u32,
    pub levels: u32,
    pub min_chaos: Option<f64>,
    /// Предложений найдено.
    pub total: Option<u32>,
    pub quoted_at: Option<String>,
    pub stale: bool,
    pub pending_chaos: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RowPrice {
    pub row_key: String,
    /// `AGGREGATE`, `TRADE`, `UNPRICED`.
    pub kind: String,
    pub price_chaos: Option<f64>,
    pub trade: Option<RowTrade>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StagePrice {
    pub index: u32,
    pub title: Option<String>,
    pub enabled: bool,
    pub chaos: f64,
    pub priced: u32,
    pub unpriced: u32,
    pub stale: u32,
    pub rows: Vec<RowPrice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PricePoint {
    pub at: String,
    pub stage_index: u32,
    pub chaos: f64,
    pub build_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildPrice {
    pub record_id: String,
    pub league: String,
    pub active_stage: u32,
    pub divine_chaos: Option<f64>,
    pub refresh_requested_at: Option<String>,
    pub stages: Vec<StagePrice>,
    pub history: Vec<PricePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildPriceSummary {
    pub record_id: String,
    pub league: String,
    pub active_stage: u32,
    pub stage_title: Option<String>,
    pub chaos: f64,
    pub divine_chaos: Option<f64>,
    pub priced: u32,
    pub unpriced: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildPriceEvent {
    pub id: i64,
    pub record_id: String,
    pub stage_index: u32,
    pub row_key: Option<String>,
    /// `STAGE_PRICE_CHANGED`, `ITEM_PRICE_CHANGED`, `ITEM_NO_MARKET`.
    pub kind: String,
    /// `{ before, after, title }`.
    #[ts(type = "Record<string, unknown>")]
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildPriceEvents {
    pub cursor: i64,
    pub events: Vec<BuildPriceEvent>,
}

#[derive(Deserialize)]
struct BuildPrices {
    builds: Vec<BuildPriceSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RefreshResult {
    /// Поисков ушло в начало очереди.
    pub queued: u32,
}

/// Набор камней и дерево с тем же названием, что набор предметов `item`, иначе активные (как `matchStage` экрана).
fn match_stage(build: &PobBuild, item: usize) -> (usize, usize) {
    let name = build.item_sets.get(item).and_then(|s| s.title.as_deref()).map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty());
    let same = |title: Option<&str>| matches!((title.map(|t| t.trim().to_lowercase()), &name), (Some(t), Some(n)) if &t == n);
    let skill = build.skill_sets.iter().position(|s| same(s.title.as_deref())).unwrap_or(build.active_skill_set);
    let tree = build.tree_specs.iter().position(|t| same(t.title.as_deref())).unwrap_or(build.active_tree_spec);
    (skill, tree)
}

/// Этапы билда для `PUT /v1/builds/:recordId/tracking`.
fn snapshot(app: &AppHandle, code: &str) -> Result<(String, Vec<Value>), String> {
    let build = pob_parser::parse_code(code).map_err(|e| e.to_string())?;
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let dataset_id = catalog.manifest.dataset_id.clone();
    let prices = app.state::<PricesService>();
    let variants = |id: &str| prices.variants(id);
    let stats = catalog.trade_stats.as_ref().and_then(|s| s.as_ref().ok()).cloned();
    let mut stages = Vec::new();
    for item_set in 0..build.item_sets.len().min(MAX_STAGES) {
        let (skill, tree) = match_stage(&build, item_set);
        let result = stage(&build, &catalog, &variants, stats.as_deref(), None, item_set, skill, tree);
        let rows: Vec<Value> = result.rows.iter().filter(|row| row.counted && !row.slot.contains("Swap")).map(row_json).collect();
        stages.push(json!({ "index": item_set, "title": build.item_sets[item_set].title, "rows": rows }));
    }
    Ok((dataset_id, stages))
}

fn row_json(row: &PobStageRow) -> Value {
    let unpriced = json!({ "rowKey": row.key, "kind": "UNPRICED" });
    let aggregate = || match &row.catalog_item {
        Some(entry) => {
            let variant = row.price.as_ref().map(|p| p.variant_key.clone()).or_else(|| row.variant_key.clone()).unwrap_or_default();
            json!({ "rowKey": row.key, "kind": "AGGREGATE", "itemId": entry.id, "variantKey": variant })
        }
        None => unpriced.clone(),
    };
    if row.gem.is_some() {
        return aggregate();
    }
    match row.item.as_ref().map(|item| item.rarity) {
        Some(PobRarity::Rare | PobRarity::Magic) => match row.spec.as_ref().map(ladder) {
            Some(ladder) if !ladder.is_empty() => json!({ "rowKey": row.key, "kind": "TRADE", "ladder": ladder }),
            _ => unpriced,
        },
        Some(_) => aggregate(),
        None => unpriced,
    }
}

/// Три поиска от строгого к мягкому; одинаковые схлопываются.
fn ladder(spec: &TradeSearchSpec) -> Vec<Value> {
    let mut steps: Vec<Value> = Vec::new();
    for keep in [None, Some(4), Some(2)] {
        let mut step = spec.clone();
        if let Some(keep) = keep {
            step.use_pseudo = true;
            let mut ranked: Vec<usize> = step
                .mods
                .iter()
                .enumerate()
                .filter(|(_, m)| m.enabled && m.stat_id.is_some() && m.pseudo.is_none())
                .map(|(i, _)| i)
                .collect();
            ranked.sort_by_key(|&i| std::cmp::Reverse(importance(&step.mods[i].line)));
            for &i in ranked.iter().skip(keep) {
                step.mods[i].enabled = false;
            }
        }
        if let Ok(payload) = build_query(&step)
            && !steps.contains(&payload)
        {
            steps.push(payload);
        }
    }
    steps
}

/// Насколько мод решает цену вещи: при ослаблении поиска остаются самые важные.
fn importance(line: &str) -> u32 {
    let l = line.to_lowercase();
    let has = |words: &[&str]| words.iter().all(|w| l.contains(w));
    if has(&["to level of", "gem"]) {
        100
    } else if has(&["maximum life"]) {
        90
    } else if has(&["energy shield"]) {
        85
    } else if has(&["movement speed"]) {
        80
    } else if has(&["physical damage"]) || has(&["adds", "damage"]) {
        75
    } else if has(&["critical strike multiplier"]) {
        70
    } else if has(&["critical strike chance"]) {
        65
    } else if has(&["attack speed"]) || has(&["cast speed"]) {
        60
    } else if has(&["damage"]) {
        50
    } else if has(&["resistance"]) {
        40
    } else if has(&["strength"]) || has(&["dexterity"]) || has(&["intelligence"]) || has(&["attributes"]) {
        30
    } else {
        10
    }
}

fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Ошибка сервера — словами для человека.
fn describe(error: SignedInError) -> String {
    if let SignedInError::Api(e) = &error {
        let code = e.errors.first().map(|f| f.code);
        let text = match code {
            Some(-1_100_000) => Some("У аккаунта нет права отслеживать цены билдов — попросите владельца выдать роль «доверенный».".to_string()),
            Some(-1_100_001) => Some("Отслеживать можно не больше двух билдов — выключите отслеживание другого.".to_string()),
            Some(-1_100_002) => Some(format!("Сервер не принял снимок билда: {}", e.errors[0].message)),
            Some(-1_100_003) => Some("Билд ещё не синхронизирован с аккаунтом — подождите синхронизацию и повторите.".to_string()),
            Some(-1_100_004) => Some("Этот билд не отслеживается.".to_string()),
            Some(-1_100_005) => Some("Оценить сейчас можно раз в час.".to_string()),
            Some(-100_000) => Some("Сервер не знает эту лигу.".to_string()),
            _ => None,
        };
        if let Some(text) = text {
            return text;
        }
    }
    error.message()
}

fn record_path(record_id: &str, tail: &str) -> String {
    format!("/v1/builds/{}/{tail}", encode(record_id))
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/// Включить отслеживание или обновить снимок (новый код, новый набор данных). Лига — из шапки.
#[tauri::command]
pub async fn build_tracking_enable(app: AppHandle, record_id: String, code: String, active_stage: u32, disabled_stages: Vec<u32>) -> Result<TrackingSummary, String> {
    blocking(move || {
        let league = app.state::<PricesService>().league().ok_or("лига не выбрана")?;
        let (dataset_id, stages) = snapshot(&app, &code)?;
        let body = json!({
            "league": league,
            "code": code,
            "datasetId": dataset_id,
            "activeStage": active_stage,
            "disabledStages": disabled_stages,
            "stages": stages,
        });
        let summary = send_signed_in_raw::<TrackingSummary>(&app, || Call::put(record_path(&record_id, "tracking"), body.clone()).timeout(std::time::Duration::from_secs(60))).map_err(describe)?;
        app.state::<MarketService>().wake();
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn build_tracking_update(app: AppHandle, record_id: String, active_stage: u32, disabled_stages: Vec<u32>) -> Result<(), String> {
    blocking(move || {
        let body = json!({ "activeStage": active_stage, "disabledStages": disabled_stages });
        send_signed_in_raw::<Option<Value>>(&app, || Call::patch(record_path(&record_id, "tracking"), body.clone())).map(|_| ()).map_err(describe)
    })
    .await
}

#[tauri::command]
pub async fn build_tracking_disable(app: AppHandle, record_id: String) -> Result<(), String> {
    blocking(move || send_signed_in_raw::<Option<Value>>(&app, || Call::delete(record_path(&record_id, "tracking"))).map(|_| ()).map_err(describe)).await
}

/// «Оценить сейчас»: поиски выбранного этапа — в начало очереди, свой искатель — сразу за дело.
#[tauri::command]
pub async fn build_tracking_refresh(app: AppHandle, record_id: String) -> Result<RefreshResult, String> {
    blocking(move || {
        let result = send_signed_in_raw::<RefreshResult>(&app, || Call::post(record_path(&record_id, "tracking/refresh"), json!({}))).map_err(describe)?;
        app.state::<MarketService>().wake();
        Ok(result)
    })
    .await
}

/// Цена этапов сейчас и история: `range` — `week`, `month`, `all`.
#[tauri::command]
pub async fn build_price(app: AppHandle, record_id: String, range: String) -> Result<BuildPrice, String> {
    blocking(move || send_signed_in_raw::<BuildPrice>(&app, || Call::get(record_path(&record_id, "price")).query("range", range.clone())).map_err(describe)).await
}

/// Цена выбранного этапа у всех отслеживаемых билдов (бейджи библиотеки).
#[tauri::command]
pub async fn build_prices(app: AppHandle) -> Result<Vec<BuildPriceSummary>, String> {
    blocking(move || send_signed_in_raw::<BuildPrices>(&app, || Call::get("/v1/builds/prices")).map(|r| r.builds).map_err(describe)).await
}

/// События цены после курсора; без курсора — только курсор.
#[tauri::command]
pub async fn build_price_events(app: AppHandle, since: Option<i64>) -> Result<BuildPriceEvents, String> {
    blocking(move || {
        send_signed_in_raw::<BuildPriceEvents>(&app, || {
            let call = Call::get("/v1/market/events");
            match since {
                Some(since) => call.query("since", since.to_string()),
                None => call,
            }
        })
        .map_err(describe)
    })
    .await
}
