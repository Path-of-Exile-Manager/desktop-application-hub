//! Префикс/суффикс и тир мода предмета по `item-mods.json` набора данных (план
//! shared/docs/pob-trader.md, M2). Строка мода сопоставляется с модами игры по шаблону текста
//! (числа и диапазоны → `#`), кандидаты — только моды, которые выпадают на базе (домен и первый
//! подходящий тег весов). Тир — место мода в своей семье (`type`) на этой базе по уровню.
//! Точно — когда id мода известен (крафтер PoB пишет `Prefix: IncreasedLife7`), иначе
//! «предположительно»: кандидат единственный по значению.

use std::collections::HashMap;

use item_parser::{Affix, Influence, Language};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dataset::model::{CatalogItem, ItemDetails, ItemKind};
use crate::trade::matcher::numbers;
use crate::trade::stats::normalize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemModsFile {
    pub mods: Vec<ItemModDef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemModDef {
    pub id: String,
    pub affix: Affix,
    pub domain: String,
    #[serde(rename = "type")]
    pub family: String,
    pub required_level: u32,
    pub text: ModText,
    pub spawn_weights: Vec<SpawnWeight>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModText {
    pub en: String,
    pub ru: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpawnWeight {
    pub tag: String,
    pub weight: u32,
}

/// Подпись мода.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModLabel {
    pub affix: Affix,
    /// 1 — лучший; нет — не удалось выбрать один мод семьи.
    pub tier: Option<u32>,
    /// По id мода (крафтер PoB); иначе — предположительно.
    pub exact: bool,
}

/// База, на которой стоит мод.
pub struct Base {
    domain: &'static str,
    tags: Vec<String>,
}

impl Base {
    /// База из справочника: оружие и броня — домен `item`, фласки — `flask`, самоцветы — `misc`,
    /// абиссальные — `abyss_jewel`. Камни, валюта и прочее — нет.
    pub fn of(item: &CatalogItem) -> Option<Self> {
        let (domain, tags) = match (&item.kind, &item.details) {
            (ItemKind::Equipment, ItemDetails::Equipment { tags, .. }) => ("item", tags),
            (ItemKind::Flask, ItemDetails::Flask { tags }) => ("flask", tags),
            (ItemKind::Jewel, ItemDetails::Jewel { tags }) if tags.iter().any(|t| t == "abyss_jewel") => ("abyss_jewel", tags),
            (ItemKind::Jewel, ItemDetails::Jewel { tags }) => ("misc", tags),
            _ => return None,
        };
        Some(Self { domain, tags: tags.clone() })
    }

    /// Влияния предмета: моды влияний выпадают по тегам `<тег базы>_<влияние>` (`helmet_shaper`).
    /// Лишние сочетания ничего не находят — у модов таких тегов нет.
    pub fn with_influences(mut self, influences: &[Influence]) -> Self {
        let extra: Vec<String> = influences.iter().flat_map(|i| self.tags.iter().map(move |t| format!("{t}_{}", influence_tag(*i)))).collect();
        self.tags.extend(extra);
        self
    }
}

/// Влияние в тегах игры: `helmet_eyrie` — Redeemer, `_basilisk` — Hunter, `_adjudicator` — Warlord.
fn influence_tag(influence: Influence) -> &'static str {
    match influence {
        Influence::Shaper => "shaper",
        Influence::Elder => "elder",
        Influence::Crusader => "crusader",
        Influence::Redeemer => "eyrie",
        Influence::Hunter => "basilisk",
        Influence::Warlord => "adjudicator",
    }
}

/// Часть текста мода: диапазон `(a-b)` или постоянное число.
#[derive(Debug, Clone, Copy)]
enum Slot {
    Range(f64, f64),
    Fixed(f64),
}

struct Line {
    template: String,
    slots: Vec<Slot>,
}

pub struct ItemModIndex {
    mods: Vec<ItemModDef>,
    /// Строки каждого мода: шаблон и числа.
    lines: Vec<Vec<Line>>,
    /// (язык, шаблон строки) → моды.
    by_template: HashMap<(bool, String), Vec<u32>>,
    /// (семья, префикс ли) → моды семьи.
    families: HashMap<(String, bool), Vec<u32>>,
}

impl ItemModIndex {
    pub fn new(file: ItemModsFile) -> Self {
        let mut by_template: HashMap<(bool, String), Vec<u32>> = HashMap::new();
        let mut lines = Vec::with_capacity(file.mods.len());
        let mut families: HashMap<(String, bool), Vec<u32>> = HashMap::new();
        for (i, m) in file.mods.iter().enumerate() {
            let i = i as u32;
            let en: Vec<Line> = m.text.en.split('\n').map(|l| parse_line(l, Language::En)).collect();
            for l in &en {
                by_template.entry((false, l.template.clone())).or_default().push(i);
            }
            if let Some(ru) = &m.text.ru {
                for l in ru.split('\n').map(|l| parse_line(l, Language::Ru)) {
                    by_template.entry((true, l.template)).or_default().push(i);
                }
            }
            lines.push(en);
            families.entry((m.family.clone(), m.affix == Affix::Prefix)).or_default().push(i);
        }
        Self { mods: file.mods, lines, by_template, families }
    }

    pub fn len(&self) -> usize {
        self.mods.len()
    }

    fn spawns_on(&self, i: u32, base: &Base) -> bool {
        let m = &self.mods[i as usize];
        m.domain == base.domain && m.spawn_weights.iter().find(|w| base.tags.contains(&w.tag)).is_some_and(|w| w.weight > 0)
    }

    /// Тир мода `i` в его семье на базе: 1 — с самым высоким уровнем.
    fn tier(&self, i: u32, base: &Base) -> Option<u32> {
        let m = &self.mods[i as usize];
        let mut family: Vec<u32> = self.families.get(&(m.family.clone(), m.affix == Affix::Prefix))?.iter().copied().filter(|&j| self.spawns_on(j, base)).collect();
        family.sort_by_key(|&j| std::cmp::Reverse(self.mods[j as usize].required_level));
        family.iter().position(|&j| j == i).map(|p| p as u32 + 1)
    }

    /// Подпись строки мода на базе. `known` — id модов предмета, если они известны (крафтер PoB).
    pub fn label(&self, line: &str, language: Language, base: &Base, known: &[String]) -> Option<ModLabel> {
        let template = parse_line(line, language).template;
        let candidates: Vec<u32> = self
            .by_template
            .get(&(language == Language::Ru, template))?
            .iter()
            .copied()
            .filter(|&i| self.spawns_on(i, base))
            .collect();
        if candidates.is_empty() {
            return None;
        }
        if let Some(&i) = candidates.iter().find(|&&i| known.iter().any(|k| *k == self.mods[i as usize].id)) {
            return Some(ModLabel { affix: self.mods[i as usize].affix, tier: self.tier(i, base), exact: true });
        }
        // По английскому тексту: числа строки должны лечь в диапазоны мода.
        let values = numbers(line);
        let fitting: Vec<u32> = candidates
            .iter()
            .copied()
            .filter(|&i| self.lines[i as usize].iter().any(|l| fits(&l.slots, &values)))
            .collect();
        let pool = if fitting.is_empty() { &candidates } else { &fitting };
        let affix = self.mods[pool[0] as usize].affix;
        if pool.iter().any(|&i| self.mods[i as usize].affix != affix) {
            return None;
        }
        let tier = match fitting.as_slice() {
            [one] => self.tier(*one, base),
            _ => None,
        };
        Some(ModLabel { affix, tier, exact: false })
    }

}

/// Числа строки предмета лежат в диапазонах мода, постоянные — совпадают (по модулю: знак у
/// игры то в тексте, то в числе).
fn fits(slots: &[Slot], values: &[f64]) -> bool {
    slots.len() == values.len()
        && slots.iter().zip(values).all(|(slot, v)| match *slot {
            Slot::Range(a, b) => {
                let (lo, hi) = if a.abs() <= b.abs() { (a.abs(), b.abs()) } else { (b.abs(), a.abs()) };
                (lo - 1e-6..=hi + 1e-6).contains(&v.abs())
            }
            Slot::Fixed(n) => (n.abs() - v.abs()).abs() < 1e-6,
        })
}

/// Шаблон строки мода игры (`+(100-114) to maximum Life` → `+# to maximum life`) и её числа.
fn parse_line(text: &str, language: Language) -> Line {
    let mut out = String::with_capacity(text.len());
    let mut slots = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('(') {
        let after = &rest[open + 1..];
        let range = after.find(')').and_then(|close| {
            let inner = &after[..close];
            // «-10--5»: минус у первого числа и разделитель.
            let split = inner.char_indices().skip(1).find(|&(_, c)| c == '-').map(|(i, _)| i)?;
            let (a, b) = (inner[..split].trim().parse::<f64>().ok()?, inner[split + 1..].trim().parse::<f64>().ok()?);
            Some((close, a, b))
        });
        match range {
            Some((close, a, b)) => {
                let before = &rest[..open];
                push_fixed(before, &mut out, &mut slots);
                out.push('#');
                slots.push(Slot::Range(a, b));
                rest = &after[close + 1..];
            }
            None => {
                push_fixed(&rest[..=open], &mut out, &mut slots);
                rest = after;
            }
        }
    }
    push_fixed(rest, &mut out, &mut slots);
    Line { template: normalize(&out, language), slots }
}

/// Текст без диапазонов: числа в нём — постоянные.
fn push_fixed(text: &str, out: &mut String, slots: &mut Vec<Slot>) {
    out.push_str(text);
    slots.extend(numbers(text).into_iter().map(Slot::Fixed));
}
