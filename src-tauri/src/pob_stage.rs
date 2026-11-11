//! Этап сборки PoB с ценами (вкладка «Билды», шаг P5 плана shared/docs/pob-trader.md): набор
//! предметов, набор камней и дерево → строки «что купить» с ценой текущей лиги и запросом сайта
//! торговли. Предмет и камень PoB переводятся в `ParsedItem` и оцениваются тем же
//! `appraise_item`, что и захваченный из игры предмет: справочник, вариант, ближайшая цена.

use std::collections::HashMap;

use item_parser::variant::PriceVariant;
use item_parser::{Influence, Language, ModKind, ParsedItem, ParsedMod, Rarity, Sockets};
use pob_parser::{PobBuild, PobGem, PobInfluence, PobItem, PobModKind, PobRarity};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::appraise::{PriceMatch, appraise_item};
use crate::dataset::model::{CatalogItem, ItemKind};
use crate::dataset::{Catalog, DatasetService};
use crate::prices::{Price, PricesService};
use crate::trade::matcher::{match_item, ModRow};
use crate::trade::stats::StatIndex;

/// Секция экрана сборки.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobSection {
    Equipment,
    Jewellery,
    Flasks,
    Jewels,
    Gems,
}

/// Камень в строке: сам камень и его связка.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobGemRow {
    pub gem: PobGem,
    /// Номер связки (с 0) в наборе камней.
    pub group: usize,
    /// Где стоит связка (`Body Armour`) или её подпись; нет — камни не привязаны.
    pub group_label: Option<String>,
    /// Камень в связке выключен или выключена вся связка.
    pub enabled: bool,
}

