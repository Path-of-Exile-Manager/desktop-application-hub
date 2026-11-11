//! Пул модов конкретной базы: размер, энчант, уровень предмета и (при крафте ископаемыми) их влияние.
//!
//! Вес мода = вес появления × вес генерации / 100 × множитель ископаемых. В обоих списках весов
//! берётся первый тег, который есть у предмета: теги базы, тег энчанта и теги, добавленные уже
//! выпавшими модами (`has_affliction_notable` — у малого кластера второй notable невозможен).
//!
//! Моды собраны в «корзины» — моды с одинаковыми группами, стороной, добавляемыми тегами и
//! целевым notable. Внутри корзины моды отличаются только тиром: для цели они неразличимы, а
//! выпадение любого из них закрывает всю корзину (общие группы). Точный расчёт идёт по корзинам,
//! Монте-Карло — по отдельным модам, поэтому они проверяют друг друга.

use std::collections::HashMap;

use crate::EngineError;
use crate::data::{Affix, ClusterMod, CraftingData, Fossil, Weight};

/// Больше корзин (и групп) у кластеров не бывает: максимум ~40 на базу.
const MAX_BUCKETS: usize = 128;

/// База крафта.
#[derive(Debug, Clone, Copy)]
pub struct Base<'a> {
    pub size: &'a str,
    pub enchant: &'a str,
    pub item_level: u32,
}

/// Совпадение тега из списка весов с тегами предмета.
#[derive(Debug, Clone, Copy)]
enum TagMatch {
    /// Тег есть у базы или энчанта.
    Always,
    /// Тег появляется, когда выпадет мод с ним в `adds_tags`: бит маски динамических тегов.
    Dynamic(u32),
}

#[derive(Debug, Clone)]
pub(crate) struct PoolMod {
    pub affix: Affix,
    /// Маска групп пула; общая группа — моды не выпадают вместе.
    pub groups: u128,
    pub adds: u64,
    /// Индекс notable в цели.
    pub target: Option<usize>,
    /// Корзина мода.
    pub bucket: usize,
    /// Индекс в `crafting.clusters.mods`.
    source: usize,
    spawn: Vec<(TagMatch, f64)>,
    generation: Vec<(TagMatch, f64)>,
    factor: f64,
}

impl PoolMod {
    pub fn weight(&self, dynamic: u64) -> f64 {
        let spawn = first_match(&self.spawn, dynamic).unwrap_or(0.0);

        if spawn <= 0.0 {
            return 0.0;
        }

        // Без подходящего тега генерация вес не меняет.
        let generation = if self.generation.is_empty() {
            100.0
        } else {
            first_match(&self.generation, dynamic).unwrap_or(100.0)
        };

        spawn * generation / 100.0 * self.factor
    }
}

fn first_match(weights: &[(TagMatch, f64)], dynamic: u64) -> Option<f64> {
    weights.iter().find_map(|(tag, weight)| match tag {
        TagMatch::Always => Some(*weight),
        TagMatch::Dynamic(bit) => (dynamic & (1 << bit) != 0).then_some(*weight),
    })
}

#[derive(Debug, Clone)]
pub(crate) struct Bucket {
    pub affix: Affix,
    pub mods: Vec<usize>,
    pub adds: u64,
    pub target: Option<usize>,
    /// Корзины с общими группами, включая эту.
    pub conflicts: u128,
}

/// Пул модов базы с целью: какие notable нужно получить.
#[derive(Debug, Clone)]
pub struct Pool {
    pub(crate) mods: Vec<PoolMod>,
    pub(crate) buckets: Vec<Bucket>,
    pub(crate) prefix_buckets: u128,
    /// Корзины каждого notable цели.
    pub(crate) target_buckets: Vec<u128>,
    /// Маска всех динамических тегов: с ней мод доступен хоть при каком-то наборе.
    all_dynamic: u64,
}

/// Влияние ископаемых на тег (как считает Craft of Exile в режиме по умолчанию): множители
/// больше 1 складываются, остальные перемножаются, вес 0 запрещает тег.
#[derive(Debug, Clone, Copy, Default)]
struct TagEffect {
    more: Option<f64>,
    less: Option<f64>,
    blocked: bool,
}

