//! Точная вероятность получить цель при перекрафте магического или редкого предмета.
//!
//! Моды выпадают по одному из общего пула (префиксы и суффиксы вместе) с учётом мест, групп
//! и добавленных тегов — как в игре и в Craft of Exile. Число модов — по распределению редкости.
//! Вероятность считается рекурсией по набору выпавших корзин с запоминанием: исход зависит
//! только от набора, не от порядка.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

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

/// Состояние предмета: выпавшие корзины и добавленные ими теги.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct State {
    pub taken: u128,
    pub dynamic: u64,
}

impl State {
    pub const EMPTY: State = State {
        taken: 0,
        dynamic: 0,
    };

    pub fn mods(self) -> u32 {
        self.taken.count_ones()
    }
}

/// Быстрый хешер для ключей-масок (по мотивам FxHash): ключи — числа, защита от коллизий
/// стандартного SipHash здесь не нужна, а его скорость заметна в рекурсии.
#[derive(Default, Clone, Copy)]
pub(crate) struct MaskHasher(u64);

impl Hasher for MaskHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.write_u64(u64::from(*byte));
        }
    }

    fn write_u64(&mut self, value: u64) {
        self.0 = (self.0.rotate_left(5) ^ value).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }

    fn write_u128(&mut self, value: u128) {
        self.write_u64(value as u64);
        self.write_u64((value >> 64) as u64);
    }

    fn write_u32(&mut self, value: u32) {
        self.write_u64(u64::from(value));
    }
}

type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<MaskHasher>>;

/// Вероятность, что перековка Harvest «…включая свойство `tag`» даст все notable цели: первый мод
/// выпадает только из модов с тегом (по их весам), остальные — как при сфере хаоса; число модов —
/// как у редкого самоцвета, считая и первый (так же считает Craft of Exile). Ноль — модов с тегом
/// на базе нет.
pub fn harvest_hit_probability(pool: &Pool, tag: &str) -> f64 {
    if !pool.target_reachable() {
        return 0.0;
    }

    let mut solver = Solver::new(pool, Rarity::RareJewel.limits());
    let first = solver.options_tagged(State::EMPTY, tag);
    let total: f64 = first.iter().map(|(_, weight)| weight).sum();

    if total <= 0.0 {
        return 0.0;
    }

    let mut chance = 0.0;

    for &(count, share) in Rarity::RareJewel.mod_counts() {
        for &(bucket, weight) in &first {
            let next = solver.with(State::EMPTY, bucket);

            chance += share * weight / total * solver.solve(next.taken, next.dynamic, count - 1);
        }
    }

    chance
}

pub(crate) struct Solver<'a> {
    pool: &'a Pool,
    limits: Limits,
    weights: FastMap<u64, Vec<f64>>,
    memo: FastMap<(u128, u32), f64>,
}

impl<'a> Solver<'a> {
    pub fn new(pool: &'a Pool, limits: Limits) -> Self {
        Self {
            pool,
            limits,
            weights: FastMap::default(),
            memo: FastMap::default(),
        }
    }

    /// Чем кончится добавление одного мода (сфера усиления, царей, возвышения): состояния и
    /// их вероятности; пусто, если добавить нечего.
    pub fn add_one(&mut self, state: State) -> Vec<(State, f64)> {
        let options = self.options(state.taken, state.dynamic);
        let total: f64 = options.iter().map(|(_, weight)| weight).sum();

        if total <= 0.0 {
            return Vec::new();
        }

        options
            .into_iter()
            .map(|(bucket, weight)| (self.with(state, bucket), weight / total))
            .collect()
    }

    /// Чем кончится перекрафт с этим распределением числа модов: состояния и вероятности.
    pub fn reroll_outcomes(&mut self, counts: &[(u32, f64)]) -> Vec<(State, f64)> {
        let mut outcomes: FastMap<u128, (State, f64)> = FastMap::default();

        for &(count, chance) in counts {
            self.walk(State::EMPTY, count, chance, &mut outcomes);
        }

        outcomes.into_values().collect()
    }

    fn walk(
        &mut self,
        state: State,
        remaining: u32,
        chance: f64,
        outcomes: &mut FastMap<u128, (State, f64)>,
    ) {
        let next = if remaining == 0 {
            Vec::new()
        } else {
            self.add_one(state)
        };

        if next.is_empty() {
            outcomes.entry(state.taken).or_insert((state, 0.0)).1 += chance;

            return;
        }

        for (after, share) in next {
            self.walk(after, remaining - 1, chance * share, outcomes);
        }
    }

    /// Корзины, которые могут выпасть следующими, с весами только модов тега `tag`.
    pub fn options_tagged(&self, state: State, tag: &str) -> Vec<(usize, f64)> {
        let pool = self.pool;
        let weights = pool.bucket_weights_tagged(state.dynamic, tag);

        filter_options(pool, self.limits, state.taken, &weights)
    }

    pub(crate) fn with(&self, state: State, bucket: usize) -> State {
        State {
            taken: state.taken | (1 << bucket),
            dynamic: state.dynamic | self.pool.buckets[bucket].adds,
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

        filter_options(pool, self.limits, taken, weights)
    }
}

/// Корзины с местом, без общих групп с выпавшими и с весом больше нуля.
fn filter_options(pool: &Pool, limits: Limits, taken: u128, weights: &[f64]) -> Vec<(usize, f64)> {
    {
        let prefixes = (taken & pool.prefix_buckets).count_ones();
        let suffixes = taken.count_ones() - prefixes;
        let prefix_room = prefixes < limits.prefixes;
        let suffix_room = suffixes < limits.suffixes;

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
