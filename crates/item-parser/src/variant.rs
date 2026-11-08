//! Ключ варианта цены — контракт с бэкендом (`nodejs-monolith/packages/domain/src/price-variant/`,
//! `shared/docs/prices-schema.md`): пары `name=value` через `;` в алфавитном порядке имён,
//! булевы — `1`/`0`, `''` — простой предмет. Разбор строгий: незнакомое, повтор или не тот
//! порядок — ошибка, поэтому у варианта ровно один ключ.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::item::{Blight, Influence, ParsedItem};
use crate::strings::{self, Language};
use crate::Rarity;

/// Вид записи справочника — те же значения, что `items.json` (`ItemKind` бэкенда).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum CatalogKind {
    Equipment,
    Flask,
    Tincture,
    Jewel,
    Gem,
    Currency,
    Fragment,
    Map,
    Card,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dimension {
    Blight,
    Corrupted,
    Enchant,
    Ilvl,
    Influence,
    Level,
    Links,
    Passives,
    Quality,
    Relic,
    Tier,
    Variant,
}

/// Какие измерения бывают у предмета этого вида и редкости (`allowedVariantDimensions`).
pub fn allowed_dimensions(kind: CatalogKind, unique: bool) -> &'static [Dimension] {
    use Dimension::*;
    match kind {
        CatalogKind::Equipment if unique => &[Links, Relic, Variant],
        CatalogKind::Equipment => &[Ilvl, Influence, Variant],
        CatalogKind::Jewel if unique => &[Relic, Variant],
        CatalogKind::Jewel => &[Enchant, Ilvl, Passives, Variant],
        CatalogKind::Flask | CatalogKind::Tincture if unique => &[Relic, Variant],
        CatalogKind::Flask | CatalogKind::Tincture => &[Variant],
        CatalogKind::Gem => &[Corrupted, Level, Quality],
        CatalogKind::Map => &[Blight, Tier, Variant],
        CatalogKind::Other => &[Variant],
        CatalogKind::Currency | CatalogKind::Fragment | CatalogKind::Card => &[],
    }
}

/// Вариант цены. `None` — измерения нет в варианте.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PriceVariant {
    pub blight: Option<Blight>,
    pub corrupted: Option<bool>,
    pub enchant: Option<String>,
    pub ilvl: Option<u32>,
    pub influence: Option<Influence>,
    pub level: Option<u32>,
    /// Только 5 или 6: 0–4 связи — не вариант.
    pub links: Option<u8>,
    pub passives: Option<u32>,
    pub quality: Option<u32>,
    pub relic: bool,
    pub tier: Option<u32>,
    /// Именованный вариант как у источника: `Foulborn`, `Shaper/Warlord`.
    pub variant: Option<String>,
}

const RANGES: [(&str, u32, u32); 5] = [("ilvl", 1, 100), ("level", 1, 30), ("passives", 1, 12), ("quality", 0, 23), ("tier", 1, 17)];

fn in_range(name: &str, value: u32) -> bool {
    RANGES.iter().find(|(n, ..)| *n == name).is_some_and(|(_, min, max)| (*min..=*max).contains(&value))
}

fn valid_text(text: &str) -> bool {
    let t = text.trim();
    !t.is_empty() && t == text && !t.contains(';') && !t.contains('=')
}