/// Строка «что купить».
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobStageRow {
    /// Ключ ручной цены (`manualPrices` записи билда): `item|Helmet|Doom Grip`, `gem|Body Armour|Arc`.
    pub key: String,
    pub section: PobSection,
    /// Слот как в PoB (`Weapon 1 Swap`, `Flask 2`), у самоцвета дерева — `Tree`, у камня — связка.
    pub slot: String,
    pub item: Option<PobItem>,
    pub gem: Option<PobGemRow>,
    /// Входит в сумму этапа: выключенные камни и связки — нет.
    pub counted: bool,
    pub catalog_item: Option<CatalogItem>,
    pub variant_key: Option<String>,
    pub price: Option<Price>,
    pub price_match: Option<PriceMatch>,
    /// Моды предмета с фильтрами сайта торговли; пусто у камней и без `trade-stats.json`.
    pub mods: Vec<ModRow>,
    /// Запрос сайта торговли (`?q=`): по имени уникального, базе, камню, связям. Без модов (это P4).
    pub trade: Option<Value>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobStage {
    pub rows: Vec<PobStageRow>,
    /// Лига цен; нет — цены не загружены.
    pub league: Option<String>,
    /// Сумма автоматических цен строк, входящих в этап (ручные цены считает интерфейс).
    pub total_chaos: f64,
    /// Строк этапа без автоматической цены.
    pub unpriced: u32,
}

/// Этап: набор предметов `item_set`, набор камней `skill_set`, дерево `tree_spec` (индексы в сборке).
#[tauri::command]
pub async fn pob_stage(app: AppHandle, code: String, item_set: usize, skill_set: usize, tree_spec: usize) -> Result<PobStage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let build = pob_parser::parse_code(&code).map_err(|e| e.to_string())?;
        let catalog = app.state::<DatasetService>().catalog().ok_or("справочник ещё не загружен")?;
        let prices = app.state::<PricesService>();
        let variants = |id: &str| prices.variants(id);
        let stats = catalog.trade_stats.as_ref().and_then(|s| s.as_ref().ok()).cloned();
        let result = stage(&build, &catalog, &variants, stats.as_deref(), prices.league(), item_set, skill_set, tree_spec);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `prices` — цены предмета текущей лиги по id справочника, `league` — её название.
/// `stats` — индекс фильтров модов; нет — строки без модов.
#[allow(clippy::too_many_arguments)]
pub fn stage(
    build: &PobBuild,
    catalog: &Catalog,
    prices: &dyn Fn(&str) -> Vec<Price>,
    stats: Option<&StatIndex>,
    league: Option<String>,
    item_set: usize,
    skill_set: usize,
    tree_spec: usize,
) -> PobStage {
    let mut rows = Vec::new();

    if let Some(set) = build.item_sets.get(item_set) {
        for slot in &set.slots {
            let Some(item) = build.item(slot.item_id) else { continue };
            let section = section_of(&slot.name, item);
            rows.push(item_row(catalog, prices, stats, item, section, &slot.name, format!("item|{}|{}", slot.name, item.name)));
        }
    }
    if let Some(tree) = build.tree_specs.get(tree_spec) {
        for socket in &tree.sockets {
            let Some(item) = build.item(socket.item_id) else { continue };
            rows.push(item_row(catalog, prices, stats, item, PobSection::Jewels, "Tree", format!("jewel|{}|{}", socket.node_id, item.name)));
        }
    }
    if let Some(set) = build.skill_sets.get(skill_set) {
        let mut seen: HashMap<String, u32> = HashMap::new();
        for (index, group) in set.groups.iter().enumerate() {
            // Умение даёт предмет — покупать нечего.
            if group.source.is_some() {
                continue;
            }
            let label = group.slot.clone().or_else(|| group.label.clone().filter(|l| !l.trim().is_empty()));
            let place = label.clone().unwrap_or_else(|| format!("#{}", index + 1));
            for gem in &group.gems {
                let mut key = format!("gem|{place}|{}", gem.name);
                let n = seen.entry(key.clone()).or_default();
                *n += 1;
                if *n > 1 {
                    key = format!("{key}|{n}");
                }
                let enabled = group.enabled && gem.enabled;
                rows.push(gem_row(catalog, prices, gem, PobGemRow { gem: gem.clone(), group: index, group_label: label.clone(), enabled }, place.clone(), key));
            }
        }
    }

    let counted = rows.iter().filter(|r| r.counted);
    let total_chaos = counted.clone().filter_map(|r| r.price.as_ref()).map(|p| p.chaos_value).sum();
    let unpriced = counted.filter(|r| r.price.is_none()).count() as u32;
    PobStage { rows, league, total_chaos, unpriced }
}

fn section_of(slot: &str, item: &PobItem) -> PobSection {
    if slot.contains("Abyssal Socket") || item.base.ends_with("Jewel") {
        PobSection::Jewels
    } else if slot.starts_with("Flask") {
        PobSection::Flasks
    } else if slot.starts_with("Amulet") || slot.starts_with("Ring") || slot.starts_with("Belt") {
        PobSection::Jewellery
    } else {
        PobSection::Equipment
    }
}

fn item_row(catalog: &Catalog, prices: &dyn Fn(&str) -> Vec<Price>, stats: Option<&StatIndex>, item: &PobItem, section: PobSection, slot: &str, key: String) -> PobStageRow {
    let mut parsed = parsed_item(item);
    if parsed.rarity == Rarity::Unique {
        // PoB дописывает к имени своё: сид Timeless-самоцвета (`Elegant Hubris [91160; 3; Pain Attunement]`).
        // Имя справочника — самое длинное начало имени по словам.
        let words: Vec<&str> = parsed.name.split_whitespace().collect();
        if catalog.find_by_name(&parsed.name).is_empty()
            && let Some(name) = (1..words.len()).rev().map(|n| words[..n].join(" ")).find(|n| catalog.find_by_name(n).iter().any(|c| c.unique.is_some()))
        {
            parsed.name = name;
        }
    }
    let unique_name = (parsed.rarity == Rarity::Unique).then(|| parsed.name.clone());
    let appraisal = appraise_item(catalog, prices, parsed);
    let mut notes = appraisal.notes;
    let (mut price, mut price_match) = (appraisal.price, appraisal.price_match);
    if let Some((variant, found)) = appraisal.catalog_item.as_ref().and_then(|c| unique_variant_price(item, &prices(&c.id))) {
        notes.retain(|n| !n.starts_with("точной цены"));
        notes.push(format!("вариант PoB «{variant}» → цена варианта «{}»", found.variant_key));
        price_match = Some(PriceMatch::Exact);
        price = Some(found);
    }
    // Цена базы редкого предмета ничего не говорит о цене самого предмета: её не показываем и не
    // складываем. Свойства редких пойдут в поиск с шага P3.
    if matches!(item.rarity, PobRarity::Rare) {
        notes.retain(|n| !n.starts_with("редкий"));
        notes.push("редкий — цену укажите вручную после поиска на сайте торговли".into());
        price = None;
        price_match = None;
    }
    let trade = Some(item_query(item, unique_name.as_deref(), appraisal.catalog_item.as_ref(), catalog));
    PobStageRow {
        key,
        section,
        slot: slot.to_string(),
        item: Some(item.clone()),
        gem: None,
        mods: stats.map(|s| match_item(s, item, slot)).unwrap_or_default(),
        counted: true,
        catalog_item: appraisal.catalog_item,
        variant_key: appraisal.variant_key,
        price,
        price_match,
        trade,
        notes,
    }
}

fn gem_row(catalog: &Catalog, prices: &dyn Fn(&str) -> Vec<Price>, gem: &PobGem, row: PobGemRow, slot: String, key: String) -> PobStageRow {
    let entry = gem_entry(catalog, gem);
    let mut parsed = gem_item(gem);
    if let Some(entry) = entry {
        parsed.name = entry.name.en.clone();
    }
    let appraisal = appraise_item(catalog, prices, parsed);
    let trade = appraisal.catalog_item.as_ref().map(|c| gem_query(gem, c, catalog));
    PobStageRow {
        key,
        section: PobSection::Gems,
        slot,
        item: None,
        mods: Vec::new(),
        counted: row.enabled,
        gem: Some(row),
        catalog_item: appraisal.catalog_item,
        variant_key: appraisal.variant_key,
        price: appraisal.price,
        price_match: appraisal.price_match,
        trade,
        notes: appraisal.notes,
    }
}

/// Запись справочника камня: по названию (трансфигурированные — свои записи), по пути в данных игры,
/// затем «<название> Support» — PoB пишет поддержки без этого слова.
fn gem_entry<'a>(catalog: &'a Catalog, gem: &PobGem) -> Option<&'a CatalogItem> {
    let is_gem = |c: &&CatalogItem| c.kind == ItemKind::Gem;
    catalog
        .find_by_name(&gem.name)
        .into_iter()
        .find(is_gem)
        .or_else(|| gem.gem_id.as_deref().and_then(|id| catalog.get(&format!("base:{id}"))).filter(is_gem))
        .or_else(|| catalog.find_by_name(&format!("{} Support", gem.name)).into_iter().find(is_gem))
}

