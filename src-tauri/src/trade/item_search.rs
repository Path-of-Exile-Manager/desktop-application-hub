//! Поиск предмета на сайте торговли из Price check и Watchlist: спецификация `TradeSearchSpec`
//! по оценённому предмету (тип, моды, связи, влияния) или по записи справочника и ключу варианта
//! цены. Запрос и ссылку по спецификации строит `trade_query`, как и для строк PoB.

use std::collections::HashMap;

use item_parser::variant::PriceVariant;
use item_parser::{Blight, Influence, Language, ModKind, Rarity};
use pob_parser::PobModKind;
use tauri::State;

use super::matcher::{match_mod, ModQuery, ModUnavailable};
use super::query::{default_bounds, Corrupted, SpecMod, TradeSearchSpec, DEFAULT_TOLERANCE};
use super::stats::StatIndex;
use crate::appraise::Appraisal;
use crate::dataset::model::{CatalogItem, ItemDetails, ItemKind, ItemRarity};
use crate::dataset::{Catalog, DatasetService};
use crate::item_mods::ModLabel;

/// Камень: трансфигурированный (`base:<путь камня>:alt_x`) на сайте — базовый камень с дискриминатором.
pub fn gem_spec(catalog: &Catalog, entry: &CatalogItem, level: u32, quality: u32, corrupted: bool) -> TradeSearchSpec {
    match entry.id.rsplit_once(':') {
        Some((base_id, disc)) if disc.starts_with("alt_") => {
            let base = catalog.get(base_id).map_or_else(|| entry.name.en.clone(), |b| b.name.en.clone());
            TradeSearchSpec::gem(base, Some(disc.to_string()), level, quality, corrupted)
        }
        _ => TradeSearchSpec::gem(entry.name.en.clone(), None, level, quality, corrupted),
    }
}

/// Спецификация оценённого предмета; `None` — предмета нет в справочнике (сайт ждёт английские
/// названия, а их даёт только справочник). Умолчания: у уникального — имя и база, моды выключены;
/// у волшебного и редкого — все найденные моды с MIN = значение − 10 %; связи от 5; осквернение
/// «да» у осквернённого; влияния; уровень предмета — у белых и волшебных баз и у самоцветов;
/// опознан — как предмет.
pub fn appraisal_spec(catalog: &Catalog, stats: Option<&StatIndex>, appraisal: &Appraisal) -> Option<TradeSearchSpec> {
    let entry = appraisal.catalog_item.as_ref()?;
    let item = &appraisal.item;
    if entry.kind == ItemKind::Gem {
        return Some(gem_spec(catalog, entry, item.gem_level.unwrap_or(1), item.quality.unwrap_or(0), item.corrupted));
    }
    let unique = item.rarity == Rarity::Unique;
    let mut spec = named(catalog, entry);
    let gear = is_gear(entry.kind);
    spec.rarity = match item.rarity {
        Rarity::Unique if item.foil => Some("uniquefoil".into()),
        // Неопознанный уникальный: в справочнике нашлась только база.
        Rarity::Unique if spec.name.is_none() => Some("unique".into()),
        Rarity::Normal if gear => Some("normal".into()),
        Rarity::Magic | Rarity::Rare if gear => Some("nonunique".into()),
        _ => None,
    };
    spec.links = item.sockets.as_ref().map(|s| s.links).filter(|l| *l >= 5);
    spec.corrupted = if item.corrupted { Corrupted::Yes } else { Corrupted::Any };
    if !unique && gear {
        // Для «любой базы этого типа» в поиске: ботинки вместо Sorcerer Boots.
        spec.category = trade_category(entry).map(str::to_string);
        // У редкого цену решают моды: уровень предмета сузил бы поиск зря.
        if item.rarity != Rarity::Rare || entry.kind == ItemKind::Jewel {
            spec.item_level = item.item_level.filter(|l| *l > 1);
        }
        spec.influences = item.influences.iter().map(|i| influence_filter(*i).to_string()).collect();
    }
    if entry.kind == ItemKind::Map {
        spec.map_tier = item.map_tier;
        spec.map_blight = item.blight.map(|b| blight_filter(b).to_string());
    }
    // Опознан ли: как пойманный предмет; Price check даёт выбрать «любой». У валюты, камней и
    // карт гадания `null` — по нему интерфейс не показывает выбор.
    if gear || entry.kind == ItemKind::Map {
        spec.identified = Some(!item.unidentified);
    }
    if let Some(stats) = stats {
        let wanted = |kind: ModKind| match item.rarity {
            Rarity::Magic | Rarity::Rare => true,
            // Белый кластерный самоцвет: цену решает энчант.
            Rarity::Normal => kind == ModKind::Enchant && entry.kind == ItemKind::Jewel,
            _ => false,
        };
        let lines: Vec<Line> = item
            .mods
            .iter()
            .flat_map(|m| {
                let (kind, crafted, fractured) = match m.kind {
                    ModKind::Enchant => (PobModKind::Enchant, false, false),
                    ModKind::Implicit => (PobModKind::Implicit, false, false),
                    ModKind::Scourge => (PobModKind::Scourge, false, false),
                    ModKind::Explicit => (PobModKind::Explicit, false, false),
                    ModKind::Crafted => (PobModKind::Explicit, true, false),
                    ModKind::Fractured => (PobModKind::Explicit, false, true),
                };
                let enabled = wanted(m.kind);
                // Префикс/суффикс и тир — из текста игры (с заголовком мода — точно) или угаданные `label_mods`.
                let label = m.affix.map(|affix| ModLabel { affix, tier: m.tier, exact: m.name.is_some() });
                m.lines.iter().map(move |l| Line { text: strip_ranges(l), kind, crafted, fractured, enabled, label })
            })
            .collect();
        spec.mods = spec_mods(stats, &lines, item.language, local_slot(entry));
    }
    Some(spec)
}

