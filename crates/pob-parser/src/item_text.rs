//! Текст одного предмета PoB (содержимое `<Item>`) → [`PobItem`].
//!
//! Порт `parseItemText` из PoB Trade Finder (`vendor/pob.js`; MIT, © 2026 Jagomeiister, текст
//! лицензии — `LICENSE-PoB-Trade-Finder`) с правками по исходникам PoB (`Classes/Item.lua`, `ItemsTab.lua`):
//! - вид свойства — как раскладывает PoB: в первых `Implicits: N` строках `{crafted}` — зачарование;
//!   метки `{enchant}`, `{scourge}`, `{crucible}`, `{exarch}`/`{eater}`, `{mutated}`, `{custom}`;
//! - варианты уникальных: без `Selected Variant` выбран последний (как в PoB); дополнительные
//!   варианты — все пять (`Has Alt Variant`, `… Two` … `… Five`), а не только первый;
//! - `<ModRange id="N">` относится к N-й строке свойства (так их пишет PoB), а не к N-й строке с диапазоном;
//! - свойства для карточки (броня, качество, радиус, катализатор…), аффиксы крафтера, флаги
//!   Mirrored / Split / Fractured / Synthesised, эльдрические влияния.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::model::{
    PobAffix, PobAffixKind, PobEldritch, PobInfluence, PobItem, PobMod, PobModKind, PobRarity,
    PobSockets,
};

/// Начала служебных строк в тексте предмета — это не свойства. Список из `pob.js`.
const META_PREFIXES: &[&str] = &[
    "Rarity:",
    "Unique ID:",
    "Item Level:",
    "Quality:",
    "Sockets:",
    "LevelReq:",
    "Radius:",
    "Limited to:",
    "Variant:",
    "Selected Variant",
    "Has Alt Variant",
    "Alt Variant",
    "League:",
    "Crafted:",
    "Prefix:",
    "Suffix:",
    "Catalyst",
    "Armour:",
    "ArmourBase",
    "Evasion:",
    "EvasionBase",
    "Energy Shield:",
    "EnergyShieldBase",
    "Ward:",
    "WardBase",
    "Talisman Tier",
    "Source:",
    "Cluster Jewel",
    "Requires ",
    "Implicits:",
    "Upgrade:",
    "Mirrored",
    "Split",
    "Note:",
    "Influence1:",
    "Influence2:",
];

/// Служебные строки целиком: влияния и отметки предмета.
const FLAG_LINES: &[&str] = &[
    "Shaper Item",
    "Elder Item",
    "Crusader Item",
    "Redeemer Item",
    "Hunter Item",
    "Warlord Item",
    "Searing Exarch Item",
    "Eater of Worlds Item",
    "Synthesised Item",
    "Fractured Item",
    "Corrupted",
];

fn is_meta(line: &str) -> bool {
    META_PREFIXES.iter().any(|prefix| line.starts_with(prefix)) || FLAG_LINES.contains(&line)
}

/// Диапазон ролла в тексте: `(20-30)`, `(-10-5)`, `(1.2-1.8)`.
static RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)").expect("range regex"));
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\{([^}]*)\}").expect("tag regex"));
static INFLUENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(Shaper|Elder|Crusader|Redeemer|Hunter|Warlord|Searing Exarch|Eater of Worlds) Item$",
    )
    .expect("influence regex")
});
static ALT_VARIANT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(Has|Selected) Alt Variant(?: (Two|Three|Four|Five))?:\s*(.*)$")
        .expect("alt variant regex")
});

