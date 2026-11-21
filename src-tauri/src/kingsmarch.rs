//! Раздел «Kingsmarch», подвкладка «Пыль»: сколько Thaumaturgic Dust даёт разбор уникального предмета
//! у Rog и сколько пыли выходит на один chaos по текущим ценам лиги (как wealthyexile.com/dust).
//!
//! Пыль уникальных — `data/dust-uniques.json` (из poe-disenchant-tool, MIT, `scripts/update-dust-data.mjs`):
//! значение при уровне предмета 84 без качества и с 20 % качества, сбор золота за покупку через
//! асинхронный трейд, размер в клетках. Цены — прайс лиги (`PricesService`): обычный вариант, без него —
//! самый дешёвый без 5–6 связей и relic (`dust_price`). Пересчёт по уровню, качеству и катализаторам — в интерфейсе
//! (`ui/src/modules/kingsmarch/dust.ts`).

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use item_parser::variant::PriceVariant;

use crate::dataset::model::{CatalogItem, ItemRarity};
use crate::dataset::{Catalog, DatasetService};
use crate::economy::category_of;
use crate::prices::{Price, PricesService};

const DUST_JSON: &str = include_str!("../data/dust-uniques.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DustFile {
    fetched_at: String,
    items: Vec<DustEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DustEntry {
    name: String,
    base_type: String,
    dust: u64,
    dust_q20: u64,
    gold: u64,
    slots: u32,
    #[serde(default)]
    no_quality: bool,
}

fn dust_file() -> &'static DustFile {
    static FILE: OnceLock<DustFile> = OnceLock::new();
    FILE.get_or_init(|| serde_json::from_str(DUST_JSON).expect("data/dust-uniques.json"))
}

/// Как поднять качество предмета до 20 %.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DustQuality {
    /// Оружие, броня, флаконы: точильные камни, лом, стеклодувы — копейки.
    Cheap,
    /// Бижутерия: 20 катализаторов.
    Catalyst,
    /// Качества не бывает: колчаны, самоцветы, осквернённые от выпадения.
    None,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DustRow {
    pub name_en: String,
    pub name_ru: Option<String>,
    pub base_en: String,
    pub base_ru: Option<String>,
    /// `null` — уникального нет в справочнике.
    pub item_id: Option<String>,
    pub icon_sha256: Option<String>,
    /// Раздел «Экономики»: `unique-weapons`, `unique-armours`, `unique-accessories`…
    pub category: Option<String>,
    /// Пыль при уровне 84 без качества и с 20 % качества.
    pub dust: u64,
    pub dust_q20: u64,
    pub quality: DustQuality,
    /// Сбор золота за покупку через асинхронный трейд.
    pub gold: u64,
    /// Клеток в инвентаре.
    pub slots: u32,
    /// Цена обычного варианта (или самого дешёвого без связей и relic), chaos; `null` — цены в лиге нет.
    pub chaos: Option<f64>,
    /// Лоты этого варианта; `null` — источники не сообщают.
    pub listings: Option<u32>,
    pub reliable: bool,
    /// Ключ варианта цены (`variant=Foulborn`…), `''` — обычный.
    pub price_variant: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DustCatalyst {
    pub name_en: String,
    pub name_ru: Option<String>,
    pub icon_sha256: Option<String>,
    pub chaos: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DustOverview {
    /// Лига цен; `null` — цены не загружены.
    pub league: Option<String>,
    pub rows: Vec<DustRow>,
    /// Самый дешёвый катализатор — качество бижутерии.
    pub catalyst: Option<DustCatalyst>,
    /// Когда обновлены данные о пыли (дата `YYYY-MM-DD`).
    pub data_date: String,
}

/// Запись справочника уникального: по имени, при совпадении имён — по базе.
fn find_unique<'a>(catalog: &'a Catalog, name: &str, base: &str) -> Option<&'a CatalogItem> {
    let found: Vec<&CatalogItem> = catalog.find_by_name(name).into_iter().filter(|c| c.rarity == ItemRarity::Unique).collect();
    if found.len() <= 1 {
        return found.first().copied();
    }
    let base = crate::dataset::normalize(base);
    found
        .iter()
        .copied()
        .find(|u| u.base_id.as_deref().and_then(|b| catalog.get(b)).is_some_and(|b| crate::dataset::normalize(&b.name.en) == base))
        .or_else(|| found.first().copied())
}

