//! Доход от фарма боссов Path of Exile 1.
//!
//! - [`data`] — `bosses.json` из набора данных: боссы, вход, пулы дропа, особые цены;
//! - [`estimate`] — один босс: вход, строки дропа, EV и прибыль за убийство и в час, σ за убийство,
//!   Монте-Карло за час (p10 / p50 / p90, шанс уйти в минус), доля дохода из редких дропов;
//! - [`expect_kills`] — ожидаемый доход и σ за K убийств (журнал, «удача»).
//!
//! Сети, справочника и Tauri здесь нет: цены приходят от приложения функцией `ref → chaos`.
//! План — `shared/docs/boss-farm.md`, раздел 6.

pub mod data;
mod simulate;

use std::collections::HashMap;

use serde::Serialize;

pub use data::{Boss, BossData, DropRef, Pool, PoolEntry, PoolKind, Quote};
pub use simulate::Rng;

use simulate::Distribution;

/// Дроп с вероятностью меньше этой — «редкий» (риск «70 % дохода — Starforge»).
pub const RARE_PROBABILITY: f64 = 0.05;

/// Профиль и правки пользователя для одного босса.
#[derive(Debug, Clone, Default)]
pub struct Settings {
    /// Нет — `defaults.ttkSec` босса.
    pub ttk_sec: Option<f64>,
    /// Нет — `defaults.overheadSec` босса.
    pub overhead_sec: Option<f64>,
    /// IIQ для пулов `scalesWithQuantity`, в %.
    pub iiq: f64,
    /// Свои шансы по ключу дропа: у `independent` — в %, как `chance` (IIQ применяется);
    /// у `one-of` — вес в единицах пула.
    pub chances: HashMap<String, f64>,
    /// Общая статистика по ключу: доля убийств × 100 (то есть в %, у `one-of` — вероятность
    /// в %). Наблюдённое значение, IIQ не применяется.
    pub community: HashMap<String, f64>,
    /// «Шансы сообщества»: статистика вместо данных у всех ключей, а не только у `chance: null`.
    pub prefer_community: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct MonteCarlo {
    pub seed: u64,
    /// Прогонов часа; 0 — без Монте-Карло.
    pub runs: u32,
}

impl Default for MonteCarlo {
    fn default() -> Self {
        Self {
            seed: 0x0B05_5FA2_4D1E_0001,
            runs: 20_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChanceSource {
    Data,
    User,
    Community,
    /// Шанс не опубликован и не задан — в EV не входит.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryLine {
    #[serde(rename = "ref")]
    pub drop_ref: DropRef,
    pub qty: f64,
    /// За штуку; нет — вход не посчитан.
    pub price: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropLine {
    pub key: String,
    pub pool: String,
    pub kind: PoolKind,
    pub source: ChanceSource,
    /// Шанс, что выпадет хотя бы одна штука; нет — шанс неизвестен.
    pub probability: Option<f64>,
    /// Ожидаемое число штук за убийство.
    pub expected: Option<f64>,
    /// За штуку; нет — цены нет или дроп не продаётся (`sellable`).
    pub price: Option<f64>,
    /// `false` у `{ none: true }`.
    pub sellable: bool,
    /// Вклад в EV за убийство.
    pub value: f64,
}

/// Почему прибыль не посчитана.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfitGap {
    /// У одного из предметов входа нет цены.
    EntryPrice,
}

/// Доход за час по Монте-Карло, прибыль (за вычетом входа каждого убийства).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourRisk {
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossEstimate {
    pub boss_id: String,
    pub entry: Vec<EntryLine>,
    /// Σ qty × цена; нет — у входа нет цены.
    pub entry_cost: Option<f64>,
    pub drops: Vec<DropLine>,
    /// Ожидаемый доход дропа за убийство.
    pub ev: f64,
    /// Стандартное отклонение дохода за убийство.
    pub sigma: f64,
    pub profit: Option<f64>,
    pub profit_gap: Option<ProfitGap>,
    pub ttk_sec: Option<f64>,
    pub overhead_sec: Option<f64>,
    pub kills_per_hour: Option<f64>,
    pub profit_per_hour: Option<f64>,
    pub hour: Option<HourRisk>,
    /// Доля EV от дропов с вероятностью < 5 %; нет — EV ≤ 0.
    pub rare_share: Option<f64>,
    /// Ключ самого большого по вкладу редкого дропа.
    pub rare_top: Option<String>,
    /// Ключи дропов без цены (в EV — 0).
    pub unpriced: Vec<String>,
    /// Ключи с неизвестным шансом (в EV не входят).
    pub unknown_chance: Vec<String>,
}

/// Ожидание за K убийств — для журнала: удача = (факт − mean) / sigma.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillsExpectation {
    pub kills: u32,
    /// Доход дропа: K × EV.
    pub income: f64,
    /// K × прибыль за убийство; нет — у входа нет цены.
    pub profit: Option<f64>,
    /// σ дохода: σ за убийство × √K.
    pub sigma: f64,
}

pub fn expect_kills(estimate: &BossEstimate, kills: u32) -> KillsExpectation {
    let count = f64::from(kills);

    KillsExpectation {
        kills,
        income: estimate.ev * count,
        profit: estimate.profit.map(|profit| profit * count),
        sigma: estimate.sigma * count.sqrt(),
    }
}

/// Считает босса. `prices` — цена штуки в хаосах (`{ none: true }` сюда не попадает).
pub fn estimate(
    boss: &Boss,
    prices: impl Fn(&DropRef) -> Option<f64>,
    settings: &Settings,
    monte_carlo: MonteCarlo,
) -> BossEstimate {
    let price_of = |drop_ref: &DropRef| match drop_ref {
        DropRef::None { none: true } => Some(0.0),
        DropRef::Unknown(_) => None,
        _ => prices(drop_ref).filter(|price| price.is_finite()),
    };

    let entry: Vec<EntryLine> = boss
        .entry
        .iter()
        .map(|item| EntryLine {
            drop_ref: item.drop_ref.clone(),
            qty: item.qty,
            price: price_of(&item.drop_ref),
        })
        .collect();
    let entry_cost = entry
        .iter()
        .map(|line| line.price.map(|price| price * line.qty))
        .sum::<Option<f64>>();

    let mut drops = Vec::new();
    let mut variance = 0.0;
    let mut distribution = Distribution::certain(0.0);

    for pool in &boss.pools {
        let lines = match pool.kind {
            PoolKind::OneOf => one_of(pool, settings),
            PoolKind::Independent => independent(boss, pool, settings),
            PoolKind::Unknown => pool.entries.iter().map(|_| Resolved::UNKNOWN).collect(),
        };

        let mut atoms: Vec<(f64, f64)> = Vec::new();
        let (mut mean, mut square) = (0.0, 0.0);

        for (resolved, entry) in lines.into_iter().zip(&pool.entries) {
            let sellable = !entry.drop_ref.is_none();
            let price = price_of(&entry.drop_ref);
            let unit = price.unwrap_or(0.0);
            let expected = resolved.expected;

            if let Some(expected) = expected {
                match pool.kind {
                    PoolKind::OneOf => {
                        mean += expected * unit;
                        square += expected * unit * unit;
                        atoms.push((unit, expected));
                    }
                    _ => {
                        // floor(λ) штук наверняка и ещё одна с шансом frac(λ).
                        let whole = expected.floor();
                        let fraction = expected - whole;

                        variance += fraction * (1.0 - fraction) * unit * unit;

                        if unit > 0.0 {
                            distribution.add(&[
                                (whole * unit, 1.0 - fraction),
                                ((whole + 1.0) * unit, fraction),
                            ]);
                        }
                    }
                }
            }

            let probability = expected.map(|expected| match pool.kind {
                PoolKind::OneOf => expected,
                _ => expected.min(1.0),
            });

            drops.push(DropLine {
                key: entry.key.clone(),
                pool: pool.id.clone(),
                kind: pool.kind,
                source: resolved.source,
                probability,
                expected,
                price: if sellable { price } else { None },
                sellable,
                value: expected.unwrap_or(0.0) * unit,
            });
        }

        if pool.kind == PoolKind::OneOf && !atoms.is_empty() {
            let total: f64 = atoms.iter().map(|atom| atom.1).sum();

            if total < 1.0 {
                atoms.push((0.0, 1.0 - total));
            }

            variance += square - mean * mean;
            distribution.add(&atoms);
        }
    }

    let ev: f64 = drops.iter().map(|line| line.value).sum();
    let sigma = variance.max(0.0).sqrt();
    let profit = entry_cost.map(|cost| ev - cost);

    let defaults = boss.defaults;
    let ttk_sec = settings.ttk_sec.or(defaults.map(|it| it.ttk_sec));
    let overhead_sec = settings.overhead_sec.or(defaults.map(|it| it.overhead_sec));
    let kills_per_hour = match (ttk_sec, overhead_sec) {
        (Some(ttk), Some(overhead)) if ttk + overhead > 0.0 => Some(3600.0 / (ttk + overhead)),
        _ => None,
    };
    let profit_per_hour = profit
        .zip(kills_per_hour)
        .map(|(profit, kills)| profit * kills);

    let hour = match (entry_cost, kills_per_hour) {
        (Some(cost), Some(kills)) if monte_carlo.runs > 0 => {
            Some(simulate_hour(&distribution, cost, kills, monte_carlo))
        }
        _ => None,
    };

    let rare = drops.iter().filter(|line| {
        line.probability.is_some_and(|it| it < RARE_PROBABILITY) && line.value > 0.0
    });
    let rare_share = (ev > 0.0).then(|| rare.clone().fold(0.0, |sum, line| sum + line.value) / ev);
    let rare_top = rare
        .max_by(|left, right| left.value.total_cmp(&right.value))
        .map(|line| line.key.clone());

    let unpriced = drops
        .iter()
        .filter(|line| line.sellable && line.price.is_none())
        .map(|line| line.key.clone())
        .collect();
    let unknown_chance = drops
        .iter()
        .filter(|line| line.source == ChanceSource::Unknown)
        .map(|line| line.key.clone())
        .collect();

    BossEstimate {
        boss_id: boss.id.clone(),
        entry,
        entry_cost,
        drops,
        ev,
        sigma,
        profit,
        profit_gap: entry_cost.is_none().then_some(ProfitGap::EntryPrice),
        ttk_sec,
        overhead_sec,
        kills_per_hour,
        profit_per_hour,
        hour,
        rare_share,
        rare_top,
        unpriced,
        unknown_chance,
    }
}

/// Шанс строки после выбора источника.
struct Resolved {
    source: ChanceSource,
    /// Ожидаемое число штук; нет — шанс неизвестен.
    expected: Option<f64>,
}

impl Resolved {
    const UNKNOWN: Self = Self {
        source: ChanceSource::Unknown,
        expected: None,
    };
}

fn finite(value: Option<&f64>) -> Option<f64> {
    value.copied().filter(|value| value.is_finite())
}

/// `one-of`: свои веса и веса данных делят между собой то, что не заняли шансы сообщества
/// (у них вероятность, а не вес). Сумма вероятностей пула — 1.
fn one_of(pool: &Pool, settings: &Settings) -> Vec<Resolved> {
    enum Share {
        Weight(f64),
        Absolute(f64),
        Unknown,
    }

    let shares: Vec<(ChanceSource, Share)> = pool
        .entries
        .iter()
        .map(|entry| {
            let community = finite(settings.community.get(&entry.key));
            let data = entry.weight.filter(|weight| weight.is_finite());

            if let Some(weight) = finite(settings.chances.get(&entry.key)) {
                (ChanceSource::User, Share::Weight(weight.max(0.0)))
            } else if let Some(chance) =
                community.filter(|_| settings.prefer_community || data.is_none())
            {
                (
                    ChanceSource::Community,
                    Share::Absolute((chance / 100.0).clamp(0.0, 1.0)),
                )
            } else if let Some(weight) = data {
                (ChanceSource::Data, Share::Weight(weight.max(0.0)))
            } else {
                (ChanceSource::Unknown, Share::Unknown)
            }
        })
        .collect();

    let weights: f64 = shares
        .iter()
        .map(|(_, share)| match share {
            Share::Weight(weight) => *weight,
            _ => 0.0,
        })
        .sum();
    let absolute: f64 = shares
        .iter()
        .map(|(_, share)| match share {
            Share::Absolute(chance) => *chance,
            _ => 0.0,
        })
        .sum();
    // Абсолютные шансы растягиваются до 1, если весов нет, и сжимаются, если их сумма больше 1.
    let absolute_scale = if absolute > 1.0 || (weights <= 0.0 && absolute > 0.0) {
        1.0 / absolute
    } else {
        1.0
    };
    let remainder = (1.0 - absolute * absolute_scale).max(0.0);

    shares
        .into_iter()
        .map(|(source, share)| Resolved {
            source,
            expected: match share {
                Share::Weight(weight) if weights > 0.0 => Some(weight / weights * remainder),
                Share::Weight(_) => Some(0.0),
                Share::Absolute(chance) => Some(chance * absolute_scale),
                Share::Unknown => None,
            },
        })
        .collect()
}

/// `independent`: шанс в % — ожидаемое число штук. IIQ — у данных и своих шансов.
fn independent(boss: &Boss, pool: &Pool, settings: &Settings) -> Vec<Resolved> {
    let scale = if pool.scales_with_quantity {
        quantity_multiplier(boss, settings.iiq)
    } else {
        1.0
    };

    pool.entries
        .iter()
        .map(|entry| {
            let community = finite(settings.community.get(&entry.key));
            let data = entry.chance.filter(|chance| chance.is_finite());

            let (source, expected) = if let Some(chance) = finite(settings.chances.get(&entry.key))
            {
                (ChanceSource::User, Some(chance / 100.0 * scale))
            } else if let Some(chance) =
                community.filter(|_| settings.prefer_community || data.is_none())
            {
                (ChanceSource::Community, Some(chance / 100.0))
            } else if let Some(chance) = data {
                (ChanceSource::Data, Some(chance / 100.0 * scale))
            } else {
                (ChanceSource::Unknown, None)
            };

            Resolved {
                source,
                expected: expected.map(|expected| expected.max(0.0)),
            }
        })
        .collect()
}

/// Без ступеней: (1 + IIQ) / (1 + IIQ данных). Со ступенями — множитель наибольшей ступени
/// с порогом ≤ IIQ (ниже всех — первой).
pub fn quantity_multiplier(boss: &Boss, iiq: f64) -> f64 {
    match boss.quantity.steps.as_deref() {
        Some(steps) if !steps.is_empty() => steps
            .iter()
            .filter(|step| step.iiq <= iiq)
            .max_by(|left, right| left.iiq.total_cmp(&right.iiq))
            .or_else(|| {
                steps
                    .iter()
                    .min_by(|left, right| left.iiq.total_cmp(&right.iiq))
            })
            .map_or(1.0, |step| step.mult),
        _ => {
            let base = 1.0 + boss.quantity.default / 100.0;

            if base > 0.0 {
                ((1.0 + iiq / 100.0) / base).max(0.0)
            } else {
                1.0
            }
        }
    }
}

fn simulate_hour(
    distribution: &Distribution,
    entry_cost: f64,
    kills_per_hour: f64,
    monte_carlo: MonteCarlo,
) -> HourRisk {
    let kills = (kills_per_hour.round() as u32).max(1);
    let sampler = distribution.sampler();
    let mut rng = Rng::new(monte_carlo.seed);
    let spent = entry_cost * f64::from(kills);
    let mut results: Vec<f64> = (0..monte_carlo.runs)
        .map(|_| (0..kills).map(|_| sampler.sample(&mut rng)).sum::<f64>() - spent)
        .collect();

    results.sort_by(f64::total_cmp);

    let runs = results.len();
    let quantile = |q: f64| results[((runs - 1) as f64 * q).round() as usize];

    HourRisk {
        kills,
        runs: monte_carlo.runs,
        mean: results.iter().sum::<f64>() / runs as f64,
        p10: quantile(0.1),
        p50: quantile(0.5),
        p90: quantile(0.9),
        loss_chance: results.iter().filter(|value| **value < 0.0).count() as f64 / runs as f64,
    }
}