fn gem_item(gem: &PobGem) -> ParsedItem {
    ParsedItem {
        language: Language::En,
        item_class: String::new(),
        rarity: Rarity::Gem,
        name: gem.name.clone(),
        base_type: None,
        item_level: None,
        quality: Some(gem.quality),
        gem_level: Some(gem.level),
        stack_size: None,
        sockets: None,
        map_tier: None,
        blight: None,
        influences: Vec::new(),
        corrupted: gem.corrupted,
        mirrored: false,
        split: false,
        unidentified: false,
        synthesised: false,
        foulborn: false,
        foil: false,
        mods: Vec::new(),
    }
}

/// Предмет PoB как текст из игры на английском: этого хватает справочнику и ключу варианта цены.
pub fn parsed_item(item: &PobItem) -> ParsedItem {
    let unique = matches!(item.rarity, PobRarity::Unique | PobRarity::Relic);
    let (name, foulborn) = match item.name.strip_prefix("Foulborn ") {
        Some(rest) if unique => (rest.to_string(), true),
        _ => (item.name.clone(), unique && item.mods.iter().any(|m| m.mutated)),
    };
    let named = matches!(item.rarity, PobRarity::Unique | PobRarity::Relic | PobRarity::Rare);
    ParsedItem {
        language: Language::En,
        item_class: String::new(),
        rarity: match item.rarity {
            PobRarity::Normal => Rarity::Normal,
            PobRarity::Magic => Rarity::Magic,
            PobRarity::Rare => Rarity::Rare,
            PobRarity::Unique | PobRarity::Relic => Rarity::Unique,
        },
        // У обычного и волшебного PoB пишет одну строку; база — по справочнику (`find_base_in`).
        name: if named { name } else { item.base.clone() },
        base_type: named.then(|| base_name(&item.base).to_string()),
        item_level: item.item_level,
        quality: item.quality,
        gem_level: None,
        stack_size: None,
        sockets: item.sockets.as_ref().map(|s| Sockets {
            text: s.text.clone(),
            count: s.count,
            links: s.links,
            white: s.text.chars().filter(|c| *c == 'W').count() as u8,
        }),
        map_tier: None,
        blight: None,
        influences: item.influences.iter().filter_map(|i| influence(*i)).collect(),
        corrupted: item.corrupted,
        mirrored: item.mirrored,
        split: item.split,
        unidentified: false,
        synthesised: item.synthesised,
        foulborn,
        foil: item.rarity == PobRarity::Relic,
        mods: item
            .mods
            .iter()
            .map(|m| ParsedMod {
                kind: match m.kind {
                    PobModKind::Enchant => ModKind::Enchant,
                    PobModKind::Scourge => ModKind::Scourge,
                    PobModKind::Implicit => ModKind::Implicit,
                    PobModKind::Explicit | PobModKind::Crucible if m.fractured => ModKind::Fractured,
                    PobModKind::Explicit | PobModKind::Crucible if m.crafted => ModKind::Crafted,
                    PobModKind::Explicit | PobModKind::Crucible => ModKind::Explicit,
                },
                affix: None,
                name: None,
                tier: None,
                lines: vec![m.line.clone()],
            })
            .collect(),
    }
}

