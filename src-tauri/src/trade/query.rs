//! Спецификация поиска на сайте торговли и запрос по ней (план shared/docs/pob-trader.md, P4,
//! решение 3.7). Ядро даёт строке спецификацию с умолчаниями; интерфейс правит свою копию (P8) и
//! получает по ней запрос командой `trade_query`. Одна модель — для PoB и потом для Price check.

use pob_parser::{PobItem, PobModKind, PobRarity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use ts_rs::TS;

use super::matcher::{ModRow, ModUnavailable, PseudoStat};

/// Допуск по умолчанию: MIN = значение − 10 % (как в Awakened PoE Trade).
pub const DEFAULT_TOLERANCE: f64 = 0.1;

/// Осквернение в поиске.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Corrupted {
    Any,
    Yes,
    No,
}

/// Мод в поиске: стат, значения и правки пользователя.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpecMod {
    /// Номер мода в предмете.
    pub index: usize,
    pub line: String,
    pub kind: PobModKind,
    /// Фильтр сайта; нет — мод не найти (`unavailable`).
    pub stat_id: Option<String>,
    /// Fractured-двойник — для «Требовать Fractured».
    pub fractured_stat_id: Option<String>,
    /// Вариант стата с выбором.
    pub option: Option<u32>,
    /// Значение мода (среднее чисел строки).
    pub value: Option<f64>,
    /// Фильтр без MIN/MAX.
    pub fixed_text: bool,
    pub pseudo: Option<PseudoStat>,
    pub enabled: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub use_fractured: bool,
    pub unavailable: Option<ModUnavailable>,
    pub duplicate_of: Option<usize>,
}

/// Что искать на сайте торговли.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TradeSearchSpec {
    /// Имя уникального.
    pub name: Option<String>,
    /// База или камень (`type` на сайте).
    pub type_line: Option<String>,
    /// Трансфигурированный камень: `alt_x`.
    pub discriminator: Option<String>,
    /// Фильтр редкости: `normal` — белая база, `nonunique` — не уникальный.
    pub rarity: Option<String>,
    pub mods: Vec<SpecMod>,
    /// Сопротивления, жизнь, атрибуты — одним псевдостатом-суммой вместо отдельных модов.
    pub use_pseudo: bool,
    pub sockets: Option<u8>,
    pub links: Option<u8>,
    pub corrupted: Corrupted,
    pub item_level: Option<u32>,
    /// Фильтры влияний: `shaper_item`, `elder_item`…
    pub influences: Vec<String>,
    pub gem_level: Option<u32>,
    pub quality: Option<u32>,
}

impl TradeSearchSpec {
    fn empty() -> Self {
        Self {
            name: None,
            type_line: None,
            discriminator: None,
            rarity: None,
            mods: Vec::new(),
            use_pseudo: false,
            sockets: None,
            links: None,
            corrupted: Corrupted::Any,
            item_level: None,
            influences: Vec::new(),
            gem_level: None,
            quality: None,
        }
    }

    /// Камень: тип (у трансфигурированного — базовый камень и дискриминатор), уровень и качество
    /// не ниже, осквернение как у камня.
    pub fn gem(type_line: String, discriminator: Option<String>, level: u32, quality: u32, corrupted: bool) -> Self {
        Self {
            type_line: Some(type_line),
            discriminator,
            gem_level: (level > 1).then_some(level),
            quality: (quality > 0).then_some(quality),
            corrupted: if corrupted { Corrupted::Yes } else { Corrupted::No },
            ..Self::empty()
        }
    }

