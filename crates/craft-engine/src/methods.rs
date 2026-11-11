//! Методы крафта на одной базе: шанс попытки, попытки и стоимость.
//!
//! Любой метод — повторение одинаковых независимых попыток до успеха (неудача после царя
//! возвращает к сферам перемен), поэтому число попыток — геометрическое с шансом попытки `π`:
//! стоимость = добавка первой попытки + цена попытки × попытки. Квантили стоимости берутся по
//! квантилям числа попыток (разброс цены внутри попытки — усиления, цари — не учитывается).

use std::collections::HashMap;

use serde::Serialize;

use crate::data::Fossil;
use crate::data::Harvest;
use crate::exact::{Rarity, harvest_hit_probability, reroll_hit_probability};
use crate::pool::Pool;
use crate::pool::{Base, fossil_applies};
use crate::strategy::{AltCosts, AltPolicy, Decider};
use crate::{Engine, EngineError};

/// Ископаемые-кандидаты, из которых перебираются наборы (лучшие по одиночной вероятности).
const FOSSIL_CANDIDATES: usize = 5;

/// В резонаторе не больше 4 гнёзд; наборы больше трёх почти не нужны и дороги в переборе.
const MAX_FOSSILS: usize = 3;

/// Цены в хаосах по ключу предмета справочника.
#[derive(Debug, Clone, Default)]
pub struct Prices(HashMap<String, f64>);

impl Prices {
    pub fn new(prices: HashMap<String, f64>) -> Self {
        Self(prices)
    }

    pub fn get(&self, item_id: &str) -> Option<f64> {
        self.0.get(item_id).copied().filter(|price| *price > 0.0)
    }

    /// Самый дешёвый из предметов (резонатор бывает двумя предметами).
    fn cheapest<'a>(&self, item_ids: impl IntoIterator<Item = &'a String>) -> Option<f64> {
        item_ids
            .into_iter()
            .filter_map(|id| self.get(id))
            .min_by(f64::total_cmp)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Method {
    /// Превращение, затем сферы перемен.
    Alteration,
    /// Перемены и усиление, если оно может закончить цель.
    AltAug,
    /// Перемены, усиление, царь на предмете с notable цели; неудача — очищение и заново.
    AltAugRegal,
    /// То же и возвышение после царя.
    AltAugRegalExalt,
    /// Алхимия, затем сферы хаоса.
    Chaos,
    /// Резонатор с ископаемыми на каждую попытку.
    #[serde(rename_all = "camelCase")]
    Fossil {
        fossils: Vec<String>,
        resonator_sockets: u8,
    },
    /// Алхимия, затем перековка Harvest «…включая свойство тега» на каждую попытку.
    #[serde(rename_all = "camelCase")]
    Harvest {
        /// Id крафта в игре (`ReforgeAttack`).
        craft: String,
        tag: String,
        /// `wild`, `vivid`, `primal`.
        lifeforce: String,
        /// Жизненной силы за попытку.
        lifeforce_cost: u32,
    },
}

impl Method {
    /// Метод без подробностей — для выбора лучшего плана каждого вида.
    pub fn kind(&self) -> &'static str {
        match self {
            Method::Alteration => "alteration",
            Method::AltAug => "altAug",
            Method::AltAugRegal => "altAugRegal",
            Method::AltAugRegalExalt => "altAugRegalExalt",
            Method::Chaos => "chaos",
            Method::Fossil { .. } => "fossil",
            Method::Harvest { .. } => "harvest",
        }
    }
}

/// Среднее и квантили.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Spread {
    pub mean: f64,
    pub p50: f64,
    pub p90: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    pub method: Method,
    /// Вероятность закончить цель одной попыткой.
    pub probability: f64,
    pub attempts: Spread,
    /// Ожидаемая цена попытки, в хаосах.
    pub attempt_cost: f64,
    /// Стоимость крафта без базы, в хаосах.
    pub cost: Spread,
}

