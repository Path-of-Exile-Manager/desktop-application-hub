//! `crafting.json` из набора данных (собирает воркер бэкенда, задача `crafting-data-sync`).
//! Только то, что читает движок; лишние поля документа игнорируются.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct LocalizedName {
    pub en: String,
    pub ru: Option<String>,
}

/// Вес по тегу. Списки весов идут в порядке игры: берётся первый тег, который есть у предмета.
#[derive(Debug, Clone, Deserialize)]
pub struct Weight {
    pub tag: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftingData {
    pub clusters: Clusters,
    pub fossils: Vec<Fossil>,
    pub currency: Currency,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Clusters {
    pub sizes: Vec<ClusterSize>,
    pub enchants: Vec<ClusterEnchant>,
    pub mods: Vec<ClusterMod>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSize {
    /// `large` | `medium` | `small`.
    pub id: String,
    /// Ключ базы в справочнике.
    pub item_id: String,
    pub name: LocalizedName,
    /// Теги базы в порядке игры; энчант добавляет свой.
    pub tags: Vec<String>,
    pub min_passives: u32,
    pub max_passives: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterEnchant {
    /// Id пассивного умения; уникален в пределах размера.
    pub id: String,
    pub size: String,
    /// Тег, который энчант даёт предмету: по нему считаются веса модов.
    pub tag: String,
    pub name: LocalizedName,
    #[serde(default)]
    pub trade_stat_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Affix {
    Prefix,
    Suffix,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMod {
    pub id: String,
    pub affix: Affix,
    pub groups: Vec<String>,
    pub required_level: u32,
    pub spawn_weights: Vec<Weight>,
    pub generation_weights: Vec<Weight>,
    /// Теги, по которым мод взвешивают фоссилы.
    pub implicit_tags: Vec<String>,
    /// Теги, которые предмет получает, пока у него есть этот мод (`has_affliction_notable`).
    pub adds_tags: Vec<String>,
    pub text: LocalizedName,
    pub notable: Option<Notable>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notable {
    pub name: LocalizedName,
    pub trade_stat_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fossil {
    /// Ключ ископаемого в справочнике (по нему же его цена).
    pub item_id: String,
    pub name: String,
    pub positive_weights: Vec<Weight>,
    pub negative_weights: Vec<Weight>,
    pub forbidden_tags: Vec<String>,
    pub allowed_tags: Vec<String>,
    pub added_mods: Vec<String>,
    pub forced_mods: Vec<String>,
}

/// Ключи валюты в справочнике; цены приложение берёт из прайса лиги.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Currency {
    /// Нет в документах до 11.11.2026.
    pub transmutation: Option<String>,
    pub alchemy: Option<String>,
    pub alteration: String,
    pub augmentation: String,
    pub regal: String,
    pub exalted: String,
    pub chaos: String,
    pub scouring: String,
    pub annulment: String,
    pub resonators: Vec<Resonator>,
}

/// Хаотический резонатор: гнёзд 1–4; каждый существует двумя предметами (в стопке и без).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resonator {
    pub sockets: u8,
    pub item_ids: Vec<String>,
}