impl Pool {
    pub fn new(
        data: &CraftingData,
        base: Base,
        fossils: &[&Fossil],
        target: &[String],
    ) -> Result<Self, EngineError> {
        let size = data
            .clusters
            .sizes
            .iter()
            .find(|size| size.id == base.size)
            .ok_or_else(|| EngineError::UnknownSize(base.size.to_owned()))?;
        let enchant = data
            .clusters
            .enchants
            .iter()
            .find(|enchant| enchant.size == base.size && enchant.id == base.enchant)
            .ok_or_else(|| {
                EngineError::UnknownEnchant(format!("{}:{}", base.size, base.enchant))
            })?;
        let mut static_tags: Vec<&str> = size.tags.iter().map(String::as_str).collect();

        static_tags.push(&enchant.tag);

        let mut dynamic_bits: HashMap<&str, u32> = HashMap::new();

        for tag in data.clusters.mods.iter().flat_map(|m| m.adds_tags.iter()) {
            if !static_tags.contains(&tag.as_str()) && !dynamic_bits.contains_key(tag.as_str()) {
                let bit = dynamic_bits.len() as u32;

                dynamic_bits.insert(tag, bit);
            }
        }

        let all_dynamic = if dynamic_bits.len() >= 64 {
            u64::MAX
        } else {
            (1u64 << dynamic_bits.len()) - 1
        };
        let effects = fossil_effects(fossils);
        let resolve = |weights: &[Weight]| -> Vec<(TagMatch, f64)> {
            weights
                .iter()
                .filter_map(|entry| {
                    let tag = if static_tags.contains(&entry.tag.as_str()) {
                        TagMatch::Always
                    } else {
                        TagMatch::Dynamic(*dynamic_bits.get(entry.tag.as_str())?)
                    };

                    Some((tag, f64::from(entry.weight)))
                })
                .collect()
        };
        let mut group_bits: HashMap<&str, u32> = HashMap::new();
        let mut mods = Vec::new();

        for (source, cluster_mod) in data.clusters.mods.iter().enumerate() {
            if cluster_mod.required_level > base.item_level {
                continue;
            }

            let adds = cluster_mod
                .adds_tags
                .iter()
                .filter_map(|tag| dynamic_bits.get(tag.as_str()))
                .fold(0u64, |mask, bit| mask | (1 << bit));
            let target_index = cluster_mod
                .notable
                .as_ref()
                .and_then(|notable| target.iter().position(|name| *name == notable.name.en));
            let candidate = PoolMod {
                affix: cluster_mod.affix,
                groups: 0,
                adds,
                target: target_index,
                bucket: 0,
                source,
                spawn: resolve(&cluster_mod.spawn_weights),
                generation: resolve(&cluster_mod.generation_weights),
                factor: fossil_factor(cluster_mod, &effects),
            };

            if candidate.weight(0) <= 0.0 && candidate.weight(all_dynamic) <= 0.0 {
                continue;
            }

            let mut groups = 0u128;

            // Мод без групп всё равно не выпадает дважды: своя группа по id.
            let names: Vec<&str> = if cluster_mod.groups.is_empty() {
                vec![cluster_mod.id.as_str()]
            } else {
                cluster_mod.groups.iter().map(String::as_str).collect()
            };

            for name in names {
                let next = group_bits.len() as u32;
                let bit = *group_bits.entry(name).or_insert(next);

                if bit as usize >= MAX_BUCKETS {
                    return Err(EngineError::PoolTooLarge(group_bits.len()));
                }

                groups |= 1 << bit;
            }

            mods.push(PoolMod {
                groups,
                ..candidate
            });
        }

        let mut bucket_of: HashMap<(Affix, u128, u64, Option<usize>), usize> = HashMap::new();
        let mut buckets: Vec<Bucket> = Vec::new();
        let mut bucket_groups: Vec<u128> = Vec::new();

        for (index, pool_mod) in mods.iter_mut().enumerate() {
            let key = (
                pool_mod.affix,
                pool_mod.groups,
                pool_mod.adds,
                pool_mod.target,
            );
            let bucket = *bucket_of.entry(key).or_insert_with(|| {
                buckets.push(Bucket {
                    affix: pool_mod.affix,
                    mods: Vec::new(),
                    adds: pool_mod.adds,
                    target: pool_mod.target,
                    conflicts: 0,
                });
                bucket_groups.push(pool_mod.groups);
                buckets.len() - 1
            });

            buckets[bucket].mods.push(index);
            pool_mod.bucket = bucket;
        }

        if buckets.len() > MAX_BUCKETS {
            return Err(EngineError::PoolTooLarge(buckets.len()));
        }

        for (index, bucket) in buckets.iter_mut().enumerate() {
            bucket.conflicts = bucket_groups
                .iter()
                .enumerate()
                .filter(|(_, groups)| **groups & bucket_groups[index] != 0)
                .fold(0u128, |mask, (other, _)| mask | (1 << other));
        }

        let prefix_buckets = buckets
            .iter()
            .enumerate()
            .filter(|(_, bucket)| bucket.affix == Affix::Prefix)
            .fold(0u128, |mask, (index, _)| mask | (1 << index));
        let target_buckets = (0..target.len())
            .map(|wanted| {
                buckets
                    .iter()
                    .enumerate()
                    .filter(|(_, bucket)| bucket.target == Some(wanted))
                    .fold(0u128, |mask, (index, _)| mask | (1 << index))
            })
            .collect();

        Ok(Self {
            mods,
            buckets,
            prefix_buckets,
            target_buckets,
            all_dynamic,
        })
    }