/// Оценки всех методов цели на базе; методы без цен или с нулевым шансом пропущены. Из наборов
/// ископаемых — один, с наименьшей ожидаемой стоимостью (если `with_fossils`).
pub fn evaluate_base(
    engine: &Engine,
    base: Base,
    target: &[String],
    prices: &Prices,
    with_fossils: bool,
) -> Result<Vec<Estimate>, EngineError> {
    let currency = &engine.data().currency;
    let pool = engine.pool(base, &[], target)?;
    let mut estimates = Vec::new();

    if !pool.target_reachable() {
        return Ok(estimates);
    }

    let price = |id: Option<&String>| id.and_then(|id| prices.get(id));

    if let (Some(transmutation), Some(alteration)) = (
        price(currency.transmutation.as_ref()),
        price(Some(&currency.alteration)),
    ) {
        let costs = AltCosts {
            alteration,
            augmentation: price(Some(&currency.augmentation)).unwrap_or(f64::INFINITY),
            regal: price(Some(&currency.regal)).unwrap_or(f64::INFINITY),
            exalted: price(Some(&currency.exalted)).unwrap_or(f64::INFINITY),
            reset: price(Some(&currency.scouring)).unwrap_or(f64::INFINITY) + transmutation
                - alteration,
        };
        let mut decider = Decider::new(&pool);
        let methods = [
            (
                Method::Alteration,
                AltPolicy {
                    augment: false,
                    regal: false,
                    exalt: false,
                },
            ),
            (
                Method::AltAug,
                AltPolicy {
                    augment: true,
                    regal: false,
                    exalt: false,
                },
            ),
            (
                Method::AltAugRegal,
                AltPolicy {
                    augment: true,
                    regal: true,
                    exalt: false,
                },
            ),
            (
                Method::AltAugRegalExalt,
                AltPolicy {
                    augment: true,
                    regal: true,
                    exalt: true,
                },
            ),
        ];
        let mut seen: Vec<(f64, f64)> = Vec::new();

        for (method, policy) in methods {
            let attempt = decider.attempt(policy, costs);

            // Метод, не меняющий ни шанса, ни цены попытки (одиночная цель: царь не нужен),
            // повторял бы предыдущий.
            if seen.iter().any(|(success, cost)| {
                (success - attempt.success).abs() < 1e-12 && (cost - attempt.cost).abs() < 1e-12
            }) {
                continue;
            }

            seen.push((attempt.success, attempt.cost));

            if attempt.cost.is_finite() {
                estimates.extend(estimate(
                    method,
                    attempt.success,
                    transmutation - alteration,
                    attempt.cost,
                ));
            }
        }
    }

    if let (Some(alchemy), Some(chaos)) = (
        price(currency.alchemy.as_ref()),
        price(Some(&currency.chaos)),
    ) {
        let probability = reroll_hit_probability(&pool, Rarity::RareJewel);

        estimates.extend(estimate(Method::Chaos, probability, alchemy - chaos, chaos));
    }

    if let (Some(alchemy), Some(harvest)) =
        (price(currency.alchemy.as_ref()), &engine.data().harvest)
    {
        estimates.extend(best_harvest(&pool, harvest, prices, alchemy));
    }

    if with_fossils {
        estimates.extend(best_fossils(engine, base, target, prices)?);
    }

    Ok(estimates)
}

/// Лучшая перековка Harvest с тегом: пробуются теги notable цели, у которых есть цена жизненной
/// силы. Сначала алхимия (её собственный шанс попасть не учитывается), затем перековки.
fn best_harvest(pool: &Pool, harvest: &Harvest, prices: &Prices, alchemy: f64) -> Option<Estimate> {
    let tags = pool.target_tags();
    let mut best: Option<Estimate> = None;

    for craft in &harvest.crafts {
        let Some(tag) = craft
            .tag
            .as_deref()
            .filter(|tag| craft.kind == "reforgeWithTag" && tags.iter().any(|t| t == tag))
        else {
            continue;
        };
        let Some(unit) = harvest
            .lifeforce
            .get(&craft.lifeforce)
            .and_then(|id| prices.get(id))
        else {
            continue;
        };
        let method = Method::Harvest {
            craft: craft.id.clone(),
            tag: tag.to_owned(),
            lifeforce: craft.lifeforce.clone(),
            lifeforce_cost: craft.cost,
        };
        let Some(candidate) = estimate(
            method,
            harvest_hit_probability(pool, tag),
            alchemy,
            unit * f64::from(craft.cost),
        ) else {
            continue;
        };

        if best
            .as_ref()
            .is_none_or(|current| candidate.cost.mean < current.cost.mean)
        {
            best = Some(candidate);
        }
    }

    best
}