    /// Предмет PoB с сопоставленными модами. `name` — имя уникального по справочнику, `base` —
    /// база по справочнику. Умолчания: уникальный — моды выключены, кроме строк выбранного
    /// варианта; остальные — все найденные моды с MIN = значение − допуск; связи от 5; осквернение
    /// «да» у осквернённого; у не уникальных — уровень предмета и влияния.
    pub fn item(item: &PobItem, name: Option<String>, base: String, mods: &[ModRow], tolerance: f64) -> Self {
        let unique = matches!(item.rarity, PobRarity::Unique | PobRarity::Relic);
        let mods = mods
            .iter()
            .map(|row| {
                let matched = row.matched.as_ref();
                let wanted = row.unavailable.is_none() && (!unique || item.mods.get(row.index).is_some_and(|m| distinguishes_variant(&m.raw, item.variants.len())));
                let value = matched.and_then(|m| m.average);
                let fixed_text = matched.is_some_and(|m| m.fixed_text);
                let (min, max) = if fixed_text { (None, None) } else { default_bounds(value, tolerance) };
                SpecMod {
                    index: row.index,
                    line: row.line.clone(),
                    kind: row.kind,
                    stat_id: matched.map(|m| m.stat_id.clone()),
                    fractured_stat_id: row.fractured_stat_id.clone(),
                    option: matched.and_then(|m| m.option),
                    value,
                    fixed_text,
                    pseudo: matched.and_then(|m| m.pseudo.clone()),
                    enabled: wanted,
                    min,
                    max,
                    use_fractured: row.fracture_only,
                    unavailable: row.unavailable,
                    duplicate_of: row.duplicate_of,
                }
            })
            .collect();
        Self {
            name: if unique { name } else { None },
            type_line: Some(base),
            rarity: match item.rarity {
                PobRarity::Normal => Some("normal".into()),
                PobRarity::Magic | PobRarity::Rare => Some("nonunique".into()),
                PobRarity::Unique | PobRarity::Relic => None,
            },
            mods,
            links: item.sockets.as_ref().map(|s| s.links).filter(|l| *l >= 5),
            corrupted: if item.corrupted { Corrupted::Yes } else { Corrupted::Any },
            item_level: (!unique).then_some(item.item_level).flatten().filter(|l| *l > 1),
            influences: if unique { Vec::new() } else { item.influences.iter().filter_map(|i| influence_filter(*i)).map(String::from).collect() },
            ..Self::empty()
        }
    }

    /// Модов в поиске и недоступных — для строки «N модов в поиске · M недоступно».
    pub fn counts(&self) -> (u32, u32) {
        let searched = self.mods.iter().filter(|m| m.enabled && m.stat_id.is_some()).count() as u32;
        let unavailable = self.mods.iter().filter(|m| m.unavailable.is_some()).count() as u32;
        (searched, unavailable)
    }
}

/// Строка уникального отличает выбранный вариант: помечена `{variant:…}` не всеми вариантами.
fn distinguishes_variant(raw: &str, variants: usize) -> bool {
    if variants < 2 {
        return false;
    }
    let Some(list) = raw.split_once("{variant:").and_then(|(_, rest)| rest.split_once('}')).map(|(list, _)| list) else { return false };
    list.split(',').filter(|n| !n.trim().is_empty()).count() < variants
}

fn influence_filter(influence: pob_parser::PobInfluence) -> Option<&'static str> {
    use pob_parser::PobInfluence::*;
    match influence {
        Shaper => Some("shaper_item"),
        Elder => Some("elder_item"),
        Crusader => Some("crusader_item"),
        Redeemer => Some("redeemer_item"),
        Hunter => Some("hunter_item"),
        Warlord => Some("warlord_item"),
        SearingExarch | EaterOfWorlds => None,
    }
}

/// MIN/MAX по значению: положительное — MIN = значение − допуск; отрицательное (сумма «reduced»
/// и т. п.) — MAX = значение + допуск к нулю. Целые — округление в мягкую сторону, дробные — до 0,1;
/// целые меньше 10 (`+1 to Level of …`, `+2 Charges`) — без допуска: иначе MIN станет 0 или 1.
pub fn default_bounds(value: Option<f64>, tolerance: f64) -> (Option<f64>, Option<f64>) {
    let Some(v) = value else { return (None, None) };
    if v.fract() == 0.0 && v.abs() < 10.0 {
        return if v >= 0.0 { (Some(v), None) } else { (None, Some(v)) };
    }
    let scaled = v * (1.0 - tolerance);
    let step = if v.fract() == 0.0 { 1.0 } else { 0.1 };
    if v >= 0.0 {
        (Some(round_to((scaled / step).floor() * step)), None)
    } else {
        (None, Some(round_to((scaled / step).ceil() * step)))
    }
}

