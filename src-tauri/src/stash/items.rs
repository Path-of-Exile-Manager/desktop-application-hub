//! Предмет тайника (JSON сайта) → `ParsedItem` → цена тем же `appraise_item`, что и у Price check.
//!
//! Оцениваем только то, у чего есть цена в «Экономике»: валюта, фрагменты, карты, камни, уникальные,
//! базы и т. д. Редкое и волшебное снаряжение не оцениваем (решение пользователя 21.11.2026) — оно
//! уходит в «не оцениваются», как и белые базы, у которых нет цены (обычный хлам).

use std::collections::HashMap;

use item_parser::{Blight, Influence, Language, ModKind, ParsedItem, ParsedMod, Rarity, Sockets};
use serde::Deserialize;
use serde_json::Value;

use crate::appraise::{appraise_item, PriceMatch};
use crate::dataset::model::{ItemKind, ItemRarity};
use crate::dataset::Catalog;
use crate::prices::Price;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawItem {
    name: String,
    type_line: String,
    base_type: Option<String>,
    frame_type: Option<u32>,
    identified: Option<bool>,
    ilvl: Option<u32>,
    stack_size: Option<u32>,
    corrupted: bool,
    synthesised: bool,
    influences: Option<HashMap<String, bool>>,
    shaper: bool,
    elder: bool,
    sockets: Vec<RawSocket>,
    properties: Vec<RawProperty>,
    enchant_mods: Vec<String>,
    implicit_mods: Vec<String>,
    explicit_mods: Vec<String>,
    mutated_mods: Vec<String>,
    socketed_items: Vec<Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawSocket {
    group: u32,
    #[serde(rename = "sColour")]
    colour: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawProperty {
    name: String,
    values: Vec<Value>,
}

/// Чем закончилась оценка одного предмета.
pub enum Valued {
    Priced { item_id: String, variant_key: String, name: String, quantity: u32, unit: f64, reliable: bool, exact: bool },
    /// Предмет из тех, что оцениваем, но цены нет (или нет в справочнике).
    NoPrice { item_id: Option<String>, name: String, quantity: u32, reason: String },
    /// Редкое/волшебное снаряжение, белый хлам, предметы заданий.
    Skipped,
}

/// Предмет и вставленные в него (камни, самоцветы абиссальных гнёзд): каждый оценивается отдельно.
pub fn value_all(catalog: &Catalog, prices: &dyn Fn(&str) -> Vec<Price>, raw: &Value, out: &mut Vec<Valued>) {
    let Ok(item) = serde_json::from_value::<RawItem>(raw.clone()) else { return };
    for socketed in &item.socketed_items {
        value_all(catalog, prices, socketed, out);
    }
    out.push(value_one(catalog, prices, &item));
}

fn value_one(catalog: &Catalog, prices: &dyn Fn(&str) -> Vec<Price>, raw: &RawItem) -> Valued {
    let quantity = raw.stack_size.unwrap_or(1).max(1);
    let type_line = strip_markup(&raw.type_line);
    let base = raw.base_type.as_deref().map(strip_markup).filter(|b| !b.is_empty()).unwrap_or_else(|| type_line.clone());
    let frame = raw.frame_type.unwrap_or(0);
    let map_tier = property_number(&raw.properties, "Map Tier");
    let is_map = map_tier.is_some() || base.ends_with(" Map");
    let mut rarity = match frame {
        0 => Rarity::Normal,
        1 => Rarity::Magic,
        2 => Rarity::Rare,
        3 | 9 | 10 => Rarity::Unique,
        4 => Rarity::Gem,
        5 | 8 => Rarity::Currency,
        6 => Rarity::DivinationCard,
        7 => Rarity::Quest,
        _ => Rarity::Normal,
    };
    if rarity == Rarity::Quest {
        return Valued::Skipped;
    }
    // Карты стоят по базе, какой бы ни была редкость (так их считают и источники).
    if is_map && matches!(rarity, Rarity::Magic | Rarity::Rare) {
        rarity = Rarity::Normal;
    }
    if matches!(rarity, Rarity::Magic | Rarity::Rare) {
        return Valued::Skipped;
    }
    let identified = raw.identified.unwrap_or(true);
    let unique_name = strip_markup(&raw.name);
    if rarity == Rarity::Unique && (!identified || unique_name.is_empty()) {
        return Valued::NoPrice { item_id: None, name: base, quantity, reason: "неопознанный уникальный".into() };
    }

    let (blight, base) = strip_blight(&base);
    let (name, foulborn) = match rarity {
        Rarity::Unique => match unique_name.strip_prefix("Foulborn ") {
            Some(rest) => (rest.to_string(), true),
            None => (unique_name.clone(), !raw.mutated_mods.is_empty()),
        },
        Rarity::Gem => (type_line.strip_prefix("Superior ").unwrap_or(&type_line).to_string(), false),
        _ => (base.clone(), false),
    };

    let mut influences: Vec<Influence> = Vec::new();
    if let Some(map) = &raw.influences {
        for (key, on) in map {
            if !*on {
                continue;
            }
            if let Some(i) = match key.as_str() {
                "shaper" => Some(Influence::Shaper),
                "elder" => Some(Influence::Elder),
                "crusader" => Some(Influence::Crusader),
                "redeemer" => Some(Influence::Redeemer),
                "hunter" => Some(Influence::Hunter),
                "warlord" => Some(Influence::Warlord),
                _ => None,
            } {
                influences.push(i);
            }
        }
    }
    if raw.shaper && !influences.contains(&Influence::Shaper) {
        influences.push(Influence::Shaper);
    }
    if raw.elder && !influences.contains(&Influence::Elder) {
        influences.push(Influence::Elder);
    }

    let mut mods: Vec<ParsedMod> = Vec::new();
    let mut push = |kind: ModKind, lines: &[String]| {
        for line in lines {
            mods.push(ParsedMod { kind, affix: None, name: None, tier: None, lines: vec![line.clone()] });
        }
    };
    push(ModKind::Enchant, &raw.enchant_mods);
    push(ModKind::Implicit, &raw.implicit_mods);
    push(ModKind::Explicit, &raw.explicit_mods);

    let parsed = ParsedItem {
        language: Language::En,
        item_class: String::new(),
        rarity,
        name: name.clone(),
        base_type: (rarity == Rarity::Unique).then(|| base.clone()),
        item_level: raw.ilvl.filter(|v| *v > 0),
        quality: property_number(&raw.properties, "Quality"),
        gem_level: if rarity == Rarity::Gem { property_number(&raw.properties, "Level") } else { None },
        stack_size: raw.stack_size,
        sockets: sockets(&raw.sockets),
        map_tier,
        blight,
        influences,
        corrupted: raw.corrupted,
        mirrored: false,
        split: false,
        unidentified: !identified,
        synthesised: raw.synthesised,
        foulborn,
        foil: matches!(frame, 9 | 10),
        mods,
        weapon: None,
    };

    // Chaos Orb — единица счёта, своей цены у источников нет.
    if rarity == Rarity::Currency
        && let Some(chaos) = catalog.by_trade_id("chaos")
        && catalog.find_by_name(&name).iter().any(|c| c.id == chaos.id)
    {
        return Valued::Priced { item_id: chaos.id.clone(), variant_key: String::new(), name, quantity, unit: 1.0, reliable: true, exact: true };
    }

    let appraisal = appraise_item(catalog, prices, parsed);
    let entry = appraisal.catalog_item.as_ref();
    match (entry, appraisal.price) {
        (Some(entry), Some(price)) => Valued::Priced {
            item_id: entry.id.clone(),
            variant_key: price.variant_key.clone(),
            name: entry.name.en.clone(),
            quantity,
            unit: price.chaos_value,
            reliable: price.reliable,
            exact: appraisal.price_match == Some(PriceMatch::Exact),
        },
        // Белое снаряжение без цены базы — обычный хлам, а не «не нашли цену».
        (Some(entry), None) if entry.rarity == ItemRarity::Normal && matches!(entry.kind, ItemKind::Equipment | ItemKind::Flask | ItemKind::Tincture | ItemKind::Jewel) => Valued::Skipped,
        (Some(entry), None) => Valued::NoPrice { item_id: Some(entry.id.clone()), name: entry.name.en.clone(), quantity, reason: "нет цены в лиге".into() },
        (None, _) => Valued::NoPrice { item_id: None, name: if rarity == Rarity::Unique { name } else { base }, quantity, reason: "нет в справочнике".into() },
    }
}

/// `<<set:MS>><<set:M>><<set:S>>Sorrow Rise` → `Sorrow Rise`.
fn strip_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<<") {
        out.push_str(&rest[..start]);
        match rest[start..].find(">>") {
            Some(end) => rest = &rest[start + end + 2..],
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

fn strip_blight(base: &str) -> (Option<Blight>, String) {
    if let Some(rest) = base.strip_prefix("Blight-ravaged ") {
        (Some(Blight::Ravaged), rest.to_string())
    } else if let Some(rest) = base.strip_prefix("Blighted ") {
        (Some(Blight::Blighted), rest.to_string())
    } else {
        (None, base.to_string())
    }
}

/// Первое число свойства: `Quality` `+20%` → 20, `Level` `20 (Max)` → 20.
fn property_number(properties: &[RawProperty], name: &str) -> Option<u32> {
    let prop = properties.iter().find(|p| p.name == name)?;
    let text = prop.values.first()?.get(0)?.as_str()?;
    let digits: String = text.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn sockets(raw: &[RawSocket]) -> Option<Sockets> {
    if raw.is_empty() {
        return None;
    }
    let mut groups: HashMap<u32, u8> = HashMap::new();
    let mut text = String::new();
    let mut previous: Option<u32> = None;
    for s in raw {
        *groups.entry(s.group).or_default() += 1;
        if let Some(p) = previous {
            text.push(if p == s.group { '-' } else { ' ' });
        }
        text.push_str(match s.colour.as_deref() {
            Some("S") => "R",
            Some("D") => "G",
            Some("I") => "B",
            Some("G") => "W",
            Some("A") => "A",
            _ => "W",
        });
        previous = Some(s.group);
    }
    Some(Sockets {
        white: text.chars().filter(|c| *c == 'W').count() as u8,
        text,
        count: raw.len() as u8,
        links: groups.values().copied().max().unwrap_or(0),
    })
}