/// Цена для разбора: обычный вариант (`''`); его нет — самый дешёвый без связей и relic. Варианты
/// Foulborn с отдельными модами торгуются редко, и их цены у источников бывают случайными — поэтому
/// обычный вариант важнее дешёвого.
fn dust_price(variants: &[Price]) -> Option<(&Price, Option<u32>)> {
    let listings = |p: &Price| p.sources.iter().filter_map(|s| s.listing_count).max();
    if let Some(plain) = variants.iter().find(|p| p.variant_key.is_empty()) {
        return Some((plain, listings(plain)));
    }
    let cheapest = variants
        .iter()
        .filter(|p| PriceVariant::parse(&p.variant_key).is_ok_and(|v| v.links.is_none() && !v.relic))
        .min_by(|a, b| a.chaos_value.total_cmp(&b.chaos_value))?;
    Some((cheapest, listings(cheapest)))
}

fn cheapest_catalyst(catalog: &Catalog, prices: &PricesService) -> Option<DustCatalyst> {
    catalog
        .items
        .iter()
        .filter(|c| category_of(c) == "catalysts")
        .filter_map(|c| prices.chaos(&c.id).map(|chaos| (c, chaos)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, chaos)| DustCatalyst { name_en: c.name.en.clone(), name_ru: c.name.ru.clone(), icon_sha256: c.icon_sha256.clone(), chaos })
}

/// Уникальные с пылью и ценами текущей лиги.
#[tauri::command]
pub fn kingsmarch_dust(dataset: State<DatasetService>, prices: State<PricesService>) -> DustOverview {
    let file = dust_file();
    let catalog = dataset.catalog();
    let rows = file
        .items
        .iter()
        .map(|d| {
            let entry = catalog.as_deref().and_then(|c| find_unique(c, &d.name, &d.base_type));
            let base = catalog.as_deref().zip(entry.and_then(|e| e.base_id.as_deref())).and_then(|(c, b)| c.get(b));
            let category = entry.map(|e| category_of(e).to_string());
            let quiver = base.is_some_and(|b| b.class_id == "Quiver");
            let quality = if d.no_quality || quiver || matches!(category.as_deref(), Some("unique-jewels")) {
                DustQuality::None
            } else if category.as_deref() == Some("unique-accessories") {
                DustQuality::Catalyst
            } else {
                DustQuality::Cheap
            };
            let variants = entry.map(|e| prices.variants(&e.id)).unwrap_or_default();
            let price = dust_price(&variants);
            DustRow {
                name_en: d.name.clone(),
                name_ru: entry.and_then(|e| e.name.ru.clone()),
                base_en: d.base_type.clone(),
                base_ru: base.and_then(|b| b.name.ru.clone()),
                item_id: entry.map(|e| e.id.clone()),
                icon_sha256: entry.and_then(|e| e.icon_sha256.clone()),
                category,
                dust: d.dust,
                dust_q20: d.dust_q20,
                quality,
                gold: d.gold,
                slots: d.slots,
                chaos: price.map(|(p, _)| p.chaos_value),
                listings: price.and_then(|(_, l)| l),
                reliable: price.is_some_and(|(p, _)| p.reliable),
                price_variant: price.map(|(p, _)| p.variant_key.clone()),
                updated_at: price.map(|(p, _)| p.updated_at.clone()),
            }
        })
        .collect();
    DustOverview {
        league: prices.league(),
        rows,
        catalyst: catalog.as_deref().and_then(|c| cheapest_catalyst(c, &prices)),
        data_date: file.fetched_at.clone(),
    }
}
