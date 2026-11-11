//! Монте-Карло: перекрафт по отдельным модам (не по корзинам), чтобы проверять точный расчёт.

use crate::data::Affix;
use crate::exact::Rarity;
use crate::pool::Pool;

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
    let hits = (0..runs)
        .filter(|_| roll_hits(pool, rarity, &mut rng))
        .count();

    hits as f64 / f64::from(runs)
}

fn roll_hits(pool: &Pool, rarity: Rarity, rng: &mut Rng) -> bool {
    let limits = rarity.limits();
    let count = pick_count(rarity, rng);
    let mut groups = 0u128;
    let mut dynamic = 0u64;
    let mut prefixes = 0;
    let mut suffixes = 0;
    let mut found = vec![false; pool.target_buckets.len()];
    let mut weights = vec![0.0; pool.mods.len()];

    for _ in 0..count {
        let mut total = 0.0;

        for (index, pool_mod) in pool.mods.iter().enumerate() {
            let room = match pool_mod.affix {
                Affix::Prefix => prefixes < limits.prefixes,
                Affix::Suffix => suffixes < limits.suffixes,
            };

            weights[index] = if room && groups & pool_mod.groups == 0 {
                pool_mod.weight(dynamic)
            } else {
                0.0
            };
            total += weights[index];
        }

        if total <= 0.0 {
            break;
        }

        let mut point = rng.next_f64() * total;
        let mut chosen = weights
            .iter()
            .rposition(|weight| *weight > 0.0)
            .unwrap_or(0);

        for (index, weight) in weights.iter().enumerate() {
            if *weight > 0.0 && point < *weight {
                chosen = index;
                break;
            }

            point -= weight;
        }

        let pool_mod = &pool.mods[chosen];

        groups |= pool_mod.groups;
        dynamic |= pool_mod.adds;

        match pool_mod.affix {
            Affix::Prefix => prefixes += 1,
            Affix::Suffix => suffixes += 1,
        }

        if let Some(target) = pool_mod.target {
            found[target] = true;
        }
    }

    found.iter().all(|hit| *hit)
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
