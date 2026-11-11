//! Монте-Карло по отдельным модам (не по корзинам), чтобы проверять точный расчёт.

use crate::data::Affix;
use crate::exact::{Limits, Rarity, State};
use crate::pool::Pool;
use crate::strategy::{AltPolicy, Decider};

/// Детерминированный генератор (SplitMix64): одинаковое зерно — одинаковый результат.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);

        let mut z = self.0;

        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Равномерно в [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Доля перекрафтов из `runs`, давших все notable цели.
pub fn simulate_reroll(pool: &Pool, rarity: Rarity, runs: u32, seed: u64) -> f64 {
    if runs == 0 {
        return 0.0;
    }

    let mut rng = Rng::new(seed);
    let mut item = Item::new(pool);
    let hits = (0..runs)
        .filter(|_| {
            item.reroll(rarity, &mut rng);
            pool.hit(item.state.taken)
        })
        .count();

    hits as f64 / f64::from(runs)
}

/// Доля попыток метода на сферах перемен из `attempts`, закончивших цель.
pub fn simulate_alt_policy(pool: &Pool, policy: AltPolicy, attempts: u32, seed: u64) -> f64 {
    if attempts == 0 {
        return 0.0;
    }

    let mut rng = Rng::new(seed);
    let mut item = Item::new(pool);
    let mut decider = Decider::new(pool);
    let mut hits = 0u32;
    let magic = Rarity::Magic.limits();
    let rare = Rarity::RareJewel.limits();

    for _ in 0..attempts {
        item.reroll(Rarity::Magic, &mut rng);

        if decider.should_augment(policy, item.state) {
            item.add_one(magic, &mut rng);
        }

        if decider.should_regal(policy, item.state) {
            item.add_one(rare, &mut rng);

            if decider.should_exalt(policy, item.state) {
                item.add_one(rare, &mut rng);
            }
        }

        if pool.hit(item.state.taken) {
            hits += 1;
        }
    }

    f64::from(hits) / f64::from(attempts)
}

/// Предмет в Монте-Карло: выпавшие моды по группам, сторонам и корзинам.
struct Item<'a> {
    pool: &'a Pool,
    state: State,
    groups: u128,
    prefixes: u32,
    suffixes: u32,
    weights: Vec<f64>,
}

impl<'a> Item<'a> {
    fn new(pool: &'a Pool) -> Self {
        Self {
            pool,
            state: State::EMPTY,
            groups: 0,
            prefixes: 0,
            suffixes: 0,
            weights: vec![0.0; pool.mods.len()],
        }
    }

    fn reroll(&mut self, rarity: Rarity, rng: &mut Rng) {
        self.state = State::EMPTY;
        self.groups = 0;
        self.prefixes = 0;
        self.suffixes = 0;

        for _ in 0..pick_count(rarity, rng) {
            if !self.add_one(rarity.limits(), rng) {
                break;
            }
        }
    }

    /// Добавляет один мод; false — добавить нечего.
    fn add_one(&mut self, limits: Limits, rng: &mut Rng) -> bool {
        let mut total = 0.0;

        for (index, pool_mod) in self.pool.mods.iter().enumerate() {
            let room = match pool_mod.affix {
                Affix::Prefix => self.prefixes < limits.prefixes,
                Affix::Suffix => self.suffixes < limits.suffixes,
            };

            self.weights[index] = if room && self.groups & pool_mod.groups == 0 {
                pool_mod.weight(self.state.dynamic)
            } else {
                0.0
            };
            total += self.weights[index];
        }

        if total <= 0.0 {
            return false;
        }

        let mut point = rng.next_f64() * total;
        let mut chosen = self
            .weights
            .iter()
            .rposition(|weight| *weight > 0.0)
            .unwrap_or(0);

        for (index, weight) in self.weights.iter().enumerate() {
            if *weight > 0.0 && point < *weight {
                chosen = index;
                break;
            }

            point -= weight;
        }

        let pool_mod = &self.pool.mods[chosen];

        self.groups |= pool_mod.groups;
        self.state.dynamic |= pool_mod.adds;
        self.state.taken |= 1 << pool_mod.bucket;

        match pool_mod.affix {
            Affix::Prefix => self.prefixes += 1,
            Affix::Suffix => self.suffixes += 1,
        }

        true
    }
}

fn pick_count(rarity: Rarity, rng: &mut Rng) -> u32 {
    let mut point = rng.next_f64();
    let counts = rarity.mod_counts();

    for &(count, chance) in counts {
        if point < chance {
            return count;
        }

        point -= chance;
    }

    counts.last().map_or(0, |(count, _)| *count)
}