/// Перебор наборов ископаемых: кандидаты — применимые к базе, без своих модов, с ценой и с
/// попаданием больше нуля в одиночку; из них берутся лучшие по вероятности и их наборы.
fn best_fossils(
    engine: &Engine,
    base: Base,
    target: &[String],
    prices: &Prices,
) -> Result<Option<Estimate>, EngineError> {
    let data = engine.data();
    let Some(size) = data.clusters.sizes.iter().find(|size| size.id == base.size) else {
        return Ok(None);
    };
    let resonators: HashMap<u8, f64> = data
        .currency
        .resonators
        .iter()
        .filter_map(|resonator| {
            prices
                .cheapest(&resonator.item_ids)
                .map(|price| (resonator.sockets, price))
        })
        .collect();
    let mut singles: Vec<(&Fossil, f64, f64)> = Vec::new();

    for fossil in &data.fossils {
        let Some(price) = prices.get(&fossil.item_id) else {
            continue;
        };

        if !fossil.added_mods.is_empty()
            || !fossil.forced_mods.is_empty()
            || !fossil_applies(fossil, &size.tags)
        {
            continue;
        }

        let pool = engine.pool(base, &[fossil], target)?;
        let probability = reroll_hit_probability(&pool, Rarity::RareJewel);

        if probability > 0.0 {
            singles.push((fossil, price, probability));
        }
    }

    singles.sort_by(|left, right| right.2.total_cmp(&left.2));
    singles.truncate(FOSSIL_CANDIDATES);

    let mut best: Option<Estimate> = None;

    for mask in 1u32..(1 << singles.len()) {
        let chosen: Vec<&(&Fossil, f64, f64)> = singles
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, single)| single)
            .collect();

        if chosen.len() > MAX_FOSSILS {
            continue;
        }

        let sockets = chosen.len() as u8;
        let Some(resonator) = resonators.get(&sockets) else {
            continue;
        };
        let fossils: Vec<&Fossil> = chosen.iter().map(|(fossil, _, _)| *fossil).collect();
        let probability = if chosen.len() == 1 {
            chosen[0].2
        } else {
            reroll_hit_probability(&engine.pool(base, &fossils, target)?, Rarity::RareJewel)
        };
        let attempt = resonator + chosen.iter().map(|(_, price, _)| price).sum::<f64>();
        let method = Method::Fossil {
            fossils: fossils
                .iter()
                .map(|fossil| fossil.item_id.clone())
                .collect(),
            resonator_sockets: sockets,
        };

        // Ископаемые расходуются уже на первой попытке: добавки нет.
        let Some(candidate) = estimate(method, probability, 0.0, attempt) else {
            continue;
        };

        if best
            .as_ref()
            .is_none_or(|current| candidate.cost.mean < current.cost.mean)
        {
            best = Some(candidate);
        }
    }

    Ok(best)
}

/// Оценка по шансу попытки, добавке первой попытки и цене попытки.
fn estimate(
    method: Method,
    probability: f64,
    first_extra: f64,
    attempt_cost: f64,
) -> Option<Estimate> {
    if probability.is_nan() || probability <= 0.0 {
        return None;
    }

    let attempts = Spread {
        mean: 1.0 / probability,
        p50: attempts_quantile(probability, 0.5),
        p90: attempts_quantile(probability, 0.9),
    };
    let cost_of = |attempts: f64| first_extra + attempt_cost * attempts;

    Some(Estimate {
        method,
        probability,
        attempts,
        attempt_cost,
        cost: Spread {
            mean: cost_of(attempts.mean),
            p50: cost_of(attempts.p50),
            p90: cost_of(attempts.p90),
        },
    })
}

/// Сколько попыток хватает с вероятностью `quantile` (геометрическое распределение).
pub fn attempts_quantile(probability: f64, quantile: f64) -> f64 {
    if probability >= 1.0 {
        return 1.0;
    }

    ((1.0 - quantile).ln() / (1.0 - probability).ln())
        .ceil()
        .max(1.0)
}
