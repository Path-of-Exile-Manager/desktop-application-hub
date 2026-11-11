//! Оценка предмета по тексту из игры: разбор (`item_parser`) → запись справочника → ключ варианта
//! → цена в текущей лиге. Если точного варианта нет — ближайший из тех, что реально есть у
//! источников, с пометкой, какой взят (`shared/docs/desktop-integration.md`, Ф5).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use item_parser::variant::{self, CatalogKind, PriceVariant};
use item_parser::{ModKind, ParsedItem, Rarity};

use crate::dataset::model::{CatalogItem, ItemKind, ItemRarity, ReleaseState};
use crate::dataset::{Catalog, DatasetService};
use crate::prices::{Price, PricesService};

pub const EVENT: &str = "item-appraised";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PriceMatch {
    /// Цена ровно этого варианта.
    Exact,
    /// Точного варианта у источников нет — взят ближайший.
    Nearest,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Appraisal {
    pub item: ParsedItem,
    /// Запись справочника; `null` — предмет не найден.
    pub catalog_item: Option<CatalogItem>,
    /// Сколько записей справочника подошло (одинаковые названия: тиры карт, версии баз).
    pub candidates: u32,
    /// Ключ варианта, который описывает предмет.
    pub variant_key: Option<String>,
    pub price: Option<Price>,
    pub price_match: Option<PriceMatch>,
    /// Пояснения для человека: что угадано, чего нет.
    pub notes: Vec<String>,
}

/// Последняя оценка — для окна, открытого позже события.
#[derive(Default)]
pub struct LastAppraisal(pub std::sync::Mutex<Option<Appraisal>>);

pub fn appraise(app: &AppHandle, text: &str) -> Result<Appraisal, String> {
    let item = item_parser::parse(text).map_err(|e| e.to_string())?;
    let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
    let prices = app.state::<PricesService>();
    Ok(appraise_item(&catalog, &|id: &str| prices.variants(id), item))
}

/// Оценка уже разобранного предмета: текст из игры или предмет сборки PoB (`pob_stage`).
/// `prices` — цены предмета текущей лиги по id справочника (`PricesService::variants`).
pub fn appraise_item(catalog: &Catalog, prices: &dyn Fn(&str) -> Vec<Price>, mut item: ParsedItem) -> Appraisal {
    let mut notes = Vec::new();

    let (lookup_name, found) = find(catalog, &item, &mut notes);
    let mut found: Vec<&CatalogItem> = found;
    // Одинаковые названия: класс из текста, затем — запись, у которой есть цена, затем выпускаемая.
    if found.len() > 1
        && let Some(class_id) = catalog.class_id_by_name(&item.item_class) {
            let same_class: Vec<&CatalogItem> = found.iter().copied().filter(|c| c.class_id == class_id).collect();
            if !same_class.is_empty() {
                found = same_class;
            }
        }
    let candidates = found.len() as u32;
    found.sort_by_key(|c| (prices(&c.id).is_empty(), c.release_state != ReleaseState::Released));
    let Some(matched) = found.first().copied().cloned() else {
        notes.push(format!("в справочнике нет «{lookup_name}»"));
        return Appraisal { item, catalog_item: None, candidates: 0, variant_key: None, price: None, price_match: None, notes };
    };
    if candidates > 1 {
        notes.push(format!("одно название у {candidates} записей справочника — взята та, у которой есть цена"));
    }

    label_mods(catalog, &matched, &mut item, &mut notes);
    let kind = catalog_kind(matched.kind);
    let wanted = variant::variant_of(&item, kind);
    let key = wanted.key();
    if kind == CatalogKind::Jewel && item.rarity != Rarity::Unique && !variant::cluster_enchant_supported(item.language) && wanted.passives.is_some() {
        notes.push("энчант кластера в русском клиенте не распознаётся — цена по числу пассивов и уровню".into());
    }

    let variants = prices(&matched.id);
    let (price, price_match) = match pick(&wanted, &key, &variants) {
        Some((p, exact)) => (Some(p), Some(if exact { PriceMatch::Exact } else { PriceMatch::Nearest })),
        None => {
            notes.push(if variants.is_empty() { "в текущей лиге цены на предмет нет".into() } else { "ни один вариант цены не подходит".into() });
            (None, None)
        }
    };
    if let (Some(p), Some(PriceMatch::Nearest)) = (&price, price_match) {
        notes.push(format!(
            "точной цены варианта «{}» нет — взят «{}»",
            if key.is_empty() { "обычный" } else { &key },
            if p.variant_key.is_empty() { "обычный" } else { &p.variant_key }
        ));
    }

    Appraisal { item, catalog_item: Some(matched), candidates, variant_key: Some(key), price, price_match, notes }
}

/// Записи справочника по тексту предмета; первое — название, по которому искали.
fn find<'a>(catalog: &'a Catalog, item: &ParsedItem, notes: &mut Vec<String>) -> (String, Vec<&'a CatalogItem>) {
    let by_rarity = |list: Vec<&'a CatalogItem>, rarity: ItemRarity| list.into_iter().filter(|c| c.rarity == rarity).collect::<Vec<_>>();
    match item.rarity {
        Rarity::Unique if !item.unidentified => {
            let mut found = by_rarity(catalog.find_by_name(&item.name), ItemRarity::Unique);
            // Одно имя на нескольких базах (реплики, версии) — по базе из текста.
            if found.len() > 1
                && let Some(base) = &item.base_type {
                    let on_base: Vec<&CatalogItem> = found
                        .iter()
                        .copied()
                        .filter(|u| u.base_id.as_deref().and_then(|b| catalog.get(b)).is_some_and(|b| names_match(b, base)))
                        .collect();
                    if !on_base.is_empty() {
                        found = on_base;
                    }
                }
            (item.name.clone(), found)
        }
        Rarity::Unique => {
            notes.push("уникальный не опознан — показана цена базы".into());
            let base = item.base_type.clone().unwrap_or_else(|| item.name.clone());
            (base.clone(), by_rarity(catalog.find_by_name(&base), ItemRarity::Normal))
        }
        Rarity::Magic => {
            let found = catalog.find_base_in(&item.name);
            if !found.is_empty() {
                notes.push("волшебный — цена базы".into());
            }
            (item.name.clone(), found)
        }
        Rarity::Rare => {
            // У неопознанного редкого одна строка — база.
            let base = item.base_type.clone().unwrap_or_else(|| item.name.clone());
            notes.push("редкий — цена базы (оценка свойств редких предметов — позже)".into());
            (base.clone(), by_rarity(catalog.find_by_name(&base), ItemRarity::Normal))
        }
        _ => (item.name.clone(), by_rarity(catalog.find_by_name(&item.name), ItemRarity::Normal)),
    }
}