impl PriceVariant {
    /// Канонический ключ. Значения вне правил бэкенда (уровень 31, текст с `;`) в ключ не попадают.
    pub fn key(&self) -> String {
        let mut pairs: Vec<String> = Vec::new();
        let mut push = |name: &str, value: String| pairs.push(format!("{name}={value}"));
        if let Some(b) = self.blight {
            push("blight", b.as_str().into());
        }
        if let Some(c) = self.corrupted {
            push("corrupted", if c { "1" } else { "0" }.into());
        }
        if let Some(e) = self.enchant.as_deref().filter(|e| valid_text(e)) {
            push("enchant", e.into());
        }
        if let Some(v) = self.ilvl.filter(|v| in_range("ilvl", *v)) {
            push("ilvl", v.to_string());
        }
        if let Some(i) = self.influence {
            push("influence", i.as_str().into());
        }
        if let Some(v) = self.level.filter(|v| in_range("level", *v)) {
            push("level", v.to_string());
        }
        if let Some(l) = self.links.filter(|l| *l == 5 || *l == 6) {
            push("links", l.to_string());
        }
        if let Some(v) = self.passives.filter(|v| in_range("passives", *v)) {
            push("passives", v.to_string());
        }
        if let Some(v) = self.quality.filter(|v| in_range("quality", *v)) {
            push("quality", v.to_string());
        }
        if self.relic {
            push("relic", "1".into());
        }
        if let Some(v) = self.tier.filter(|v| in_range("tier", *v)) {
            push("tier", v.to_string());
        }
        if let Some(v) = self.variant.as_deref().filter(|v| valid_text(v)) {
            push("variant", v.into());
        }
        pairs.join(";")
    }

    /// Строгий разбор ключа с сервера (как `PriceVariant.parse`).
    pub fn parse(key: &str) -> Result<Self, String> {
        let mut v = Self::default();
        if key.is_empty() {
            return Ok(v);
        }
        for pair in key.split(';') {
            let (name, raw) = pair.split_once('=').unwrap_or((pair, ""));
            let int = || raw.parse::<u32>().ok().filter(|_| raw.bytes().all(|b| b.is_ascii_digit())).ok_or_else(|| format!("invalid value of {name}"));
            let dup = |present: bool| if present { Err(format!("repeated dimension: {name}")) } else { Ok(()) };
            match name {
                "blight" => {
                    dup(v.blight.is_some())?;
                    v.blight = Some(match raw {
                        "BLIGHTED" => Blight::Blighted,
                        "RAVAGED" => Blight::Ravaged,
                        _ => return Err("invalid value of blight".into()),
                    });
                }
                "corrupted" => {
                    dup(v.corrupted.is_some())?;
                    v.corrupted = Some(match raw {
                        "1" => true,
                        "0" => false,
                        _ => return Err("invalid value of corrupted".into()),
                    });
                }
                "enchant" => {
                    dup(v.enchant.is_some())?;
                    v.enchant = Some(raw.to_string());
                }
                "ilvl" => {
                    dup(v.ilvl.is_some())?;
                    v.ilvl = Some(int()?);
                }
                "influence" => {
                    dup(v.influence.is_some())?;
                    v.influence = Some(
                        [Influence::Shaper, Influence::Elder, Influence::Crusader, Influence::Redeemer, Influence::Hunter, Influence::Warlord]
                            .into_iter()
                            .find(|i| i.as_str() == raw)
                            .ok_or("invalid value of influence")?,
                    );
                }
                "level" => {
                    dup(v.level.is_some())?;
                    v.level = Some(int()?);
                }
                "links" => {
                    dup(v.links.is_some())?;
                    v.links = Some(int()? as u8);
                }
                "passives" => {
                    dup(v.passives.is_some())?;
                    v.passives = Some(int()?);
                }
                "quality" => {
                    dup(v.quality.is_some())?;
                    v.quality = Some(int()?);
                }
                "relic" => {
                    dup(v.relic)?;
                    if raw != "1" {
                        return Err("invalid value of relic".into());
                    }
                    v.relic = true;
                }
                "tier" => {
                    dup(v.tier.is_some())?;
                    v.tier = Some(int()?);
                }
                "variant" => {
                    dup(v.variant.is_some())?;
                    v.variant = Some(raw.to_string());
                }
                other => return Err(format!("unknown dimension: {other}")),
            }
        }
        let canonical = v.key();
        if canonical != key {
            return Err(format!("not canonical, expected \"{canonical}\""));
        }
        Ok(v)
    }