/// Число в начале значения: `20`, `+20%`, `86 (augmented)`.
pub(crate) fn leading_u32(value: &str) -> Option<u32> {
    let value = value.trim().trim_start_matches('+');
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Округление до сотых и печать числа, как в JavaScript (`Math.round(v * 100) / 100`, `String(v)`):
/// `15`, `1.5`, `-7.5`.
fn format_value(value: f64) -> String {
    let rounded = (value * 100.0 + 0.5).floor() / 100.0;
    if rounded == 0.0 {
        "0".to_string()
    } else {
        format!("{rounded}")
    }
}

/// Заменяет диапазоны `(a-b)` значением в положении `roll` (0 — минимум, 1 — максимум).
pub(crate) fn resolve_ranges(line: &str, roll: f64) -> String {
    RANGE
        .replace_all(line, |caps: &Captures| {
            let low: f64 = caps[1].parse().unwrap_or(0.0);
            let high: f64 = caps[2].parse().unwrap_or(0.0);
            format_value(low + roll * (high - low))
        })
        .into_owned()
}

/// Границы ролла: среднее нижних и среднее верхних чисел всех диапазонов строки.
fn roll_bounds(line: &str) -> Option<[f64; 2]> {
    let pairs: Vec<(f64, f64)> = RANGE
        .captures_iter(line)
        .map(|caps| {
            (
                caps[1].parse().unwrap_or(0.0),
                caps[2].parse().unwrap_or(0.0),
            )
        })
        .collect();
    if pairs.is_empty() {
        return None;
    }
    let count = pairs.len() as f64;
    Some([
        pairs.iter().map(|p| p.0).sum::<f64>() / count,
        pairs.iter().map(|p| p.1).sum::<f64>() / count,
    ])
}

/// Пометки в начале строки свойства: `{crafted}{range:0.5}{variant:1,2}…`.
#[derive(Default)]
struct LineTags {
    crafted: bool,
    fractured: bool,
    enchant: bool,
    scourge: bool,
    crucible: bool,
    implicit: bool,
    mutated: bool,
    custom: bool,
    eldritch: Option<PobEldritch>,
    range: Option<f64>,
    variants: Option<Vec<u32>>,
}

/// Снимает пометки `{…}` с начала строки. Незнакомые (`{tags:…}`, `{modGroup:…}`) отбрасываются.
fn take_tags(line: &str) -> (LineTags, &str) {
    let mut tags = LineTags::default();
    let mut rest = line;
    while let Some(caps) = TAG.captures(rest) {
        let tag = caps.get(1).map_or("", |m| m.as_str());
        let (key, value) = tag.split_once(':').unwrap_or((tag, ""));
        match key {
            "crafted" => tags.crafted = true,
            "fractured" => tags.fractured = true,
            "enchant" => tags.enchant = true,
            "scourge" => tags.scourge = true,
            "crucible" => tags.crucible = true,
            "implicit" => tags.implicit = true,
            "mutated" => tags.mutated = true,
            "custom" => tags.custom = true,
            "exarch" => tags.eldritch = Some(PobEldritch::SearingExarch),
            "eater" => tags.eldritch = Some(PobEldritch::EaterOfWorlds),
            "range" => tags.range = value.trim().parse().ok(),
            "variant" => {
                tags.variants = Some(
                    value
                        .split(',')
                        .filter_map(|v| v.trim().parse().ok())
                        .collect(),
                );
            }
            _ => {}
        }
        rest = &rest[caps[0].len()..];
    }
    (tags, rest.trim())
}

fn rarity(value: &str) -> PobRarity {
    match value.to_ascii_uppercase().as_str() {
        "NORMAL" => PobRarity::Normal,
        "MAGIC" => PobRarity::Magic,
        "UNIQUE" => PobRarity::Unique,
        "RELIC" => PobRarity::Relic,
        // как в pob.js: без строки редкости или с незнакомой — редкий
        _ => PobRarity::Rare,
    }
}

fn influence(name: &str) -> Option<PobInfluence> {
    Some(match name {
        "Shaper" => PobInfluence::Shaper,
        "Elder" => PobInfluence::Elder,
        "Crusader" => PobInfluence::Crusader,
        "Redeemer" => PobInfluence::Redeemer,
        "Hunter" => PobInfluence::Hunter,
        "Warlord" => PobInfluence::Warlord,
        "Searing Exarch" => PobInfluence::SearingExarch,
        "Eater of Worlds" => PobInfluence::EaterOfWorlds,
        _ => return None,
    })
}

fn sockets(text: &str) -> PobSockets {
    let mut count = 0u8;
    let mut links = 0u8;
    for group in text.split_whitespace() {
        let size = group.split('-').filter(|s| !s.is_empty()).count() as u8;
        count = count.saturating_add(size);
        links = links.max(size);
    }
    PobSockets {
        text: text.to_string(),
        count,
        links,
    }
}

/// `{range:0.056}IncreasedMana8` → аффикс; `None` — пустое место.
fn affix(kind: PobAffixKind, value: &str) -> Option<PobAffix> {
    let (tags, mod_id) = take_tags(value.trim());
    if mod_id.is_empty() || mod_id == "None" {
        return None;
    }
    Some(PobAffix {
        kind,
        mod_id: mod_id.to_string(),
        range: tags.range,
    })
}

/// Выбор вариантов уникального: основной и дополнительные (номера с 1).
struct VariantChoice {
    selected: Option<u32>,
    alts: Vec<u32>,
}

impl VariantChoice {
    /// Строку с `{variant:…}` показывает PoB, если в ней есть выбранный основной или дополнительный вариант.
    fn keeps(&self, variants: &[u32]) -> bool {
        match self.selected {
            None => true,
            Some(selected) => {
                variants.contains(&selected) || self.alts.iter().any(|alt| variants.contains(alt))
            }
        }
    }
}

/// Разбирает текст предмета. `mod_ranges` — `<ModRange id range>`: положение ролла N-й строки свойства.
/// `None` — в тексте нет ни одной строки.
pub(crate) fn parse_item_text(
    id: u32,
    text: &str,
    mod_ranges: &HashMap<u32, f64>,
) -> Option<PobItem> {
    let lines: Vec<&str> = text
        .split('\n')
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('<'))
        .collect();
    if lines.is_empty() {
        return None;
    }

    let mut item = PobItem {
        id,
        rarity: PobRarity::Rare,
        name: String::new(),
        base: String::new(),
        item_level: None,
        quality: None,
        level_req: None,
        sockets: None,
        influences: Vec::new(),
        corrupted: false,
        mirrored: false,
        split: false,
        fractured: false,
        synthesised: false,
        crafted: false,
        armour: None,
        evasion: None,
        energy_shield: None,
        ward: None,
        radius: None,
        limited_to: None,
        talisman_tier: None,
        catalyst: None,
        catalyst_quality: None,
        cluster_jewel_skill: None,
        cluster_jewel_node_count: None,
        league: None,
        variants: Vec::new(),
        selected_variant: None,
        selected_alt_variants: Vec::new(),
        affixes: Vec::new(),
        mods: Vec::new(),
        raw_text: lines.join("\n"),
    };

    let mut i = 0;
    if let Some(value) = lines[0].strip_prefix("Rarity:") {
        let word: String = value
            .trim()
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        item.rarity = rarity(&word);
        i = 1;
    }

    // Имя и база — до двух строк до первой служебной. У обычных и волшебных строка одна.
    let mut name_lines: Vec<String> = Vec::new();
    while i < lines.len() && !is_meta(lines[i]) && name_lines.len() < 2 {
        let (_, rest) = take_tags(lines[i]);
        name_lines.push(rest.to_string());
        i += 1;
    }
    match name_lines.as_slice() {
        [name, base] => (item.name, item.base) = (name.clone(), base.clone()),
        [name] => (item.name, item.base) = (name.clone(), name.clone()),
        _ => {}
    }
    let body_start = i;

    // Сначала — выбор вариантов: строки `Selected Variant` стоят и до, и после списка вариантов.
    let mut selected: Option<u32> = None;
    let mut has_alt = [false; 5];
    let mut selected_alt: [Option<u32>; 5] = [None; 5];
    for line in &lines {
        if let Some(value) = line.strip_prefix("Variant:") {
            // старый формат: `Variant: {3_0}Pre 3.0.0`
            let (_, name) = take_tags(value.trim());
            item.variants.push(name.to_string());
        } else if let Some(value) = line.strip_prefix("Selected Variant:") {
            selected = leading_u32(value);
        } else if let Some(caps) = ALT_VARIANT.captures(line) {
            let index = match caps.get(2).map(|m| m.as_str()) {
                None => 0,
                Some("Two") => 1,
                Some("Three") => 2,
                Some("Four") => 3,
                _ => 4,
            };
            if &caps[1] == "Has" {
                has_alt[index] = caps[3].trim().eq_ignore_ascii_case("true");
            } else {
                selected_alt[index] = leading_u32(&caps[3]);
            }
        }
    }
    let total = item.variants.len() as u32;
    let pick = |value: Option<u32>| {
        if total > 0 {
            Some(value.unwrap_or(total).min(total))
        } else {
            value
        }
    };
    let choice = VariantChoice {
        selected: pick(selected),
        alts: (0..5)
            .filter(|&k| has_alt[k])
            .filter_map(|k| pick(selected_alt[k]))
            .collect(),
    };
    item.selected_variant = choice.selected;
    item.selected_alt_variants = choice.alts.clone();

    let mut implicit_count: usize = 0;
    let mut past_implicits = false;
    let mut implicits_seen: usize = 0;
    // номер строки свойства (с 1) — ключ `<ModRange>`
    let mut mod_index: u32 = 0;

    for &line in &lines[body_start..] {
        if let Some(value) = line.strip_prefix("Sockets:") {
            let value = value.trim();
            if !value.is_empty() {
                item.sockets = Some(sockets(value));
            }
            continue;
        }
        match line {
            "Corrupted" => {
                item.corrupted = true;
                continue;
            }
            "Mirrored" => item.mirrored = true,
            "Split" => item.split = true,
            "Fractured Item" => item.fractured = true,
            "Synthesised Item" => item.synthesised = true,
            _ => {}
        }
        if let Some(caps) = INFLUENCE.captures(line) {
            if let Some(value) = influence(&caps[1])
                && !item.influences.contains(&value)
            {
                item.influences.push(value);
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("Implicits:") {
            implicit_count = leading_u32(value).unwrap_or(0) as usize;
            past_implicits = true;
            continue;
        }
        if read_property(&mut item, line) {
            continue;
        }
        if is_meta(line) || !past_implicits {
            continue;
        }

        let (tags, text) = take_tags(line);
        if text.is_empty() {
            continue;
        }
        mod_index += 1;
        let in_implicits = implicits_seen < implicit_count;
        let kind = if tags.enchant || (tags.crafted && in_implicits) {
            PobModKind::Enchant
        } else if tags.scourge {
            PobModKind::Scourge
        } else if tags.implicit || in_implicits {
            PobModKind::Implicit
        } else if tags.crucible {
            PobModKind::Crucible
        } else {
            PobModKind::Explicit
        };
        if in_implicits && kind != PobModKind::Explicit && kind != PobModKind::Crucible {
            implicits_seen += 1;
        }
        // строка другого варианта: PoB считает её и в implicit, и в номерах `<ModRange>`
        if let Some(variants) = &tags.variants
            && !choice.keeps(variants)
        {
            continue;
        }
        item.mods.push(mod_line(
            line,
            text,
            kind,
            &tags,
            mod_ranges.get(&mod_index).copied(),
        ));
    }

    // Запасной путь из pob.js: нет `Implicits: N` (сборка правлена руками) — все несвойственные
    // служебным строки считаются explicit, чтобы не потерять предмет целиком.
    if !past_implicits && item.mods.is_empty() {
        for &line in &lines[body_start..] {
            if is_meta(line) {
                continue;
            }
            let (tags, text) = take_tags(line);
            if text.is_empty() {
                continue;
            }
            item.mods
                .push(mod_line(line, text, PobModKind::Explicit, &tags, None));
        }
    }
    Some(item)
}

/// Свойства предмета для карточки. `true` — строка разобрана как свойство.
fn read_property(item: &mut PobItem, line: &str) -> bool {
    let Some((key, value)) = line.split_once(':') else {
        return false;
    };
    let value = value.trim();
    let text = || (!value.is_empty()).then(|| value.to_string());
    match key {
        "Item Level" => item.item_level = item.item_level.or(leading_u32(value)),
        "Quality" => item.quality = item.quality.or(leading_u32(value)),
        "LevelReq" => item.level_req = item.level_req.or(leading_u32(value)),
        "Armour" => item.armour = item.armour.or(leading_u32(value)),
        "Evasion" | "Evasion Rating" => item.evasion = item.evasion.or(leading_u32(value)),
        "Energy Shield" => item.energy_shield = item.energy_shield.or(leading_u32(value)),
        "Ward" => item.ward = item.ward.or(leading_u32(value)),
        "Radius" => item.radius = item.radius.take().or_else(text),
        "Limited to" => item.limited_to = item.limited_to.or(leading_u32(value)),
        "Talisman Tier" => item.talisman_tier = item.talisman_tier.or(leading_u32(value)),
        "Catalyst" => item.catalyst = item.catalyst.take().or_else(text),
        "CatalystQuality" => item.catalyst_quality = item.catalyst_quality.or(leading_u32(value)),
        "Cluster Jewel Skill" => {
            item.cluster_jewel_skill = item.cluster_jewel_skill.take().or_else(text)
        }
        "Cluster Jewel Node Count" => {
            item.cluster_jewel_node_count = item.cluster_jewel_node_count.or(leading_u32(value));
        }
        "League" => item.league = item.league.take().or_else(text),
        "Crafted" => item.crafted = value.eq_ignore_ascii_case("true"),
        "Prefix" => item.affixes.extend(affix(PobAffixKind::Prefix, value)),
        "Suffix" => item.affixes.extend(affix(PobAffixKind::Suffix, value)),
        _ => return false,
    }
    true
}

fn mod_line(
    raw: &str,
    text: &str,
    kind: PobModKind,
    tags: &LineTags,
    mod_range: Option<f64>,
) -> PobMod {
    let ranged = RANGE.is_match(text);
    let roll = ranged.then(|| tags.range.or(mod_range).unwrap_or(0.5));
    PobMod {
        line: match roll {
            Some(roll) => resolve_ranges(text, roll),
            None => text.to_string(),
        },
        raw: raw.to_string(),
        kind,
        crafted: tags.crafted || tags.enchant,
        fractured: tags.fractured,
        mutated: tags.mutated,
        eldritch: tags.eldritch,
        custom: tags.custom,
        ranged,
        bounds: if ranged { roll_bounds(text) } else { None },
        roll,
        variant: tags.variants.is_some(),
    }
}