/// Спецификация записи справочника и варианта цены (Watchlist): то, что различает варианты у
/// источников, — связи, уровень предмета, влияния, тир и заражение карты, энчант кластера.
pub fn variant_spec(catalog: &Catalog, stats: Option<&StatIndex>, entry: &CatalogItem, variant_key: &str) -> Result<TradeSearchSpec, String> {
    let v = PriceVariant::parse(variant_key).map_err(|e| format!("вариант «{variant_key}» не разобран: {e}"))?;
    if entry.kind == ItemKind::Gem {
        return Ok(gem_spec(catalog, entry, v.level.unwrap_or(1), v.quality.unwrap_or(0), v.corrupted.unwrap_or(false)));
    }
    let unique = entry.rarity == ItemRarity::Unique;
    let gear = is_gear(entry.kind);
    let mut spec = named(catalog, entry);
    spec.rarity = if unique && v.relic {
        Some("uniquefoil".into())
    } else if !unique && gear {
        Some("nonunique".into())
    } else {
        None
    };
    spec.links = v.links;
    spec.corrupted = if v.corrupted == Some(true) { Corrupted::Yes } else { Corrupted::Any };
    spec.item_level = v.ilvl;
    if !unique {
        // Два влияния источники пишут именованным вариантом: `Shaper/Warlord`.
        let mut influences: Vec<Influence> = v.influence.into_iter().collect();
        if let Some(name) = &v.variant {
            influences.extend(name.split('/').filter_map(|part| ALL_INFLUENCES.into_iter().find(|i| i.title() == part)));
        }
        spec.influences = influences.into_iter().map(|i| influence_filter(i).to_string()).collect();
    }
    spec.map_tier = v.tier;
    spec.map_blight = v.blight.map(|b| blight_filter(b).to_string());
    if let Some(stats) = stats
        && entry.kind == ItemKind::Jewel
        && !unique
    {
        let mut lines = Vec::new();
        if let Some(n) = v.passives {
            lines.push(Line { text: format!("Adds {n} Passive Skills"), kind: PobModKind::Enchant, crafted: false, fractured: false, enabled: true, label: None });
        }
        if let Some(grant) = &v.enchant {
            lines.push(Line { text: format!("Added Small Passive Skills grant: {grant}"), kind: PobModKind::Enchant, crafted: false, fractured: false, enabled: true, label: None });
        }
        spec.mods = spec_mods(stats, &lines, Language::En, "");
        // Число пассивов — ровно такое: 8 и 12 пассивов — разные самоцветы.
        for m in spec.mods.iter_mut().filter(|m| m.option.is_none() && !m.fixed_text) {
            m.min = m.value;
            m.max = m.value;
        }
    }
    Ok(spec)
}