/// Цена выбранного варианта уникального. PoB и источники называют варианты по-разному
/// (`Adds 3 Small Passive Skills` и `3 passives`): берётся вариант цены с наибольшим числом общих
/// слов и чисел; ни одного общего — `None`, остаётся обычная оценка. Связи и relic должны совпасть.
fn unique_variant_price(item: &PobItem, prices: &[Price]) -> Option<(String, Price)> {
    if !matches!(item.rarity, PobRarity::Unique | PobRarity::Relic) || item.variants.len() < 2 {
        return None;
    }
    let selected = item.variants.get((item.selected_variant? as usize).checked_sub(1)?)?;
    // «Pre 3.12.0», «Current» — версии предмета, а не варианты у источников: числа версии совпали бы
    // с «3 passives» случайно.
    if selected.starts_with("Pre ") || selected.starts_with("Current") {
        return None;
    }
    let words = |text: &str| -> Vec<String> {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| w.to_lowercase().trim_end_matches('s').to_string())
            .collect()
    };
    let wanted = words(selected);
    let links = item.sockets.as_ref().map(|s| s.links).filter(|l| *l >= 5);
    let relic = item.rarity == PobRarity::Relic;
    prices
        .iter()
        .filter_map(|p| {
            let v = PriceVariant::parse(&p.variant_key).ok()?;
            let name = v.variant.as_deref()?;
            if v.links != links || v.relic != relic {
                return None;
            }
            let score = words(name).iter().filter(|w| wanted.contains(w)).count();
            (score > 0).then_some((score, p))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, p)| (selected.clone(), p.clone()))
}

/// База без уточнения PoB в скобках: `Two-Toned Boots (Armour/Energy Shield)` → `Two-Toned Boots`.
fn base_name(base: &str) -> &str {
    base.split_once(" (").map_or(base, |(name, _)| name)
}

fn influence(influence: PobInfluence) -> Option<Influence> {
    match influence {
        PobInfluence::Shaper => Some(Influence::Shaper),
        PobInfluence::Elder => Some(Influence::Elder),
        PobInfluence::Crusader => Some(Influence::Crusader),
        PobInfluence::Redeemer => Some(Influence::Redeemer),
        PobInfluence::Hunter => Some(Influence::Hunter),
        PobInfluence::Warlord => Some(Influence::Warlord),
        // Эльдрических влияний в ключе цены нет.
        PobInfluence::SearingExarch | PobInfluence::EaterOfWorlds => None,
    }
}

