//! `bosses.json` из набора данных (собирает воркер бэкенда из `bosses.data.ts`, задача `dataset-build`).
//! Формат — `shared/docs/boss-farm.md`, раздел 4.1. Лишние поля игнорируются, незнакомые значения
//! перечислений становятся `Unknown`, а не роняют разбор всего файла.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct LocalizedText {
    #[serde(default)]
    pub en: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ru: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossData {
    /// Версия таблицы шансов; меняется руками при правке.
    pub version: String,
    pub bosses: Vec<Boss>,
    #[serde(default)]
    pub quotes: Vec<Quote>,
}

impl BossData {
    pub fn boss(&self, id: &str) -> Option<&Boss> {
        self.bosses.iter().find(|boss| boss.id == id)
    }

    pub fn quote(&self, id: &str) -> Option<&Quote> {
        self.quotes.iter().find(|quote| quote.id == id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BossGroup {
    Pinnacle,
    PinnacleUber,
    Invitation,
    T17,
    League,
    Other,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Boss {
    /// Постоянный id: на него ссылаются профили и журнал.
    pub id: String,
    pub group: BossGroup,
    pub name: LocalizedText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_item_id: Option<String>,
    /// Области `WorldAreas` — для `Client.txt`.
    #[serde(default)]
    pub area_ids: Vec<String>,
    /// Что тратится на одно убийство.
    #[serde(default)]
    pub entry: Vec<EntryItem>,
    #[serde(default)]
    pub pools: Vec<Pool>,
    #[serde(default)]
    pub quantity: Quantity,
    /// Наша оценка TTK; профиль пользователя её переопределяет.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaults: Option<BossDefaults>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<LocalizedText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<Patch>,
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EntryItem {
    #[serde(rename = "ref")]
    pub drop_ref: DropRef,
    pub qty: f64,
}

/// Откуда цена: сводная цена предмета, цена ключа пула (`quotes`) или «не продаётся».
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum DropRef {
    #[serde(rename_all = "camelCase")]
    Item {
        item_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variant_key: Option<String>,
    },
    Quote {
        quote: String,
    },
    /// `{ none: true }` — не продаётся, в EV 0 без пометки «без цены».
    None {
        none: bool,
    },
    /// Незнакомая форма: считается дропом без цены.
    Unknown(serde_json::Value),
}

impl DropRef {
    pub fn item_id(&self) -> Option<&str> {
        match self {
            DropRef::Item { item_id, .. } => Some(item_id),
            _ => None,
        }
    }

    pub fn quote_id(&self) -> Option<&str> {
        match self {
            DropRef::Quote { quote } => Some(quote),
            _ => None,
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, DropRef::None { none: true })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PoolKind {
    /// Выпадает ровно один, по весам.
    OneOf,
    /// У каждого свой шанс — ожидаемое число штук за убийство, в %.
    Independent,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pool {
    pub id: String,
    pub kind: PoolKind,
    /// IIQ меняет шансы пула (или ступени `quantity.steps`).
    #[serde(default)]
    pub scales_with_quantity: bool,
    #[serde(default)]
    pub entries: Vec<PoolEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntry {
    /// Ключ дропа, уникален у босса: на него ссылаются свои шансы, журнал и статистика.
    pub key: String,
    #[serde(rename = "ref")]
    pub drop_ref: DropRef,
    /// `one-of`: вес; `null` — не опубликован.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<f64>,
    /// `independent`: ожидаемое число штук за убийство, в %; `null` — не опубликован.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chance: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quantity {
    /// IIQ, при котором записаны шансы данных.
    #[serde(default)]
    pub default: f64,
    /// Ступени T17: при IIQ не ниже ступени шанс умножается на её множитель (без линейного IIQ).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<QuantityStep>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct QuantityStep {
    pub iiq: f64,
    pub mult: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossDefaults {
    pub ttk_sec: f64,
    pub overhead_sec: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Patch {
    /// `changed`, … — показывается значком.
    pub tag: String,
    pub text: LocalizedText,
}

/// Особая цена — ключ пула `/v1/market/lease`; один ключ на несколько боссов.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub id: String,
    pub label: LocalizedText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    /// Тело поиска trade API.
    #[serde(default)]
    pub query: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u32>,
}