fn names_match(item: &CatalogItem, name: &str) -> bool {
    let name = crate::dataset::normalize(name);
    crate::dataset::normalize(&item.name.en) == name || item.name.ru.as_deref().map(crate::dataset::normalize).as_deref() == Some(name.as_str())
}

fn catalog_kind(kind: ItemKind) -> CatalogKind {
    match kind {
        ItemKind::Equipment => CatalogKind::Equipment,
        ItemKind::Flask => CatalogKind::Flask,
        ItemKind::Tincture => CatalogKind::Tincture,
        ItemKind::Jewel => CatalogKind::Jewel,
        ItemKind::Gem => CatalogKind::Gem,
        ItemKind::Currency => CatalogKind::Currency,
        ItemKind::Fragment => CatalogKind::Fragment,
        ItemKind::Map => CatalogKind::Map,
        ItemKind::Card => CatalogKind::Card,
        ItemKind::Other | ItemKind::Unknown => CatalogKind::Other,
    }
}

/// Цена варианта: точная, иначе ближайшая по штрафу. `None` — подходящих нет.
fn pick(wanted: &PriceVariant, key: &str, variants: &[Price]) -> Option<(Price, bool)> {
    if let Some(exact) = variants.iter().find(|p| p.variant_key == key) {
        return Some((exact.clone(), true));
    }
    variants
        .iter()
        .filter_map(|p| PriceVariant::parse(&p.variant_key).ok().and_then(|v| penalty(wanted, &v)).map(|score| (score, p)))
        .min_by_key(|(score, p)| (*score, p.variant_key.len()))
        .map(|(_, p)| (p.clone(), false))
}