const ALL_INFLUENCES: [Influence; 6] = [Influence::Shaper, Influence::Elder, Influence::Crusader, Influence::Redeemer, Influence::Hunter, Influence::Warlord];

/// Имя и тип на сайте: у уникального — имя и база справочника, у остальных — сама запись.
fn named(catalog: &Catalog, entry: &CatalogItem) -> TradeSearchSpec {
    let mut spec = TradeSearchSpec::empty();
    if entry.rarity == ItemRarity::Unique {
        spec.name = Some(entry.name.en.clone());
        spec.type_line = entry.base_id.as_deref().and_then(|b| catalog.get(b)).map(|b| b.name.en.clone());
    } else {
        spec.type_line = Some(entry.name.en.clone());
    }
    spec
}

/// Предметы с редкостью на сайте: снаряжение, самоцветы, флаконы, настойки.
fn is_gear(kind: ItemKind) -> bool {
    matches!(kind, ItemKind::Equipment | ItemKind::Jewel | ItemKind::Flask | ItemKind::Tincture)
}

/// Слот для сопоставления модов: у оружия и брони бывают местные двойники статов (`(Local)`),
/// `match_mod` узнаёт их по имени слота PoB.
fn local_slot(entry: &CatalogItem) -> &'static str {
    match &entry.details {
        ItemDetails::Equipment { tags, .. } if tags.iter().any(|t| t == "weapon" || t == "armour") => "Weapon",
        _ => "",
    }
}

/// Категория сайта торговли (`type_filters.category`) по классу базы справочника.
fn trade_category(entry: &CatalogItem) -> Option<&'static str> {
    Some(match entry.class_id.as_str() {
        "Boots" => "armour.boots",
        "Gloves" => "armour.gloves",
        "Helmet" => "armour.helmet",
        "Body Armour" => "armour.chest",
        "Shield" => "armour.shield",
        "Quiver" => "armour.quiver",
        "Ring" => "accessory.ring",
        "Amulet" => "accessory.amulet",
        "Belt" => "accessory.belt",
        "Trinket" => "accessory.trinket",
        "Bow" => "weapon.bow",
        "Claw" => "weapon.claw",
        "Dagger" => "weapon.basedagger",
        "Rune Dagger" => "weapon.runedagger",
        "One Hand Axe" => "weapon.oneaxe",
        "One Hand Sword" => "weapon.basesword",
        "Thrusting One Hand Sword" => "weapon.rapier",
        "One Hand Mace" => "weapon.basemace",
        "Sceptre" => "weapon.sceptre",
        "Staff" => "weapon.basestaff",
        "Warstaff" => "weapon.warstaff",
        "Two Hand Axe" => "weapon.twoaxe",
        "Two Hand Mace" => "weapon.twomace",
        "Two Hand Sword" => "weapon.twosword",
        "Wand" => "weapon.wand",
        "FishingRod" => "weapon.rod",
        "AbyssJewel" => "jewel.abyss",
        // Кластерный самоцвет — свой тип на сайте; базы у него и так одна на размер.
        "Jewel" if entry.name.en.contains("Cluster Jewel") => "jewel.cluster",
        "Jewel" => "jewel.base",
        "LifeFlask" | "ManaFlask" | "HybridFlask" | "UtilityFlask" => "flask",
        "Tincture" => "tincture",
        _ => return None,
    })
}