    /// Каждый notable цели может выпасть на этой базе хотя бы при каком-то наборе модов.
    pub fn target_reachable(&self) -> bool {
        self.target_buckets.iter().all(|mask| *mask != 0)
    }

    /// Веса корзин при этих динамических тегах.
    pub(crate) fn bucket_weights(&self, dynamic: u64) -> Vec<f64> {
        self.buckets
            .iter()
            .map(|bucket| {
                bucket
                    .mods
                    .iter()
                    .map(|&index| self.mods[index].weight(dynamic))
                    .sum()
            })
            .collect()
    }

    /// Все notable цели среди выпавших корзин.
    pub(crate) fn hit(&self, taken: u128) -> bool {
        self.target_buckets.iter().all(|mask| taken & mask != 0)
    }

    /// Веса модов пустого предмета: индекс в `crafting.clusters.mods` и вес (для сверки с
    /// таблицей весов Craft of Exile).
    pub fn mod_weights(&self) -> Vec<(usize, f64)> {
        self.mods
            .iter()
            .map(|pool_mod| (pool_mod.source, pool_mod.weight(0)))
            .collect()
    }

    /// Выпал хотя бы один notable цели.
    pub(crate) fn any_target(&self, taken: u128) -> bool {
        self.target_buckets.iter().any(|mask| taken & mask != 0)
    }

    pub(crate) fn missing(&self, taken: u128) -> u32 {
        self.target_buckets
            .iter()
            .filter(|mask| taken & **mask == 0)
            .count() as u32
    }

    pub(crate) fn has_dynamic(&self) -> bool {
        self.all_dynamic != 0
    }
}

fn fossil_effects(fossils: &[&Fossil]) -> HashMap<String, TagEffect> {
    let mut effects: HashMap<String, TagEffect> = HashMap::new();

    for fossil in fossils {
        for entry in fossil
            .positive_weights
            .iter()
            .chain(&fossil.negative_weights)
        {
            let effect = effects.entry(entry.tag.clone()).or_default();
            let multiplier = f64::from(entry.weight) / 100.0;

            if entry.weight == 0 {
                effect.blocked = true;
            } else if multiplier > 1.0 {
                effect.more = Some(effect.more.unwrap_or(0.0) + multiplier);
            } else {
                effect.less = Some(effect.less.unwrap_or(1.0) * multiplier);
            }
        }
    }

    effects
}

/// Множитель веса мода от ископаемых по его тегам: «больше» складываются, «меньше» перемножаются.
fn fossil_factor(cluster_mod: &ClusterMod, effects: &HashMap<String, TagEffect>) -> f64 {
    let mut more: Option<f64> = None;
    let mut less: Option<f64> = None;

    for tag in &cluster_mod.implicit_tags {
        let Some(effect) = effects.get(tag) else {
            continue;
        };

        if effect.blocked {
            return 0.0;
        }

        if let Some(value) = effect.more {
            more = Some(more.unwrap_or(0.0) + value);
        }

        if let Some(value) = effect.less {
            less = Some(less.unwrap_or(1.0) * value);
        }
    }

    more.unwrap_or(1.0) * less.unwrap_or(1.0)
}

/// Можно ли применить ископаемое к базе: запрещённые и разрешённые теги базы.
pub(crate) fn fossil_applies(fossil: &Fossil, base_tags: &[String]) -> bool {
    let forbidden = fossil
        .forbidden_tags
        .iter()
        .any(|tag| base_tags.contains(tag));
    let allowed = fossil.allowed_tags.is_empty()
        || fossil
            .allowed_tags
            .iter()
            .any(|tag| base_tags.contains(tag));

    !forbidden && allowed
}
