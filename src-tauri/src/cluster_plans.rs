//! Планы целей «Выгодных кластеров» без Tauri: ответ сервера, цены и данные игры → строки
//! списка и карточки целей. Обёртка с потоком и командами — `clusters.rs`.

use std::collections::HashMap;
use std::thread;

use craft_engine::data::ClusterSize;
use craft_engine::{BaseOffer, Engine, Method, Plan, Prices};
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

/// Ископаемые перебираются для стольких самых дешёвых баз цели (самая долгая часть расчёта).
const FOSSIL_OFFERS: usize = 2;

/// Цены лиги и названия предметов: прайс и справочник приложения (или их снимок на диске).
pub trait MarketData: Sync {
    /// Сводная цена простого предмета (`variantKey = ''`), chaos.
    fn chaos(&self, item_id: &str) -> Option<f64>;
    /// Варианты предмета с ценой: ключ варианта и chaos.
    fn variants(&self, item_id: &str) -> Vec<(String, f64)>;
    fn item_name(&self, item_id: &str) -> Option<ClusterName>;
}

/// Посчитанные цели: строки списка в порядке ответа и карточки по ключу.
pub struct Computed {
    pub rows: Vec<ClusterRow>,
    pub details: HashMap<String, ClusterDetail>,
}
// ---------- ответ сервера ----------

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClusterDemand {
    /// Версия снимка билдов poe.ninja.
    pub ninja_version: String,
    /// Персонажей в снимке.
    pub total: u32,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClusterTargetDemand {
    /// Персонажей с notable (с обоими, если их два).
    pub characters: u32,
    /// Доля персонажей лиги.
    pub share: f64,
    /// Доля сутки назад; `null` — неизвестна.
    pub previous_share: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ClusterMarketStatus {
    /// Объявлений достаточно, цена есть.
    Ok,
    /// Меньше трёх объявлений.
    NoMarket,
    /// Последняя проверка не удалась; цены — от предыдущей.
    Failed,
    #[serde(other)]
    Unknown,
}

/// Цена цели на сайте торговли (сервер проверяет раз в 1–4 часа).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClusterMarket {
    pub status: ClusterMarketStatus,
    /// Нижний квартиль 10 самых дешёвых объявлений, chaos.
    pub price_chaos: Option<f64>,
    pub min_chaos: Option<f64>,
    /// Объявлений найдено.
    pub listings: Option<u32>,
    pub sampled: Option<u32>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetReply {
    pub key: String,
    pub size: String,
    pub passives: u32,
    pub min_ilvl: u32,
    /// Английские имена notable — ключи `crafting.json`.
    pub notables: Vec<String>,
    /// Энчанты размера, на которых выпадают все notable цели.
    pub enchants: Vec<String>,
    pub demand: ClusterTargetDemand,
    pub market: Option<ClusterMarket>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClustersReply {
    pub league: String,
    pub tracked: bool,
    pub demand: Option<ClusterDemand>,
    pub targets: Vec<TargetReply>,
}

// ---------- результат расчёта ----------

/// Название на двух языках.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ClusterName {
    pub en: String,
    pub ru: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CraftMethodKind {
    /// Превращение, затем сферы перемен.
    Alteration,
    /// Перемены и усиление.
    AltAug,
    /// Перемены, усиление, царь; неудача — очищение и заново.
    AltAugRegal,
    /// То же и возвышение после царя.
    AltAugRegalExalt,
    /// Алхимия, затем сферы хаоса.
    Chaos,
    /// Резонатор с ископаемыми.
    Fossil,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CraftFossil {
    pub item_id: String,
    pub name: ClusterName,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
pub struct CraftSpread {
    pub mean: f64,
    pub p50: f64,
    pub p90: f64,
}

/// Как получить цель: какую базу купить и как крафтить.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CraftPlan {
    pub method: CraftMethodKind,
    /// Ископаемые (только у `fossil`).
    pub fossils: Vec<CraftFossil>,
    pub resonator_sockets: Option<u8>,
    pub enchant_id: String,
    pub enchant: ClusterName,
    /// Уровень базы (ступень цен poe.ninja: 1, 50, 68, 75, 84 и выше).
    pub item_level: u32,
    pub base_price: f64,
    /// Шанс закончить цель одной попыткой.
    pub probability: f64,
    pub attempts: CraftSpread,
    /// Ожидаемая цена попытки, chaos.
    pub attempt_cost: f64,
    /// Стоимость крафта без базы, chaos.
    pub craft_cost: CraftSpread,
    /// База + ожидаемая стоимость крафта.
    pub total_cost: f64,
    /// База + стоимость крафта при неудаче (p90).
    pub total_cost_p90: f64,
    /// Цена продажи − вложения; без цены продажи — `null`.
    pub profit: Option<f64>,
    pub roi: Option<f64>,
    /// Запрос сайта торговли для покупки базы (`?q=` поиска): белая база с энчантом, числом
    /// пассивов и уровнем не ниже нужного, мгновенный выкуп, дешёвые сначала.
    #[ts(type = "unknown")]
    pub trade_base: Option<serde_json::Value>,
}

/// Валюта крафта: цена прайса и действующая (своя, если задана).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CraftCurrency {
    /// `transmutation`, `alteration`, `augmentation`, `regal`, `exalted`, `alchemy`, `chaos`, `scouring`.
    pub key: String,
    pub item_id: String,
    pub name: ClusterName,
    /// Цена прайса лиги, chaos.
    pub market_chaos: Option<f64>,
    /// Своя цена пользователя, chaos.
    pub own_chaos: Option<f64>,
}

/// Почему у цели нет плана или прибыли.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ClusterIssue {
    /// Цели нет в `crafting.json` (другой патч) или она не выпадает на энчантах.
    Unreachable,
    /// В прайсе нет баз нужного числа пассивов и уровня на подходящих энчантах.
    NoBasePrice,
    /// Нет цен валюты ни для одного метода.
    NoCurrencyPrice,
    /// Сайт торговли ещё не проверял цель.
    NotQuoted,
    /// Меньше трёх объявлений: продать не по чему.
    NoMarket,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClusterRow {
    pub key: String,
    pub size: String,
    pub size_name: ClusterName,
    pub passives: u32,
    pub min_ilvl: u32,
    pub notables: Vec<ClusterName>,
    pub demand: ClusterTargetDemand,
    pub market: Option<ClusterMarket>,
    /// Лучший план: наименьшие вложения.
    pub best: Option<CraftPlan>,
    /// Сколько методов посчитано (по одному плану каждого вида).
    pub plans: u32,
    pub issue: Option<ClusterIssue>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClusterDetail {
    pub row: ClusterRow,
    /// Лучший план каждого метода, дешёвые сначала.
    pub plans: Vec<CraftPlan>,
    /// Энчанты, на которых выпадает цель.
    pub enchants: Vec<ClusterName>,
    /// Запрос сайта торговли готовых самоцветов цели (как проверяет цену сервер).
    #[ts(type = "unknown")]
    pub trade_target: Option<serde_json::Value>,
}

/// «Adds # Passive Skills», строка энчанта числа пассивов на сайте торговли.
const PASSIVES_STAT: &str = "enchant.stat_3086156145";

/// Валюта, которую видит и может переоценить пользователь: ключ и id предмета.
pub fn craft_currency_ids(engine: &Engine) -> Vec<(&'static str, String)> {
    let currency = &engine.data().currency;
    let mut ids = Vec::new();
    if let Some(id) = &currency.transmutation {
        ids.push(("transmutation", id.clone()));
    }
    ids.push(("alteration", currency.alteration.clone()));
    ids.push(("augmentation", currency.augmentation.clone()));
    ids.push(("regal", currency.regal.clone()));
    ids.push(("exalted", currency.exalted.clone()));
    if let Some(id) = &currency.alchemy {
        ids.push(("alchemy", id.clone()));
    }
    ids.push(("chaos", currency.chaos.clone()));
    ids.push(("scouring", currency.scouring.clone()));
    ids
}

/// Планы всех целей ответа, в нескольких потоках. `own` — свои цены пользователя (id → chaos),
/// они важнее прайса.
pub fn compute(engine: &Engine, data: &dyn MarketData, reply: &ClustersReply, own: &HashMap<String, f64>) -> Computed {
    let market = market_prices(engine, data, own);
    let offers = BaseOffers::new(engine, data);
    let workers = thread::available_parallelism().map_or(2, |n| n.get()).saturating_sub(1).clamp(1, 8);
    let chunk = reply.targets.len().div_ceil(workers).max(1);
    let mut results: Vec<(ClusterRow, ClusterDetail)> = Vec::with_capacity(reply.targets.len());

    thread::scope(|scope| {
        let handles: Vec<_> = reply
            .targets
            .chunks(chunk)
            .map(|targets| {
                let (market, offers) = (&market, &offers);
                scope.spawn(move || targets.iter().map(|target| evaluate(engine, data, market, offers, target)).collect::<Vec<_>>())
            })
            .collect();

        for handle in handles {
            results.extend(handle.join().unwrap_or_default());
        }
    });

    let mut rows = Vec::with_capacity(results.len());
    let mut details = HashMap::with_capacity(results.len());

    for (row, detail) in results {
        rows.push(row);
        details.insert(detail.row.key.clone(), detail);
    }

    Computed { rows, details }
}

/// Цены валюты, резонаторов и ископаемых из прайса лиги.
fn market_prices(engine: &Engine, data: &dyn MarketData, own: &HashMap<String, f64>) -> Prices {
    let currency = &engine.data().currency;
    let mut ids: Vec<&String> = vec![
        &currency.alteration,
        &currency.augmentation,
        &currency.regal,
        &currency.exalted,
        &currency.chaos,
        &currency.scouring,
        &currency.annulment,
    ];
    ids.extend(currency.transmutation.iter());
    ids.extend(currency.alchemy.iter());
    ids.extend(currency.resonators.iter().flat_map(|r| r.item_ids.iter()));
    ids.extend(engine.data().fossils.iter().map(|f| &f.item_id));

    let mut map = HashMap::new();
    for id in ids {
        if let Some(price) = own.get(id).copied().filter(|p| *p > 0.0).or_else(|| data.chaos(id)) {
            map.insert(id.clone(), price);
        }
    }
    // Хаос — единица цены: в прайсе его может не быть.
    map.entry(currency.chaos.clone()).or_insert(1.0);
    Prices::new(map)
}

/// Цены баз кластеров по размеру: энчант, пассивы, уровень (ключ варианта poe.ninja / poe.watch).
struct BaseOffers {
    /// Размер → (id энчанта, пассивы, уровень, цена).
    by_size: HashMap<String, Vec<(String, u32, u32, f64)>>,
}

impl BaseOffers {
    fn new(engine: &Engine, market: &dyn MarketData) -> Self {
        let data = engine.data();
        let mut by_size = HashMap::new();

        for size in &data.clusters.sizes {
            let lookup = enchant_lookup(engine, size);
            let mut offers = Vec::new();

            for (variant_key, chaos) in market.variants(&size.item_id) {
                let fields: HashMap<&str, &str> = variant_key.split(';').filter_map(|part| part.split_once('=')).collect();
                let (Some(enchant), Some(passives), Some(item_level)) = (
                    fields.get("enchant").and_then(|text| lookup.get(&text.trim().to_lowercase())),
                    fields.get("passives").and_then(|v| v.parse::<u32>().ok()),
                    fields.get("ilvl").and_then(|v| v.parse::<u32>().ok()),
                ) else {
                    continue;
                };
                if chaos > 0.0 {
                    offers.push((enchant.clone(), passives, item_level, chaos));
                }
            }
            by_size.insert(size.id.clone(), offers);
        }

        Self { by_size }
    }

    /// Базы для цели: нужные пассивы, уровень не ниже нужного, энчант из подходящих. Из баз
    /// одного энчанта остаются только те, что дешевле всех баз ниже уровнем: база выше уровнем
    /// добавляет моды в пул (шанс не растёт) и дороже — она хуже.
    fn for_target(&self, target: &TargetReply) -> Vec<BaseOffer> {
        let mut result = Vec::new();
        let Some(offers) = self.by_size.get(&target.size) else { return result };

        for enchant in &target.enchants {
            let mut fitting: Vec<&(String, u32, u32, f64)> =
                offers.iter().filter(|(id, passives, level, _)| id == enchant && *passives == target.passives && *level >= target.min_ilvl).collect();
            fitting.sort_by_key(|(_, _, level, _)| *level);

            let mut cheapest = f64::INFINITY;
            for (id, _, level, price) in fitting {
                if *price < cheapest {
                    cheapest = *price;
                    result.push(BaseOffer { enchant: id.clone(), item_level: *level, price: *price });
                }
            }
        }

        result
    }
}

/// Текст энчанта, как его пишут источники цен (строки через перевод строки или «, », в любом
/// порядке, нижний регистр) → id энчанта размера.
fn enchant_lookup(engine: &Engine, size: &ClusterSize) -> HashMap<String, String> {
    let mut lookup = HashMap::new();

    for enchant in engine.data().clusters.enchants.iter().filter(|e| e.size == size.id) {
        let lines: Vec<String> = enchant.lines.en.iter().map(|l| l.trim().to_lowercase()).collect();
        let mut orders = vec![lines.clone()];
        if lines.len() == 2 {
            orders.push(vec![lines[1].clone(), lines[0].clone()]);
        }
        for order in orders {
            for separator in ["\n", ", "] {
                lookup.insert(order.join(separator), enchant.id.clone());
            }
        }
    }

    lookup
}

fn evaluate(engine: &Engine, names: &dyn MarketData, market: &Prices, offers: &BaseOffers, target: &TargetReply) -> (ClusterRow, ClusterDetail) {
    let data = engine.data();
    let size = data.clusters.sizes.iter().find(|size| size.id == target.size);
    let known = size.is_some() && target.notables.iter().all(|name| data.clusters.mods.iter().any(|m| m.notable.as_ref().is_some_and(|n| n.name.en == *name)));
    let sale = target.market.as_ref().filter(|m| m.status == ClusterMarketStatus::Ok).and_then(|m| m.price_chaos);
    let base_offers = offers.for_target(target);
    let plans: Vec<Plan> = if known && !base_offers.is_empty() {
        craft_engine::plan_target(engine, &target.size, &target.notables, &base_offers, market, sale, FOSSIL_OFFERS).unwrap_or_default()
    } else {
        Vec::new()
    };
    let plans: Vec<CraftPlan> = plans.iter().map(|plan| craft_plan(engine, names, plan, target)).collect();
    let issue = if !known || target.enchants.is_empty() {
        Some(ClusterIssue::Unreachable)
    } else if base_offers.is_empty() {
        Some(ClusterIssue::NoBasePrice)
    } else if plans.is_empty() {
        Some(ClusterIssue::NoCurrencyPrice)
    } else {
        match target.market.as_ref().map(|m| m.status) {
            None => Some(ClusterIssue::NotQuoted),
            Some(ClusterMarketStatus::NoMarket) => Some(ClusterIssue::NoMarket),
            _ if sale.is_none() => Some(ClusterIssue::NotQuoted),
            _ => None,
        }
    };
    let row = ClusterRow {
        key: target.key.clone(),
        size: target.size.clone(),
        size_name: size.map_or_else(|| ClusterName { en: target.size.clone(), ru: None }, |s| ClusterName { en: s.name.en.clone(), ru: s.name.ru.clone() }),
        passives: target.passives,
        min_ilvl: target.min_ilvl,
        notables: target.notables.iter().map(|name| notable_name(engine, name)).collect(),
        demand: target.demand.clone(),
        market: target.market.clone(),
        best: plans.first().cloned(),
        plans: plans.len() as u32,
        issue,
    };
    let enchants = target.enchants.iter().map(|id| enchant_name(engine, &target.size, id)).collect();
    let trade_target = target_query(engine, target);

    (row.clone(), ClusterDetail { row, plans, enchants, trade_target })
}

/// Запрос готовых самоцветов цели: база, notable, пассивов не больше, мгновенный выкуп.
fn target_query(engine: &Engine, target: &TargetReply) -> Option<serde_json::Value> {
    let data = engine.data();
    let size = data.clusters.sizes.iter().find(|size| size.id == target.size)?;
    let mut filters = Vec::new();
    for name in &target.notables {
        let stat = data.clusters.mods.iter().find_map(|m| m.notable.as_ref().filter(|n| n.name.en == *name).and_then(|n| n.trade_stat_id.clone()))?;
        filters.push(json!({ "id": stat }));
    }
    filters.push(json!({ "id": PASSIVES_STAT, "value": { "max": target.passives } }));
    Some(json!({
        "query": {
            "status": { "option": "securable" },
            "type": size.name.en,
            "stats": [{ "type": "and", "filters": filters }],
            "filters": { "misc_filters": { "filters": { "corrupted": { "option": "false" } } } }
        },
        "sort": { "price": "asc" }
    }))
}

/// Запрос базы плана: белая, энчант, ровно столько пассивов, уровень не ниже, мгновенный выкуп.
fn base_query(engine: &Engine, target: &TargetReply, enchant_id: &str, item_level: u32) -> Option<serde_json::Value> {
    let data = engine.data();
    let size = data.clusters.sizes.iter().find(|size| size.id == target.size)?;
    let enchant = data.clusters.enchants.iter().find(|e| e.size == target.size && e.id == enchant_id)?;
    // `enchant.stat_3948993189|11`: фильтр энчанта и номер варианта в нём.
    let (stat, option) = enchant.trade_stat_ids.first()?.split_once('|')?;
    let option: u32 = option.parse().ok()?;
    Some(json!({
        "query": {
            "status": { "option": "securable" },
            "type": size.name.en,
            "stats": [{ "type": "and", "filters": [
                { "id": stat, "value": { "option": option } },
                { "id": PASSIVES_STAT, "value": { "min": target.passives, "max": target.passives } }
            ] }],
            "filters": {
                "type_filters": { "filters": { "rarity": { "option": "normal" } } },
                "misc_filters": { "filters": { "ilvl": { "min": item_level }, "corrupted": { "option": "false" } } }
            }
        },
        "sort": { "price": "asc" }
    }))
}

fn craft_plan(engine: &Engine, names: &dyn MarketData, plan: &Plan, target: &TargetReply) -> CraftPlan {
    let (method, fossils, resonator_sockets) = match &plan.estimate.method {
        Method::Alteration => (CraftMethodKind::Alteration, Vec::new(), None),
        Method::AltAug => (CraftMethodKind::AltAug, Vec::new(), None),
        Method::AltAugRegal => (CraftMethodKind::AltAugRegal, Vec::new(), None),
        Method::AltAugRegalExalt => (CraftMethodKind::AltAugRegalExalt, Vec::new(), None),
        Method::Chaos => (CraftMethodKind::Chaos, Vec::new(), None),
        Method::Fossil { fossils, resonator_sockets } => (
            CraftMethodKind::Fossil,
            fossils
                .iter()
                .map(|id| {
                    let name = names.item_name(id).unwrap_or_else(|| ClusterName { en: engine.fossil(id).map_or_else(|| id.clone(), |f| f.name.clone()), ru: None });
                    CraftFossil { item_id: id.clone(), name }
                })
                .collect(),
            Some(*resonator_sockets),
        ),
    };
    let spread = |s: craft_engine::Spread| CraftSpread { mean: s.mean, p50: s.p50, p90: s.p90 };

    CraftPlan {
        method,
        fossils,
        resonator_sockets,
        enchant_id: plan.base.enchant.clone(),
        enchant: enchant_name(engine, &target.size, &plan.base.enchant),
        trade_base: base_query(engine, target, &plan.base.enchant, plan.base.item_level),
        item_level: plan.base.item_level,
        base_price: plan.base.price,
        probability: plan.estimate.probability,
        attempts: spread(plan.estimate.attempts),
        attempt_cost: plan.estimate.attempt_cost,
        craft_cost: spread(plan.estimate.cost),
        total_cost: plan.total_cost,
        total_cost_p90: plan.total_cost_p90,
        profit: plan.profit,
        roi: plan.roi,
    }
}

fn notable_name(engine: &Engine, name: &str) -> ClusterName {
    let ru = engine.data().clusters.mods.iter().find_map(|m| m.notable.as_ref().filter(|n| n.name.en == name).and_then(|n| n.name.ru.clone()));
    ClusterName { en: name.to_owned(), ru }
}

fn enchant_name(engine: &Engine, size: &str, id: &str) -> ClusterName {
    engine
        .data()
        .clusters
        .enchants
        .iter()
        .find(|e| e.id == id && (size.is_empty() || e.size == size))
        .map_or_else(|| ClusterName { en: id.to_owned(), ru: None }, |e| ClusterName { en: e.name.en.clone(), ru: e.name.ru.clone() })
}