fn influence_filter(influence: Influence) -> &'static str {
    match influence {
        Influence::Shaper => "shaper_item",
        Influence::Elder => "elder_item",
        Influence::Crusader => "crusader_item",
        Influence::Redeemer => "redeemer_item",
        Influence::Hunter => "hunter_item",
        Influence::Warlord => "warlord_item",
    }
}

fn blight_filter(blight: Blight) -> &'static str {
    match blight {
        Blight::Blighted => "map_blighted",
        Blight::Ravaged => "map_uberblighted",
    }
}

/// Строка мода для поиска.
struct Line {
    text: String,
    kind: PobModKind,
    crafted: bool,
    fractured: bool,
    /// Включить в поиск, если фильтр найден.
    enabled: bool,
    label: Option<ModLabel>,
}

/// Моды спецификации: стат каждой строки; второй мод с тем же статом — дубль первого.
fn spec_mods(stats: &StatIndex, lines: &[Line], language: Language, slot: &str) -> Vec<SpecMod> {
    let mut owner: HashMap<String, usize> = HashMap::new();
    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let query = ModQuery { line: &line.text, kind: line.kind, crafted: line.crafted, fractured: line.fractured, language };
            let matched = match_mod(stats, &query, slot);
            let duplicate_of = matched.as_ref().and_then(|m| match owner.get(&m.stat_id) {
                Some(&first) => Some(first),
                None => {
                    owner.insert(m.stat_id.clone(), index);
                    None
                }
            });
            let unavailable = match (&matched, duplicate_of) {
                (None, _) => Some(ModUnavailable::NoStat),
                (Some(_), Some(_)) => Some(ModUnavailable::Duplicate),
                _ => None,
            };
            let value = matched.as_ref().and_then(|m| m.average);
            let fixed_text = matched.as_ref().is_some_and(|m| m.fixed_text);
            let (min, max) = if fixed_text { (None, None) } else { default_bounds(value, DEFAULT_TOLERANCE) };
            SpecMod {
                index,
                line: line.text.clone(),
                kind: line.kind,
                stat_id: matched.as_ref().map(|m| m.stat_id.clone()),
                fractured_stat_id: None,
                option: matched.as_ref().and_then(|m| m.option),
                value,
                fixed_text,
                pseudo: matched.as_ref().and_then(|m| m.pseudo.clone()),
                enabled: line.enabled && unavailable.is_none(),
                min,
                max,
                use_fractured: false,
                unavailable,
                duplicate_of,
                label: line.label,
            }
        })
        .collect()
}

/// Строка без диапазонов значений из расширенного описания: `+15(10-19) to maximum Life` →
/// `+15 to maximum Life`, иначе числа диапазона попали бы в значение мода.
fn strip_ranges(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('(') {
        let Some(close) = rest[open..].find(')').map(|c| open + c) else { break };
        let inner = &rest[open + 1..close];
        let range = inner.chars().any(|c| c.is_ascii_digit()) && inner.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | ' '));
        out.push_str(&rest[..open]);
        if !range {
            out.push_str(&rest[open..=close]);
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    out
}

/// Спецификация поиска по записи справочника и ключу варианта цены (Watchlist).
#[tauri::command]
pub fn trade_variant_spec(service: State<DatasetService>, item_id: String, variant_key: String) -> Result<TradeSearchSpec, String> {
    let catalog = service.catalog().ok_or("справочник ещё не загружен")?;
    let entry = catalog.get(&item_id).ok_or("предмета нет в справочнике")?;
    let stats = catalog.trade_stats.as_ref().and_then(|s| s.as_ref().ok()).map(|s| s.as_ref());
    variant_spec(&catalog, stats, entry, &variant_key)
}