fn round_to(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Запрос сайта торговли: тело поиска и ссылка `trade/search/<лига>?q=`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TradeQuery {
    pub payload: Value,
    pub url: Option<String>,
}

/// Тело поиска по спецификации. Ошибка — словами: нет типа, MIN больше MAX.
pub fn build_query(spec: &TradeSearchSpec) -> Result<Value, String> {
    if spec.name.is_none() && spec.type_line.is_none() {
        return Err("не известен тип предмета".into());
    }
    let mut query = Map::new();
    query.insert("status".into(), json!({ "option": "online" }));
    if let Some(name) = &spec.name {
        query.insert("name".into(), json!(name));
    }
    if let Some(ty) = &spec.type_line {
        query.insert(
            "type".into(),
            match &spec.discriminator {
                Some(disc) => json!({ "option": ty, "discriminator": disc }),
                None => json!(ty),
            },
        );
    }

    let mut stats = Vec::new();
    let mut pseudo: Vec<(String, f64)> = Vec::new();
    for m in spec.mods.iter().filter(|m| m.enabled) {
        let Some(stat_id) = &m.stat_id else { continue };
        if let (Some(min), Some(max)) = (m.min, m.max)
            && min > max
        {
            return Err(format!("у «{}» MIN больше MAX", m.line));
        }
        if spec.use_pseudo
            && let Some(p) = &m.pseudo
        {
            let add = m.value.unwrap_or(0.0) * p.multiplier;
            match pseudo.iter_mut().find(|(id, ..)| *id == p.stat_id) {
                Some(entry) => entry.1 += add,
                None => pseudo.push((p.stat_id.clone(), add)),
            }
            continue;
        }
        let id = if m.use_fractured { m.fractured_stat_id.as_ref().unwrap_or(stat_id) } else { stat_id };
        // `enchant.stat_3948993189|15`: id фильтра и номер варианта в нём.
        let (id, option) = match (id.split_once('|'), m.option) {
            (Some((id, option)), _) => (id.to_string(), option.parse::<u32>().ok()),
            (None, option) => (id.clone(), option),
        };
        let mut filter = Map::new();
        filter.insert("id".into(), json!(id));
        if let Some(option) = option {
            filter.insert("value".into(), json!({ "option": option }));
        } else if !m.fixed_text {
            let mut value = Map::new();
            if let Some(min) = m.min {
                value.insert("min".into(), json!(min));
            }
            if let Some(max) = m.max {
                value.insert("max".into(), json!(max));
            }
            if !value.is_empty() {
                filter.insert("value".into(), Value::Object(value));
            }
        }
        stats.push(Value::Object(filter));
    }
    for (id, sum) in pseudo {
        let (min, _) = default_bounds(Some(sum.floor()), DEFAULT_TOLERANCE);
        stats.push(json!({ "id": id, "value": { "min": min } }));
    }
    query.insert("stats".into(), json!([{ "type": "and", "filters": stats }]));

    let mut filters = Map::new();
    let mut misc = Map::new();
    if let Some(level) = spec.item_level {
        misc.insert("ilvl".into(), json!({ "min": level }));
    }
    for influence in &spec.influences {
        misc.insert(influence.clone(), json!({ "option": "true" }));
    }
    if let Some(level) = spec.gem_level {
        misc.insert("gem_level".into(), json!({ "min": level }));
    }
    if let Some(quality) = spec.quality {
        misc.insert("quality".into(), json!({ "min": quality }));
    }
    match spec.corrupted {
        Corrupted::Any => {}
        Corrupted::Yes => {
            misc.insert("corrupted".into(), json!({ "option": "true" }));
        }
        Corrupted::No => {
            misc.insert("corrupted".into(), json!({ "option": "false" }));
        }
    }
    if !misc.is_empty() {
        filters.insert("misc_filters".into(), json!({ "filters": misc }));
    }
    let mut sockets = Map::new();
    if let Some(n) = spec.sockets {
        sockets.insert("sockets".into(), json!({ "min": n }));
    }
    if let Some(n) = spec.links {
        sockets.insert("links".into(), json!({ "min": n }));
    }
    if !sockets.is_empty() {
        filters.insert("socket_filters".into(), json!({ "filters": sockets }));
    }
    if let Some(rarity) = &spec.rarity {
        filters.insert("type_filters".into(), json!({ "filters": { "rarity": { "option": rarity } } }));
    }
    if !filters.is_empty() {
        query.insert("filters".into(), Value::Object(filters));
    }
    Ok(json!({ "query": query, "sort": { "price": "asc" } }))
}

/// Ссылка на поиск: `https://www.pathofexile.com/trade/search/<лига>?q=<тело>`.
pub fn search_url(league: &str, payload: &Value) -> String {
    format!("https://www.pathofexile.com/trade/search/{}?q={}", encode(league), encode(&payload.to_string()))
}

fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Запрос по спецификации — для правок в интерфейсе. `league` — для ссылки; нет — только тело.
#[tauri::command]
pub fn trade_query(spec: TradeSearchSpec, league: Option<String>) -> Result<TradeQuery, String> {
    let payload = build_query(&spec)?;
    let url = league.map(|l| search_url(&l, &payload));
    Ok(TradeQuery { payload, url })
}
