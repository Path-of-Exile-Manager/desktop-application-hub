//! Результат разбора текста предмета. Названия — как в клиенте игры (английские или русские):
//! сопоставление со справочником делает приложение, у парсера справочника нет.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::strings::Language;
use crate::Rarity;

/// Влияние базы. Значения — контракт ключа цены (`influence=SHAPER`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum Influence {
    Shaper,
    Elder,
    Crusader,
    Redeemer,
    Hunter,
    Warlord,
}

impl Influence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shaper => "SHAPER",
            Self::Elder => "ELDER",
            Self::Crusader => "CRUSADER",
            Self::Redeemer => "REDEEMER",
            Self::Hunter => "HUNTER",
            Self::Warlord => "WARLORD",
        }
    }

    /// Как источники называют влияние в именованном варианте: `Shaper/Warlord`.
    pub fn title(self) -> &'static str {
        match self {
            Self::Shaper => "Shaper",
            Self::Elder => "Elder",
            Self::Crusader => "Crusader",
            Self::Redeemer => "Redeemer",
            Self::Hunter => "Hunter",
            Self::Warlord => "Warlord",
        }
    }
}

/// Заражённая карта. Значения — контракт ключа цены (`blight=BLIGHTED`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum Blight {
    Blighted,
    Ravaged,
}

impl Blight {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blighted => "BLIGHTED",
            Self::Ravaged => "RAVAGED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Sockets {
    /// Как в игре: `R-R-G B`.
    pub text: String,
    pub count: u8,
    /// Самая большая связанная группа.
    pub links: u8,
    pub white: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ModKind {
    Enchant,
    Implicit,
    Explicit,
    Crafted,
    Fractured,
    Scourge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Affix {
    Prefix,
    Suffix,
}

/// Свойство предмета: одна или несколько строк текста. Из расширенного описания (Ctrl+Alt+C).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParsedMod {
    pub kind: ModKind,
    pub affix: Option<Affix>,
    /// Название свойства из заголовка: `"Hale"`.
    pub name: Option<String>,
    pub tier: Option<u32>,
    /// Строки без служебных пометок (`(implicit)`, `— Unscalable Value`), значения с диапазонами как в игре.
    pub lines: Vec<String>,
}

/// Предмет, как его описывает текст из игры.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParsedItem {
    pub language: Language,
    /// Класс как в игре: `Body Armours`, `Доспехи`.
    pub item_class: String,
    pub rarity: Rarity,
    /// Имя: у уникального и редкого — собственное, у остальных — название предмета.
    /// Без «Superior», «Foulborn», «Synthesised», тира и заражения карты.
    pub name: String,
    /// База — вторая строка у редких и уникальных; у остальных `null`.
    pub base_type: Option<String>,
    pub item_level: Option<u32>,
    pub quality: Option<u32>,
    pub gem_level: Option<u32>,
    pub stack_size: Option<u32>,
    pub sockets: Option<Sockets>,
    pub map_tier: Option<u32>,
    pub blight: Option<Blight>,
    pub influences: Vec<Influence>,
    pub corrupted: bool,
    pub mirrored: bool,
    pub split: bool,
    pub unidentified: bool,
    pub synthesised: bool,
    /// Уникальный «Foulborn» / «Нечестивый».
    pub foulborn: bool,
    /// Особый уникальный (Foil, relic).
    pub foil: bool,
    pub mods: Vec<ParsedMod>,
}

impl ParsedItem {
    pub fn enchants(&self) -> impl Iterator<Item = &str> {
        self.mods.iter().filter(|m| m.kind == ModKind::Enchant).flat_map(|m| m.lines.iter().map(String::as_str))
    }
}
