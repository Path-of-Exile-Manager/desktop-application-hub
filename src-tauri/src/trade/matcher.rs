//! Сопоставление строк модов предмета с фильтрами сайта торговли (план shared/docs/pob-trader.md, P3).
//!
//! Перенесено из `vendor/matcher.js` (`matchMod`) и `public/app.js` (`filterEntries`) PoB Trade
//! Finder, MIT, Copyright (c) 2026 Jagomeiister — текст лицензии: crates/pob-parser/LICENSE-PoB-Trade-Finder.
//! Отличия: русские тексты (Price check), свои разделы для зачарований, Scourge и Crucible.
//!
//! Ступени поиска стата строки, до первой удачной:
//! 1. точный текст с числами — notable кластеров, энчанты с числом в id;
//! 2. на оружии и броне — местный двойник `… (Local)`;
//! 3. шаблон (числа → `#`);
//! 4. допуски: единственное/множественное число после числа, `-#` → `+#`, «chance to block» →
//!    «chance to block attack damage», единственное число сокетов малого кластера;
//! 5. `increased` ↔ `reduced` с обратным знаком значений.
//!
//! Среди найденных статов берётся первый по порядку разделов, который зависит от вида мода.

use std::collections::HashMap;

use item_parser::Language;
use pob_parser::{PobItem, PobModKind};
use serde::Serialize;
use ts_rs::TS;

use super::stats::{exact_key, normalize, StatIndex};
use crate::dataset::model::TradeStat;

/// Псевдостат, в котором сайт складывает этот мод со всех мест предмета.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PseudoStat {
    pub stat_id: String,
    /// Двойное сопротивление идёт в сумму сопротивлений дважды.
    pub multiplier: f64,
}

/// Найденный стат строки мода.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatMatch {
    pub stat_id: String,
    pub section: String,
    /// Шаблон стата на сайте (английский).
    pub text: String,
    /// Числа строки; при `flipped` — с обратным знаком.
    pub values: Vec<f64>,
    /// Среднее чисел — значение для MIN/MAX («Adds 10 to 20» → 15).
    pub average: Option<f64>,
    /// Взят местный двойник `(Local)`.
    pub local: bool,
    /// Найден через `increased` ↔ `reduced`.
    pub flipped: bool,
    /// У стата нет числа (или оно в id): в запрос идёт без MIN/MAX.
    pub fixed_text: bool,
    pub pseudo: Option<PseudoStat>,
}

/// Строка мода для сопоставления.
pub struct ModQuery<'a> {
    pub line: &'a str,
    pub kind: PobModKind,
    pub crafted: bool,
    pub fractured: bool,
    pub language: Language,
}

/// Порядок разделов по виду мода: сначала «родной», потом соседние (PoB путает implicit и
/// зачарования, а часть крафтов на сайте — explicit).
fn section_order(query: &ModQuery) -> &'static [&'static str] {
    match query.kind {
        PobModKind::Enchant => &["enchant", "implicit", "crafted", "explicit"],
        PobModKind::Scourge => &["scourge", "implicit", "explicit"],
        PobModKind::Implicit => &["implicit", "explicit", "enchant"],
        PobModKind::Crucible => &["crucible", "explicit"],
        PobModKind::Explicit if query.crafted => &["crafted", "explicit", "implicit", "enchant"],
        PobModKind::Explicit if query.fractured => &["explicit", "fractured", "implicit", "enchant"],
        PobModKind::Explicit => &["explicit", "implicit", "enchant", "crafted", "veiled"],
    }
}

/// Слоты, где у стата бывает местный двойник: оружие, броня, щит.
fn prefers_local(slot: &str) -> bool {
    ["Weapon", "Helmet", "Body Armour", "Gloves", "Boots"].iter().any(|p| slot.starts_with(p)) || slot.contains("Shield")
}

fn pick<'a>(candidates: impl Iterator<Item = &'a TradeStat> + Clone, order: &[&str]) -> Option<&'a TradeStat> {
    order.iter().find_map(|section| candidates.clone().find(|s| s.section == *section))
}