/// Насколько вариант цены далёк от предмета; `None` — не подходит вовсе.
/// Веса подобраны так, чтобы важное для цены (связи, осквернение, влияние, Foulborn) перевешивало
/// близость уровня и качества.
fn penalty(want: &PriceVariant, cand: &PriceVariant) -> Option<u32> {
    let diff = |a: u32, b: u32| a.abs_diff(b);
    let mut p = 0u32;

    // Связи и relic: лишнего у варианта быть не может; недостающее — дешевле, но допустимо.
    match (want.links, cand.links) {
        (w, Some(c)) if w != Some(c) => return None,
        (Some(_), None) => p += 200,
        _ => {}
    }
    match (want.relic, cand.relic) {
        (false, true) => return None,
        (true, false) => p += 200,
        _ => {}
    }
    if want.corrupted.unwrap_or(false) != cand.corrupted.unwrap_or(false) {
        p += 500;
    }
    match (want.level, cand.level) {
        (Some(w), Some(c)) => p += diff(w, c) * 20,
        (None, None) => {}
        _ => p += 100,
    }
    p += diff(want.quality.unwrap_or(0), cand.quality.unwrap_or(0)) * 2;
    match (want.ilvl, cand.ilvl) {
        // Источники считают «ilvl N» нижней границей: вариант выше уровня предмета не подходит.
        (Some(w), Some(c)) if c > w => return None,
        (Some(w), Some(c)) => p += (w - c) * 3,
        (None, Some(_)) => p += 50,
        (Some(_), None) => p += 30,
        (None, None) => {}
    }
    if want.influence != cand.influence {
        p += 400;
    }
    match (&want.variant, &cand.variant) {
        (Some(w), Some(c)) if w == c => {}
        (Some(w), Some(c)) if c.contains(w.as_str()) => p += 20,
        (Some(w), _) if w == "Foulborn" => p += 600,
        (Some(_), _) => p += 300,
        (None, Some(c)) if c.contains("Foulborn") => return None,
        // Карты: «Atlas» ближе, чем «The Constrictor, Atlas».
        (None, Some(c)) => p += 40 + c.matches(", ").count() as u32 * 20,
        (None, None) => {}
    }
    match (&want.enchant, &cand.enchant) {
        (Some(w), Some(c)) if w == c => {}
        (Some(_), Some(_)) => p += 800,
        (None, Some(_)) => p += 300,
        (Some(_), None) => p += 100,
        (None, None) => {}
    }
    match (want.passives, cand.passives) {
        (Some(w), Some(c)) => p += diff(w, c) * 150,
        (None, None) => {}
        _ => p += 100,
    }
    match (want.tier, cand.tier) {
        (Some(w), Some(c)) => p += diff(w, c) * 50,
        (None, None) => {}
        _ => p += 30,
    }
    if want.blight != cand.blight {
        p += 400;
    }
    Some(p)
}

/// Оценка текста предмета (страница «Режим разработки», захват предмета).
#[tauri::command]
pub async fn item_appraise(app: AppHandle, text: String) -> Result<Appraisal, String> {
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || appraise(&handle, &text)).await.map_err(|e| e.to_string())?;
    if let Ok(appraisal) = &result {
        publish(&app, appraisal.clone());
    }
    result
}

/// Сохраняет оценку последней и рассылает событие `item-appraised`.
pub fn publish(app: &AppHandle, appraisal: Appraisal) {
    *app.state::<LastAppraisal>().0.lock().unwrap() = Some(appraisal.clone());
    let _ = app.emit(EVENT, appraisal);
}

/// Последняя оценка, если была.
#[tauri::command]
pub fn item_last_appraisal(last: State<LastAppraisal>) -> Option<Appraisal> {
    last.0.lock().unwrap().clone()
}

/// Префикс/суффикс и тир explicit-модов редкого или волшебного предмета, у которых их нет в тексте
/// (простое Ctrl+C или русский клиент без заголовков модов), — по `item-mods.json`, предположительно.
fn label_mods(catalog: &Catalog, base_item: &CatalogItem, item: &mut ParsedItem, notes: &mut Vec<String>) {
    if !matches!(item.rarity, Rarity::Rare | Rarity::Magic) {
        return;
    }
    let (Some(Ok(index)), Some(base)) = (&catalog.item_mods, crate::item_mods::Base::of(base_item)) else { return };
    let base = base.with_influences(&item.influences);
    let language = item.language;
    let mut filled = 0;
    for m in item.mods.iter_mut().filter(|m| matches!(m.kind, ModKind::Explicit | ModKind::Fractured) && m.affix.is_none()) {
        let Some(label) = m.lines.iter().find_map(|line| index.label(line, language, &base, &[])) else { continue };
        m.affix = Some(label.affix);
        if m.tier.is_none() {
            m.tier = label.tier;
        }
        filled += 1;
    }
    if filled > 0 {
        notes.push(format!("префикс/суффикс и тир {filled} модов определены по данным игры — предположительно"));
    }
}
