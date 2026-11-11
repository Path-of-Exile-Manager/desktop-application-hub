//! Точная вероятность получить цель при перекрафте магического или редкого предмета.
//!
//! Моды выпадают по одному из общего пула (префиксы и суффиксы вместе) с учётом мест, групп
//! и добавленных тегов — как в игре и в Craft of Exile. Число модов — по распределению редкости.
//! Вероятность считается рекурсией по набору выпавших корзин с запоминанием: исход зависит
//! только от набора, не от порядка.

use std::collections::HashMap;

use crate::data::Affix;
use crate::pool::Pool;

/// Места под моды: сколько префиксов и суффиксов.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub prefixes: u32,
    pub suffixes: u32,
}

/// Редкость при перекрафте: места и распределение числа модов.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rarity {
    Magic,
    /// Редкий самоцвет: не больше 2 префиксов и 2 суффиксов.
    RareJewel,
}

impl Rarity {
    pub fn limits(self) -> Limits {
        match self {
            Rarity::Magic => Limits {
                prefixes: 1,
                suffixes: 1,
            },
            Rarity::RareJewel => Limits {
                prefixes: 2,
                suffixes: 2,
            },
        }
    }

    /// Сколько модов выпадает и с какой вероятностью. Те же доли, что в Craft of Exile
    /// (магический: 1 или 2 поровну; редкий самоцвет: 3 — 65 %, 4 — 35 %).
    pub fn mod_counts(self) -> &'static [(u32, f64)] {
        match self {
            Rarity::Magic => &[(1, 0.5), (2, 0.5)],
            Rarity::RareJewel => &[(3, 0.65), (4, 0.35)],
        }
    }
}

/// Вероятность, что перекрафт (сфера перемен, хаоса, ископаемые) даст все notable цели.
pub fn reroll_hit_probability(pool: &Pool, rarity: Rarity) -> f64 {
    if !pool.target_reachable() {
        return 0.0;
    }

    let mut solver = Solver::new(pool, rarity.limits());

    rarity
        .mod_counts()
        .iter()
        .map(|&(count, chance)| chance * solver.solve(0, 0, count))
        .sum()
}

pub(crate) struct Solver<'a> {
    pool: &'a Pool,
    limits: Limits,
    weights: HashMap<u64, Vec<f64>>,
    memo: HashMap<(u128, u32), f64>,
}

impl<'a> Solver<'a> {
    pub fn new(pool: &'a Pool, limits: Limits) -> Self {
        Self {
            pool,
            limits,
            weights: HashMap::new(),
            memo: HashMap::new(),
        }
    }

    /// Вероятность, что к уже выпавшим корзинам `taken` за `remaining` модов добавятся
    /// недостающие notable цели.
    pub fn solve(&mut self, taken: u128, dynamic: u64, remaining: u32) -> f64 {
        if self.pool.hit(taken) {
            return 1.0;
        }

        // Каждый мод закрывает не больше одного notable цели.
        if remaining < self.pool.missing(taken) {
            return 0.0;
        }

        if let Some(&known) = self.memo.get(&(taken, remaining)) {
            return known;
        }

        let options = self.options(taken, dynamic);
        let total: f64 = options.iter().map(|(_, weight)| weight).sum();
        let mut chance = 0.0;

        if total > 0.0 {
            for (bucket, weight) in options {
                let adds = self.pool.buckets[bucket].adds;

                chance += weight / total
                    * self.solve(taken | (1 << bucket), dynamic | adds, remaining - 1);
            }
        }

        self.memo.insert((taken, remaining), chance);

        chance
    }

    /// Корзины, которые могут выпасть следующими, с их весами.
    pub fn options(&mut self, taken: u128, dynamic: u64) -> Vec<(usize, f64)> {
        let pool = self.pool;
        let dynamic = if pool.has_dynamic() { dynamic } else { 0 };
        let weights = self
            .weights
            .entry(dynamic)
            .or_insert_with(|| pool.bucket_weights(dynamic));
        let prefixes = (taken & pool.prefix_buckets).count_ones();
        let suffixes = taken.count_ones() - prefixes;
        let prefix_room = prefixes < self.limits.prefixes;
        let suffix_room = suffixes < self.limits.suffixes;

        pool.buckets
            .iter()
            .enumerate()
            .filter(|(index, bucket)| {
                let room = match bucket.affix {
                    Affix::Prefix => prefix_room,
                    Affix::Suffix => suffix_room,
                };

                room && taken & bucket.conflicts == 0 && weights[*index] > 0.0
            })
            .map(|(index, _)| (index, weights[index]))
            .collect()
    }
}