/// Числа строки: `-12`, `1.5`.
pub fn numbers(line: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let negative = i > 0 && bytes[i - 1] == b'-';
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < bytes.len() && bytes[i] == b'.' && bytes[i + 1].is_ascii_digit() {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if let Ok(v) = line[start..i].parse::<f64>() {
                out.push(if negative { -v } else { v });
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Слово после каждого `# ` переписано функцией `f` (единственное ↔ множественное число).
fn map_counted_words(norm: &str, f: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(norm.len() + 4);
    let mut rest = norm;
    while let Some(at) = rest.find("# ") {
        out.push_str(&rest[..at + 2]);
        rest = &rest[at + 2..];
        let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_')).unwrap_or(rest.len());
        if end > 0 {
            out.push_str(&f(&rest[..end]));
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// «chance to block» без уточнения → «chance to block attack damage», как пишет сайт.
fn block_alias(text: &str) -> String {
    const PHRASE: &str = "chance to block";
    let mut out = String::with_capacity(text.len() + 16);
    let mut rest = text;
    while let Some(at) = rest.find(PHRASE) {
        out.push_str(&rest[..at + PHRASE.len()]);
        rest = &rest[at + PHRASE.len()..];
        if ![" attack", " spell", " projectile"].iter().any(|p| rest.starts_with(p)) {
            out.push_str(" attack damage");
        }
    }
    out.push_str(rest);
    out
}

const PSEUDO: [(&str, &str); 12] = [
    ("+#% to fire resistance", "pseudo.pseudo_total_fire_resistance"),
    ("+#% to cold resistance", "pseudo.pseudo_total_cold_resistance"),
    ("+#% to lightning resistance", "pseudo.pseudo_total_lightning_resistance"),
    ("+#% to chaos resistance", "pseudo.pseudo_total_chaos_resistance"),
    ("+#% to all elemental resistances", "pseudo.pseudo_total_all_elemental_resistances"),
    ("+# to maximum life", "pseudo.pseudo_total_life"),
    ("+# to maximum mana", "pseudo.pseudo_total_mana"),
    ("+# to maximum energy shield", "pseudo.pseudo_total_energy_shield"),
    ("+# to strength", "pseudo.pseudo_total_strength"),
    ("+# to dexterity", "pseudo.pseudo_total_dexterity"),
    ("+# to intelligence", "pseudo.pseudo_total_intelligence"),
    ("+# to all attributes", "pseudo.pseudo_total_all_attributes"),
];

/// Псевдостат мода (только английские шаблоны, как на странице).
fn pseudo(index: &StatIndex, norm: &str) -> Option<PseudoStat> {
    let found = |id: &str| index.by_id(id).next().is_some();
    if let Some((_, id)) = PSEUDO.iter().find(|(text, _)| *text == norm) {
        return found(id).then(|| PseudoStat { stat_id: (*id).to_string(), multiplier: 1.0 });
    }
    let dual = norm
        .strip_prefix("+#% to ")
        .and_then(|r| r.strip_suffix(" resistances"))
        .and_then(|r| r.split_once(" and "))
        .is_some_and(|(a, b)| ["fire", "cold", "lightning"].contains(&a) && ["fire", "cold", "lightning"].contains(&b));
    let id = "pseudo.pseudo_total_elemental_resistance";
    (dual && found(id)).then(|| PseudoStat { stat_id: id.to_string(), multiplier: 2.0 })
}

/// Стат строки мода на слоте `slot` (`Helmet`, `Weapon 1`…); `None` — фильтра нет.
pub fn match_mod(index: &StatIndex, query: &ModQuery, slot: &str) -> Option<StatMatch> {
    let language = query.language;
    let norm = normalize(query.line, language);
    let order = section_order(query);
    let lookup = |key: &str| pick(index.by_norm(language, key), order);
    let mut local = false;
    let mut flipped = false;

    let mut found = pick(index.by_exact(language, &exact_key(query.line, language)), order);
    let not_implicit = !matches!(query.kind, PobModKind::Implicit | PobModKind::Enchant);
    if found.is_none() && prefers_local(slot) && not_implicit {
        let suffix = match language {
            Language::En => " (local)",
            Language::Ru => " (на предмете)",
        };
        found = lookup(&format!("{norm}{suffix}"));
        local = found.is_some();
    }
    if found.is_none() {
        found = lookup(&norm);
    }
    if found.is_none() {
        let mut candidates = Vec::new();
        let singular = map_counted_words(&norm, |w| w.strip_suffix('s').unwrap_or(w).to_string());
        let plural = map_counted_words(&norm, |w| format!("{w}s"));
        let sign = norm.replace("-#", "+#");
        for c in [singular, plural, sign.clone()] {
            if c != norm {
                candidates.push(c);
            }
        }
        for base in [&norm, &sign] {
            let aliased = block_alias(base);
            if aliased != *base {
                candidates.push(aliased);
            }
        }
        if norm == "# added passive skill is a jewel socket" {
            candidates.push("# added passive skills are jewel sockets".into());
        }
        found = candidates.iter().find_map(|c| lookup(c));
    }
    if found.is_none() {
        let alt = if norm.contains("reduced") {
            Some(norm.replace("reduced", "increased"))
        } else if norm.contains("increased") {
            Some(norm.replace("increased", "reduced"))
        } else {
            None
        };
        found = alt.and_then(|alt| lookup(&alt));
        flipped = found.is_some();
    }
    let stat = found?;

    let mut values = numbers(query.line);
    if flipped {
        values.iter_mut().for_each(|v| *v = -*v);
    }
    let average = (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64);
    Some(StatMatch {
        stat_id: stat.id.clone(),
        section: stat.section.clone(),
        text: stat.text.en.clone(),
        values,
        average,
        local,
        flipped,
        fixed_text: !stat.text.en.contains('#') || stat.id.contains('|'),
        pseudo: if language == Language::En { pseudo(index, &norm) } else { None },
    })
}

/// Почему у строки нет фильтра.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ModUnavailable {
    /// На сайте нет такого фильтра.
    NoStat,
    /// Тот же фильтр уже у строки выше (`duplicate_of`): второй раз сайт его не примет.
    Duplicate,
}

/// Строка мода предмета и её фильтр.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModRow {
    /// Номер мода в `PobItem.mods`.
    pub index: usize,
    pub line: String,
    pub kind: PobModKind,
    pub crafted: bool,
    pub fractured: bool,
    pub matched: Option<StatMatch>,
    /// Fractured-двойник стата — для «Требовать Fractured».
    pub fractured_stat_id: Option<String>,
    /// У мода есть только fractured-фильтр (`matched` — он): искать можно лишь расколотый.
    pub fracture_only: bool,
    pub unavailable: Option<ModUnavailable>,
    /// Номер строки, которой уже принадлежит тот же фильтр.
    pub duplicate_of: Option<usize>,
}

/// Все моды предмета PoB со статами. Fractured-мод ищется обычным статом (`explicit.…`), а
/// fractured-двойник — отдельно; второй мод с тем же статом — дубль первого.
pub fn match_item(index: &StatIndex, item: &PobItem, slot: &str) -> Vec<ModRow> {
    // Колчан стоит в слоте второй руки, но его моды глобальные: местных двойников у него нет.
    let slot = if item.base.ends_with("Quiver") { "" } else { slot };
    let mut owner: HashMap<String, usize> = HashMap::new();
    item.mods
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let query = ModQuery { line: &m.line, kind: m.kind, crafted: m.crafted, fractured: m.fractured, language: Language::En };
            let mut matched = match_mod(index, &query, slot);
            let mut fracture_only = false;
            if m.fractured
                && let Some(found) = matched.as_mut()
                && let Some(rest) = found.stat_id.strip_prefix("fractured.")
            {
                match index.by_id(&format!("explicit.{rest}")).next() {
                    Some(normal) => {
                        found.stat_id = normal.id.clone();
                        found.section = normal.section.clone();
                    }
                    None => fracture_only = true,
                }
            }
            let fractured_stat_id = match (&matched, m.fractured) {
                (Some(found), true) => {
                    let rest = found.stat_id.split_once('.').map_or("", |(_, r)| r);
                    index
                        .by_id(&format!("fractured.{rest}"))
                        .next()
                        .or_else(|| {
                            let exact = exact_key(&m.line, Language::En);
                            let norm = normalize(&m.line, Language::En);
                            pick(index.by_exact(Language::En, &exact), &["fractured"]).or_else(|| pick(index.by_norm(Language::En, &norm), &["fractured"]))
                        })
                        .map(|s| s.id.clone())
                }
                _ => None,
            };
            let duplicate_of = matched.as_ref().and_then(|found| match owner.get(&found.stat_id) {
                Some(&first) => Some(first),
                None => {
                    owner.insert(found.stat_id.clone(), i);
                    None
                }
            });
            let unavailable = match (&matched, duplicate_of) {
                (None, _) => Some(ModUnavailable::NoStat),
                (Some(_), Some(_)) => Some(ModUnavailable::Duplicate),
                _ => None,
            };
            ModRow {
                index: i,
                line: m.line.clone(),
                kind: m.kind,
                crafted: m.crafted,
                fractured: m.fractured,
                matched,
                fractured_stat_id,
                fracture_only,
                unavailable,
                duplicate_of,
            }
        })
        .collect()
}
