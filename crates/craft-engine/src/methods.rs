//! Методы крафта в один шаг — перекрафт до попадания: сфера перемен (магический), хаоса и
//! ископаемые (редкий). Каждая попытка независима, число попыток — геометрическое.

use std::collections::HashMap;

use serde::Serialize;

use crate::data::Fossil;
use crate::exact::{Rarity, reroll_hit_probability};
use crate::pool::{Base, fossil_applies};
use crate::{Engine, EngineError};

/// Ископаемые-кандидаты, из которых перебираются наборы (лучшие по одиночной вероятности).
const FOSSIL_CANDIDATES: usize = 6;

/// В резонаторе не больше 4 гнёзд.
const MAX_FOSSILS: usize = 4;

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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Method {
    /// Сфера превращения, затем сферы перемен до попадания.
    Alteration,
    /// Сфера алхимии, затем сферы хаоса до попадания.
    Chaos,
    /// Резонатор с ископаемыми на каждую попытку.
    #[serde(rename_all = "camelCase")]
    Fossil {
        fossils: Vec<String>,
        resonator_sockets: u8,
    },
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
    /// Вероятность попадания за попытку.
    pub probability: f64,
    pub attempts: Spread,
    /// Первая попытка (превращение, алхимия), в хаосах.
    pub start_cost: f64,
    /// Каждая следующая попытка, в хаосах.
    pub attempt_cost: f64,
    /// Стоимость крафта без базы, в хаосах.
    pub cost: Spread,
}

/// Оценки одношаговых методов для цели на базе; методы без цен или с нулевым шансом пропущены.
/// Из наборов ископаемых — один, с наименьшей ожидаемой стоимостью.
pub fn evaluate_one_step(
    engine: &Engine,
    base: Base,
    target: &[String],
    prices: &Prices,
) -> Result<Vec<Estimate>, EngineError> {
    let currency = &engine.data().currency;
    let plain = engine.pool(base, &[], target)?;
    let mut estimates = Vec::new();

    if !plain.target_reachable() {
        return Ok(estimates);
    }

    let starts = [
        (
            Method::Alteration,
            Rarity::Magic,
            currency.transmutation.as_deref(),
            &currency.alteration,
        ),
        (
            Method::Chaos,
            Rarity::RareJewel,
            currency.alchemy.as_deref(),
            &currency.chaos,
        ),
    ];

    for (method, rarity, start, attempt) in starts {
        let (Some(start), Some(attempt)) =
            (start.and_then(|id| prices.get(id)), prices.get(attempt))
        else {
            continue;
        };
        let probability = reroll_hit_probability(&plain, rarity);

        if let Some(estimate) = estimate(method, probability, start, attempt) {
            estimates.push(estimate);
        }
    }

    if let Some(fossil) = best_fossils(engine, base, target, prices)? {
        estimates.push(fossil);
    }

    Ok(estimates)
}

/// Перебор наборов ископаемых: кандидаты — применимые к базе, без своих модов, с ценой и с
/// попаданием больше нуля в одиночку; из них берутся лучшие по вероятности и все их наборы
/// до 4 штук.
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

        let probability =
            reroll_hit_probability(&engine.pool(base, &[fossil], target)?, Rarity::RareJewel);

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
        let sockets = chosen.len() as u8;

        if chosen.len() > MAX_FOSSILS {
            continue;
        }

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

        // Ископаемые расходуются уже на первой попытке: отдельного начала нет.
        let Some(candidate) = estimate(method, probability, attempt, attempt) else {
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

fn estimate(
    method: Method,
    probability: f64,
    start_cost: f64,
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
    let cost_of = |attempts: f64| start_cost + attempt_cost * (attempts - 1.0);

    Some(Estimate {
        method,
        probability,
        attempts,
        start_cost,
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
