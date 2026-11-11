//! Форматы набора данных — как их публикует воркер (`dataset-build`) и отдаёт api-hub:
//! манифест (`GET /v1/bootstrap`), `items.json`, `classes.json`, `map-search.json`.
//! Значения перечислений — контракт хранения бэкенда (UPPER_SNAKE). Незнакомое значение
//! не роняет разбор всего файла: становится `Unknown` / `Other`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Формат манифеста, который понимает это приложение. Другой — набор не берём, просим обновиться.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Manifest {
    pub schema_version: u32,
    /// `YYYYMMDD.N` (день UTC и номер за день).
    pub dataset_id: String,
    pub generated_at: String,
    pub files: Vec<ManifestFile>,
    pub icons: ManifestIcons,
    #[serde(default)]
    pub counts: ManifestCounts,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ManifestFile {
    /// `items.json`, `classes.json`.
    pub name: String,
    pub sha256: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ManifestIcons {
    /// С завершающим «/»: иконка — `<baseUrl><iconSha256>.<extension>`.
    pub base_url: String,
    pub extension: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ManifestCounts {
    pub classes: u32,
    pub items: u32,
    pub uniques: u32,
    pub with_icon: u32,
    pub without_russian_name: u32,
    /// Из `map-search.json`; 0 — файла нет или он не прочитан.
    pub map_mods: u32,
    pub map_properties: u32,
    /// Из `trade-stats.json`; 0 — файла нет.
    pub trade_stats: u32,
}

/// Ответ `GET /v1/bootstrap`.
#[derive(Debug, Deserialize)]
pub struct Bootstrap {
    pub dataset: Manifest,
}

/// Название на языках игры. Английское есть всегда.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct LocalizedName {
    pub en: String,
    pub ru: Option<String>,
}

/// Запись справочника: что за предмет, без лиги и цены.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogItem {
    /// `base:<metadata path>`, `base:<gem path>:alt_x`, `unique:<имя>:<путь базы>`.
    pub id: String,
    pub kind: ItemKind,
    pub rarity: ItemRarity,
    /// Класс предмета: `Body Armour`, `StackableCurrency`…
    pub class_id: String,
    /// База уникального; у остальных `null`.
    pub base_id: Option<String>,
    pub name: LocalizedName,
    pub size: ItemSize,
    pub icon_sha256: Option<String>,
    pub release_state: ReleaseState,
    pub details: ItemDetails,
    /// Есть ровно у уникальных.
    pub unique: Option<UniqueDetails>,
    /// Id на сайте торговли (`chaos`, `divine`…), если есть.
    pub trade_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ItemKind {
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
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ItemRarity {
    Normal,
    Unique,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ReleaseState {
    Released,
    /// Больше не выпадает, но торгуется.
    Legacy,
    Unreleased,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum GemColor {
    Red,
    Green,
    Blue,
    White,
    #[serde(other)]
    Unknown,
}

/// Клетки инвентаря.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ItemSize {
    pub w: u8,
    pub h: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Requirements {
    pub level: Option<u32>,
    pub str: Option<u32>,
    pub dex: Option<u32>,
    pub int: Option<u32>,
}

/// Подробности по виду предмета; `kind` совпадает с `CatalogItem::kind`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ItemDetails {
    Equipment {
        #[serde(default)]
        tags: Vec<String>,
        requirements: Option<Requirements>,
    },
    Flask {
        #[serde(default)]
        tags: Vec<String>,
    },
    Tincture {
        #[serde(default)]
        tags: Vec<String>,
    },
    Jewel {
        #[serde(default)]
        tags: Vec<String>,
    },
    Gem {
        #[serde(rename = "isSupport")]
        is_support: bool,
        color: GemColor,
        #[serde(rename = "maxLevel")]
        max_level: u32,
        #[serde(default)]
        tags: Vec<String>,
    },
    Currency {
        #[serde(rename = "stackSize")]
        stack_size: u32,
        description: Option<String>,
    },
    Fragment {
        #[serde(rename = "stackSize")]
        stack_size: Option<u32>,
    },
    Map {
        tier: Option<u32>,
    },
    Card {
        #[serde(rename = "stackSize")]
        stack_size: u32,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UniqueDetails {
    pub is_replica: bool,
    /// Варианты по PoB: `['Pre 3.20.0', 'Current']`; пусто, если их нет.
    #[serde(default)]
    pub variants: Vec<String>,
}

/// Запись `classes.json`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ItemClass {
    /// Ключ RePoE: `Body Armour`, `StackableCurrency`.
    pub id: String,
    pub name: LocalizedName,
    /// Группа: `Flask`, `Currency`, `Skill Gem`…
    pub category: String,
}

/// `map-search.json`: моды карт и свойства карты со строками поиска сундука — данные вкладки
/// «RegEx карт». В наборе есть не всегда (наборы до `20261108.1`).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct MapSearch {
    /// Семейства модов карт (тиры одного эффекта), по `id`.
    pub mods: Vec<MapSearchMod>,
    pub properties: Vec<MapProperty>,
}

/// Строки текста на языках игры: мод из нескольких строк, строка свойства.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct LocalizedLines {
    pub en: Vec<String>,
    pub ru: Option<Vec<String>>,
}

/// Короткая строка для поиска сундука на одном языке.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct SearchToken {
    /// Фрагмент регулярки: `m resistances$`. `null` — уникального нет, ищут строку целиком.
    pub token: Option<String>,
    /// Ключи других записей, которые токен тоже находит (обычный ↔ nightmare). Пусто — точный.
    #[serde(default)]
    pub overlaps: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct LocalizedSearchToken {
    pub en: SearchToken,
    pub ru: Option<SearchToken>,
}

/// Семейство мода карты.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct MapSearchMod {
    /// `map:<slug текста эффекта>[:nightmare]` — постоянный ключ, на него ссылаются наборы пользователя.
    pub id: String,
    pub affix: MapModAffix,
    pub tier: MapModTier,
    /// Строки эффекта, диапазоны сведены по тирам: `Players have -(5-12)% to all maximum Resistances`.
    pub lines: LocalizedLines,
    pub search: LocalizedSearchToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum MapModAffix {
    Prefix,
    Suffix,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum MapModTier {
    Regular,
    /// Усиленный мод (`uber_tier_map`).
    Nightmare,
    #[serde(other)]
    Unknown,
}

/// Свойство карты: число с порогом (количество, качество…) или признак (осквернённая, тип карты…).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MapProperty {
    /// `quantity`, `pack-size`, `quality-rarity`, `corrupted`, `rarity-rare`, `type-shaper`…
    pub id: String,
    pub group: MapPropertyGroup,
    pub kind: MapPropertyKind,
    /// Подпись в интерфейсе: «Количество предметов».
    pub label: LocalizedName,
    /// Строки, как в игре: `Item Quantity: +#%`.
    pub lines: LocalizedLines,
    /// Порядок внутри группы.
    pub sort_order: i32,
    /// У `NUMBER` токен стоит перед числом: блок `"<token>.*<не меньше N>%"`.
    pub search: LocalizedSearchToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum MapPropertyGroup {
    /// Количество и награды.
    Yield,
    /// Виды качества карты (резцы Мейвена).
    Quality,
    /// Осквернённая, неопознанная.
    State,
    Rarity,
    /// Тип карты: Создатель, Древний, Завоеватель…
    Type,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum MapPropertyKind {
    Number,
    Flag,
    #[serde(other)]
    Unknown,
}

/// Класс или восхождение с портретом — запись `ascendancies.json`. Портрет — иконка, как у предметов
/// (`pmicon://<icon_sha256>`).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Ascendancy {
    /// Имя строчными: `elementalist`, `witch`.
    pub id: String,
    /// Как пишет Path of Building: `Elementalist`.
    pub name: String,
    /// Класс восхождения (`witch`); у самого класса — нет.
    pub class_id: Option<String>,
    pub icon_sha256: String,
}

/// `trade-stats.json`: фильтры модов сайта торговли (EN и RU) — по ним сопоставляются моды
/// предметов (вкладка «Билды», позже редкие в Price check). Контракт — shared/docs/pob-trader.md, раздел 4.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct TradeStatsFile {
    /// В порядке сайта торговли.
    pub sections: Vec<TradeStatSection>,
    /// По разделу, затем по id; один id бывает с двумя текстами (`Area has …` / `Your Maps have …`).
    pub stats: Vec<TradeStat>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct TradeStatSection {
    /// `explicit`, `implicit`, `pseudo`…
    pub id: String,
    pub label: LocalizedName,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct TradeStat {
    /// Id фильтра на сайте торговли: `explicit.stat_3299347043`.
    pub id: String,
    pub section: String,
    /// Шаблон с `#` вместо чисел: `+# to maximum Life`; многострочные — через `\n`.
    pub text: LocalizedName,
    /// Варианты стата с выбором («Allocates #», радиус самоцвета); у числового — нет.
    pub options: Option<Vec<TradeStatOption>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct TradeStatOption {
    pub id: u32,
    pub text: LocalizedName,
}
