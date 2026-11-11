//! Движок крафта кластерных самоцветов Path of Exile 1.
//!
//! - [`data`] — `crafting.json` из набора данных: базы, энчанты, моды, ископаемые, валюта;
//! - [`Pool`] — моды конкретной базы (размер, энчант, уровень, ископаемые) и цель;
//! - [`reroll_hit_probability`] — точная вероятность попадания за перекрафт;
//! - [`simulate_reroll`] — Монте-Карло для проверки точного расчёта;
//! - [`evaluate_one_step`] — методы в один шаг (перемены, хаос, ископаемые): шанс, попытки, стоимость.
//!
//! Сети, справочника и Tauri здесь нет: цены приходят от приложения. План — `shared/docs/cluster-crafting.md`.

pub mod data;
mod exact;
mod methods;
mod pool;
mod simulate;

use std::fmt;

pub use exact::{Limits, Rarity, reroll_hit_probability};
pub use methods::{Estimate, Method, Prices, Spread, attempts_quantile, evaluate_one_step};
pub use pool::{Base, Pool};
pub use simulate::{Rng, simulate_reroll};

use data::{CraftingData, Fossil};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// `crafting.json` не разобрался.
    Data(String),
    UnknownSize(String),
    /// `<размер>:<энчант>`.
    UnknownEnchant(String),
    /// Модов или групп больше, чем помещается в маску.
    PoolTooLarge(usize),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::Data(reason) => write!(f, "crafting.json: {reason}"),
            EngineError::UnknownSize(size) => write!(f, "нет кластерного самоцвета размера {size}"),
            EngineError::UnknownEnchant(enchant) => write!(f, "нет энчанта {enchant}"),
            EngineError::PoolTooLarge(count) => write!(f, "слишком большой пул модов: {count}"),
        }
    }
}

impl std::error::Error for EngineError {}

/// Данные игры для крафта; строится один раз на набор данных.
#[derive(Debug, Clone)]
pub struct Engine {
    data: CraftingData,
}

impl Engine {
    pub fn new(data: CraftingData) -> Self {
        Self { data }
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, EngineError> {
        serde_json::from_slice(bytes)
            .map(Self::new)
            .map_err(|error| EngineError::Data(error.to_string()))
    }

    pub fn data(&self) -> &CraftingData {
        &self.data
    }

    pub fn fossil(&self, item_id: &str) -> Option<&Fossil> {
        self.data
            .fossils
            .iter()
            .find(|fossil| fossil.item_id == item_id)
    }

    /// Пул модов базы для цели (английские имена notable); ископаемые меняют веса.
    pub fn pool(
        &self,
        base: Base,
        fossils: &[&Fossil],
        target: &[String],
    ) -> Result<Pool, EngineError> {
        Pool::new(&self.data, base, fossils, target)
    }

    /// Энчанты размера, на которых цель может выпасть.
    pub fn fitting_enchants(
        &self,
        size: &str,
        item_level: u32,
        target: &[String],
    ) -> Result<Vec<&str>, EngineError> {
        let mut fitting = Vec::new();

        for enchant in self
            .data
            .clusters
            .enchants
            .iter()
            .filter(|enchant| enchant.size == size)
        {
            let base = Base {
                size,
                enchant: &enchant.id,
                item_level,
            };

            if reroll_hit_probability(&self.pool(base, &[], target)?, Rarity::RareJewel) > 0.0 {
                fitting.push(enchant.id.as_str());
            }
        }

        Ok(fitting)
    }
}
