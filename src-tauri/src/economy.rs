//! Вкладка «Экономика» (как раздел Economy на poe.ninja): цены текущей лиги по разделам. Раздел
//! предмета определяется по справочнику — вид, редкость, класс, а у валюты ещё и название
//! (эссенции, ископаемые, масла…). Цены уже лежат в `PricesService`, сервер не нужен.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::dataset::model::{CatalogItem, ItemKind, ItemRarity};
use crate::dataset::DatasetService;
use crate::prices::{Price, PricesService};

/// Строка раздела: один вариант цены предмета.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EconomyRow {
    pub item_id: String,
    pub variant_key: String,
    pub name_en: String,
    pub name_ru: Option<String>,
    pub icon_sha256: Option<String>,
    pub chaos_value: f64,
    pub reliable: bool,
    /// Больше всего лотов у одного источника; `null` — источники не сообщают.
    pub listings: Option<u32>,
    pub updated_at: String,
    /// Раздел строки (`currency`, `gems`…) — подпись в разделе «Все».
    pub category: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EconomyCategory {
    pub id: String,
    /// Строк (вариантов цен) в разделе.
    pub count: u32,
    /// Иконка раздела — предмет с наибольшим числом лотов.
    pub icon_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EconomyOverview {
    /// Лига цен; `null` — цены не загружены.
    pub league: Option<String>,
    pub categories: Vec<EconomyCategory>,
}

const WEAPONS: [&str; 16] = [
    "Bow", "Claw", "Dagger", "Rune Dagger", "One Hand Axe", "One Hand Mace", "One Hand Sword", "Thrusting One Hand Sword", "Sceptre", "Staff",
    "Warstaff", "Two Hand Axe", "Two Hand Mace", "Two Hand Sword", "Wand", "FishingRod",
];
const ARMOURS: [&str; 6] = ["Body Armour", "Boots", "Gloves", "Helmet", "Shield", "Quiver"];
const ACCESSORIES: [&str; 4] = ["Amulet", "Belt", "Ring", "Trinket"];

/// Раздел предмета: id как в интерфейсе (`currency`, `essences`, `unique-weapons`…).
fn category_of(item: &CatalogItem) -> &'static str {
    let name = item.name.en.as_str();
    let class = item.class_id.as_str();
    let unique = item.rarity == ItemRarity::Unique;
    match item.kind {
        ItemKind::Currency => {
            if name.contains("Essence of") || name == "Remnant of Corruption" {
                "essences"
            } else if name.ends_with(" Fossil") || name.contains("Resonator") {
                "fossils"
            } else if name.ends_with(" Oil") {
                "oils"
            } else if name.ends_with(" Catalyst") {
                "catalysts"
            } else if name.contains("Delirium Orb") {
                "delirium-orbs"
            } else if name.contains("Scarab") {
                "scarabs"
            } else if name.starts_with("Tattoo of") {
                "tattoos"
            } else if name.starts_with("Omen of") {
                "omens"
            } else if name.starts_with("Runegraft") {
                "runegrafts"
            } else if class.starts_with("Incubator") {
                "incubators"
            } else {
                "currency"
            }
        }
        ItemKind::Fragment if class == "MapKey" => "maps",
        ItemKind::Fragment if name.contains("Scarab") => "scarabs",
        ItemKind::Fragment => "fragments",
        ItemKind::Card => "cards",
        ItemKind::Map => "maps",
        ItemKind::Gem => "gems",
        ItemKind::Jewel if unique => "unique-jewels",
        ItemKind::Jewel if name.contains("Cluster Jewel") => "cluster-jewels",
        ItemKind::Flask | ItemKind::Tincture if unique => "unique-flasks",
        ItemKind::Equipment if unique && WEAPONS.contains(&class) => "unique-weapons",
        ItemKind::Equipment if unique && ARMOURS.contains(&class) => "unique-armours",
        ItemKind::Equipment if unique && ACCESSORIES.contains(&class) => "unique-accessories",
        ItemKind::Equipment | ItemKind::Jewel | ItemKind::Flask | ItemKind::Tincture if !unique => "base-types",
        ItemKind::Other if unique && class == "InstanceLocalItem" => "unique-maps",
        ItemKind::Other if unique && class == "Relic" => "unique-relics",
        ItemKind::Other if class == "ItemisedCorpse" => "corpses",
        ItemKind::Other if class == "BrequelFruit" => "wombgifts",
        ItemKind::Other if class.starts_with("Heist") => "heist",
        _ => "other",
    }
}

fn row(item: &CatalogItem, price: &Price) -> EconomyRow {
    EconomyRow {
        item_id: item.id.clone(),
        variant_key: price.variant_key.clone(),
        name_en: item.name.en.clone(),
        name_ru: item.name.ru.clone(),
        icon_sha256: item.icon_sha256.clone(),
        chaos_value: price.chaos_value,
        reliable: price.reliable,
        listings: price.sources.iter().filter_map(|s| s.listing_count).max(),
        updated_at: price.updated_at.clone(),
        category: category_of(item).to_string(),
    }
}

/// Разделы с числом строк и иконкой.
#[tauri::command]
pub fn economy_overview(dataset: State<DatasetService>, prices: State<PricesService>) -> EconomyOverview {
    let Some(catalog) = dataset.catalog() else { return EconomyOverview { league: prices.league(), categories: Vec::new() } };
    let mut categories: Vec<(EconomyCategory, u32)> = Vec::new();
    for price in prices.all() {
        let Some(item) = catalog.get(&price.item_id) else { continue };
        let id = category_of(item);
        let listings = price.sources.iter().filter_map(|s| s.listing_count).max().unwrap_or(0);
        match categories.iter_mut().find(|(c, _)| c.id == id) {
            Some((c, best)) => {
                c.count += 1;
                if listings > *best && item.icon_sha256.is_some() {
                    *best = listings;
                    c.icon_sha256 = item.icon_sha256.clone();
                }
            }
            None => categories.push((EconomyCategory { id: id.to_string(), count: 1, icon_sha256: item.icon_sha256.clone() }, listings)),
        }
    }
    EconomyOverview { league: prices.league(), categories: categories.into_iter().map(|(c, _)| c).collect() }
}

/// Раздел «Все»: цены всех разделов сразу — для поиска по всей лиге.
pub const ALL: &str = "all";

/// Строки раздела (`all` — всех разделов), дорогие сверху.
#[tauri::command]
pub fn economy_rows(dataset: State<DatasetService>, prices: State<PricesService>, category: String) -> Vec<EconomyRow> {
    let Some(catalog) = dataset.catalog() else { return Vec::new() };
    let mut rows: Vec<EconomyRow> = prices
        .all()
        .iter()
        .filter_map(|price| catalog.get(&price.item_id).filter(|item| category == ALL || category_of(item) == category).map(|item| row(item, price)))
        .collect();
    rows.sort_by(|a, b| b.chaos_value.total_cmp(&a.chaos_value));
    rows
}
