//! План крафта цели: какую базу купить (энчант, уровень) и каким методом крафтить, чтобы
//! вложения были наименьшими, а прибыль — наибольшей.

use std::collections::HashMap;

use serde::Serialize;

use crate::methods::{Estimate, Prices, evaluate_base};
use crate::pool::Base;
use crate::{Engine, EngineError};

/// База, которую можно купить: энчант, уровень предмета и цена в хаосах.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOffer {
    pub enchant: String,
    pub item_level: u32,
    pub price: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub base: BaseOffer,
    pub estimate: Estimate,
    /// База + ожидаемая стоимость крафта, в хаосах.
    pub total_cost: f64,
    /// База + стоимость крафта в неудачном случае (p90).
    pub total_cost_p90: f64,
    /// Цена продажи − вложения; без цены продажи нет.
    pub profit: Option<f64>,
    /// Прибыль к вложениям.
    pub roi: Option<f64>,
}

/// Лучший план каждого вида метода (по наименьшим вложениям), дешёвые сначала; первый — лучший.
/// Ископаемые перебираются только для `fossil_offers` самых дешёвых по простым методам баз:
/// это самая долгая часть расчёта.
pub fn plan_target(
    engine: &Engine,
    size: &str,
    target: &[String],
    offers: &[BaseOffer],
    prices: &Prices,
    sale_price: Option<f64>,
    fossil_offers: usize,
) -> Result<Vec<Plan>, EngineError> {
    let mut plans: Vec<Plan> = Vec::new();

    for offer in offers {
        let base = Base {
            size,
            enchant: &offer.enchant,
            item_level: offer.item_level,
        };

        for estimate in evaluate_base(engine, base, target, prices, false)? {
            plans.push(plan(offer, estimate, sale_price));
        }
    }

    let mut cheapest: Vec<(&BaseOffer, f64)> = offers
        .iter()
        .map(|offer| {
            let best = plans
                .iter()
                .filter(|plan| plan.base == *offer)
                .map(|plan| plan.total_cost)
                .fold(f64::INFINITY, f64::min);

            (offer, best)
        })
        .collect();

    cheapest.sort_by(|left, right| left.1.total_cmp(&right.1));

    for (offer, _) in cheapest.into_iter().take(fossil_offers) {
        let base = Base {
            size,
            enchant: &offer.enchant,
            item_level: offer.item_level,
        };

        for estimate in evaluate_base(engine, base, target, prices, true)? {
            if estimate.method.kind() == "fossil" {
                plans.push(plan(offer, estimate, sale_price));
            }
        }
    }

    let mut best: HashMap<&'static str, Plan> = HashMap::new();

    for candidate in plans {
        let kind = candidate.estimate.method.kind();

        if best
            .get(kind)
            .is_none_or(|current| candidate.total_cost < current.total_cost)
        {
            best.insert(kind, candidate);
        }
    }

    let mut result: Vec<Plan> = best.into_values().collect();

    result.sort_by(|left, right| left.total_cost.total_cmp(&right.total_cost));

    Ok(result)
}

fn plan(offer: &BaseOffer, estimate: Estimate, sale_price: Option<f64>) -> Plan {
    let total_cost = offer.price + estimate.cost.mean;
    let profit = sale_price.map(|sale| sale - total_cost);

    Plan {
        base: offer.clone(),
        total_cost_p90: offer.price + estimate.cost.p90,
        estimate,
        total_cost,
        profit,
        roi: profit
            .filter(|_| total_cost > 0.0)
            .map(|profit| profit / total_cost),
    }
}