const INFLUENCE_FILTERS: [(PobInfluence, &str); 6] = [
    (PobInfluence::Shaper, "shaper_item"),
    (PobInfluence::Elder, "elder_item"),
    (PobInfluence::Crusader, "crusader_item"),
    (PobInfluence::Redeemer, "redeemer_item"),
    (PobInfluence::Hunter, "hunter_item"),
    (PobInfluence::Warlord, "warlord_item"),
];

/// Запрос предмета: уникальный — имя и база; остальные — база (обычный и волшебный — по справочнику),
/// уровень предмета не ниже, влияния; у всех — связи от 5 и осквернение.
fn item_query(item: &PobItem, unique_name: Option<&str>, entry: Option<&CatalogItem>, catalog: &Catalog) -> Value {
    let mut query = json!({ "status": { "option": "online" }, "stats": [{ "type": "and", "filters": [] }] });
    let unique = matches!(item.rarity, PobRarity::Unique | PobRarity::Relic);
    let base = if unique {
        entry.and_then(|u| u.base_id.as_deref()).and_then(|b| catalog.get(b)).map_or_else(|| base_name(&item.base).to_string(), |b| b.name.en.clone())
    } else if matches!(item.rarity, PobRarity::Rare) {
        base_name(&item.base).to_string()
    } else {
        entry.map_or_else(|| item.base.clone(), |b| b.name.en.clone())
    };
    if unique {
        query["name"] = json!(unique_name.unwrap_or(&item.name));
    }
    query["type"] = json!(base);

    let mut misc = serde_json::Map::new();
    if !unique {
        if let Some(ilvl) = item.item_level.filter(|l| *l > 1) {
            misc.insert("ilvl".into(), json!({ "min": ilvl }));
        }
        for (influence, filter) in INFLUENCE_FILTERS {
            if item.influences.contains(&influence) {
                misc.insert(filter.into(), json!({ "option": "true" }));
            }
        }
    }
    if item.corrupted {
        misc.insert("corrupted".into(), json!({ "option": "true" }));
    }
    let mut filters = serde_json::Map::new();
    if !misc.is_empty() {
        filters.insert("misc_filters".into(), json!({ "filters": misc }));
    }
    if let Some(links) = item.sockets.as_ref().map(|s| s.links).filter(|l| *l >= 5) {
        filters.insert("socket_filters".into(), json!({ "filters": { "links": { "min": links } } }));
    }
    if !unique && matches!(item.rarity, PobRarity::Normal) {
        filters.insert("type_filters".into(), json!({ "filters": { "rarity": { "option": "normal" } } }));
    }
    if !filters.is_empty() {
        query["filters"] = Value::Object(filters);
    }
    json!({ "query": query, "sort": { "price": "asc" } })
}

/// Запрос камня: тип (трансфигурированный — базовый камень и `discriminator`), уровень и качество
/// не ниже, осквернение.
fn gem_query(gem: &PobGem, entry: &CatalogItem, catalog: &Catalog) -> Value {
    // `base:<путь камня>:alt_x` — трансфигурированный: на сайте это базовый камень с дискриминатором.
    let ty = match entry.id.rsplit_once(':') {
        Some((base_id, disc)) if disc.starts_with("alt_") => {
            let base = catalog.get(base_id).map_or_else(|| entry.name.en.clone(), |b| b.name.en.clone());
            json!({ "option": base, "discriminator": disc })
        }
        _ => json!(entry.name.en),
    };
    let mut misc = serde_json::Map::new();
    if gem.level > 1 {
        misc.insert("gem_level".into(), json!({ "min": gem.level }));
    }
    if gem.quality > 0 {
        misc.insert("quality".into(), json!({ "min": gem.quality }));
    }
    misc.insert("corrupted".into(), json!({ "option": if gem.corrupted { "true" } else { "false" } }));
    json!({
        "query": { "status": { "option": "online" }, "type": ty, "stats": [{ "type": "and", "filters": [] }], "filters": { "misc_filters": { "filters": misc } } },
        "sort": { "price": "asc" }
    })
}