    /// Оставляет только измерения, допустимые для предмета этого вида.
    pub fn restrict(mut self, allowed: &[Dimension]) -> Self {
        use Dimension::*;
        let has = |d: Dimension| allowed.contains(&d);
        if !has(Blight) {
            self.blight = None;
        }
        if !has(Corrupted) {
            self.corrupted = None;
        }
        if !has(Enchant) {
            self.enchant = None;
        }
        if !has(Ilvl) {
            self.ilvl = None;
        }
        if !has(Influence) {
            self.influence = None;
        }
        if !has(Level) {
            self.level = None;
        }
        if !has(Links) {
            self.links = None;
        }
        if !has(Passives) {
            self.passives = None;
        }
        if !has(Quality) {
            self.quality = None;
        }
        if !has(Relic) {
            self.relic = false;
        }
        if !has(Tier) {
            self.tier = None;
        }
        if !has(Variant) {
            self.variant = None;
        }
        self
    }
}

/// Порядок влияний в именованном варианте источников: `Shaper/Warlord`.
const INFLUENCE_ORDER: [Influence; 6] = [Influence::Shaper, Influence::Elder, Influence::Crusader, Influence::Redeemer, Influence::Warlord, Influence::Hunter];

/// Кластерный самоцвет: число пассивных умений и текст энчанта (английский — как у источников).
pub fn cluster_enchant(item: &ParsedItem) -> (Option<u32>, Option<String>) {
    let mut passives = None;
    let mut grant = None;
    let prefix = strings::strings(item.language).cluster_grant;
    for line in item.enchants() {
        if let Some(text) = prefix.and_then(|p| line.strip_prefix(p)) {
            grant.get_or_insert_with(|| text.trim().to_string());
        } else if passives.is_none() && !line.contains(':') && !line.contains('%') {
            // «Adds 8 Passive Skills» — первая строка энчанта кластера с числом.
            passives = line.split(|c: char| !c.is_ascii_digit()).find(|t| !t.is_empty()).and_then(|t| t.parse().ok());
        }
    }
    (passives, grant)
}

/// Вариант, который описывает предмет: всё, что источники пишут в ключ, до ограничения по виду.
/// Повторяет то, что пишут парсеры источников: качество 0 и `corrupted=0` не пишутся,
/// два влияния — именованный вариант в фиксированном порядке.
pub fn variant_of(item: &ParsedItem, kind: CatalogKind) -> PriceVariant {
    let unique = item.rarity == Rarity::Unique;
    let mut v = PriceVariant {
        corrupted: item.corrupted.then_some(true),
        level: item.gem_level,
        quality: item.quality.filter(|q| *q > 0),
        relic: item.foil,
        ..PriceVariant::default()
    };
    if kind == CatalogKind::Gem {
        return v.restrict(allowed_dimensions(kind, unique));
    }
    if let Some(sockets) = &item.sockets {
        v.links = (sockets.links >= 5).then_some(sockets.links);
    }
    if kind == CatalogKind::Map {
        v.blight = item.blight;
        // Источники пишут тир только уникальным картам.
        if unique {
            v.tier = item.map_tier;
        }
    }
    if !unique {
        v.ilvl = item.item_level;
        let mut influences = item.influences.clone();
        influences.sort_by_key(|i| INFLUENCE_ORDER.iter().position(|o| o == i));
        influences.dedup();
        match influences.as_slice() {
            [one] => v.influence = Some(*one),
            [_, _] => v.variant = Some(influences.iter().map(|i| i.title()).collect::<Vec<_>>().join("/")),
            _ => {}
        }
        if kind == CatalogKind::Jewel {
            let (passives, enchant) = cluster_enchant(item);
            v.passives = passives;
            v.enchant = enchant;
        }
    }
    if unique && item.foulborn {
        v.variant = Some("Foulborn".into());
    }
    // Качество, уровень и осквернение в ключ не-камней не входят — их снимет `restrict`.
    v.restrict(allowed_dimensions(kind, unique))
}

/// Язык не влияет на ключ, но английский энчант кластера есть только в английском клиенте.
pub fn cluster_enchant_supported(language: Language) -> bool {
    strings::strings(language).cluster_grant.is_some()
}
