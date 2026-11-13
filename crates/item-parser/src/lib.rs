//! Разбор текста предмета Path of Exile 1, скопированного из игры (английский и русский клиент).
//!
//! - [`parse`] — текст → [`ParsedItem`]: класс, редкость, имя, база, уровни, гнёзда, отметки, свойства;
//! - [`variant`] — ключ варианта цены, тот же, что строит бэкенд из ответов источников.
//!
//! Справочника у парсера нет: названия остаются как в клиенте, сопоставление — в приложении.

mod item;
mod parse;
mod strings;
pub mod variant;

use serde::Serialize;
use ts_rs::TS;

pub use item::{Affix, Blight, DamageRange, Influence, ModKind, ParsedItem, ParsedMod, Sockets, WeaponProps};
pub use parse::parse;
pub use strings::Language;

/// Версия парсера, чтобы её было видно в интерфейсе.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Редкость предмета, как её пишет игра в строке `Rarity: ...`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Rarity {
    Normal,
    Magic,
    Rare,
    Unique,
    Currency,
    Gem,
    DivinationCard,
    /// Предмет задания.
    Quest,
}

/// Почему не удалось разобрать текст.
#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    /// В тексте нет строки `Rarity: ...` — скорее всего, это не предмет PoE.
    MissingRarity,
    /// Строка есть, но значение незнакомое (новый тип предмета или другой язык клиента).
    UnknownRarity(String),
    /// Текст не начинается с класса предмета на знакомом языке.
    NotAnItem,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingRarity => f.write_str("в тексте нет редкости предмета"),
            Self::UnknownRarity(r) => write!(f, "незнакомая редкость «{r}»"),
            Self::NotAnItem => f.write_str("это не текст предмета Path of Exile (или язык клиента не поддерживается)"),
        }
    }
}

impl std::error::Error for ParseError {}

/// Находит в тексте предмета строку `Rarity: ...` и возвращает редкость.
pub fn parse_rarity(text: &str) -> Result<Rarity, ParseError> {
    let value = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("Rarity: "))
        .ok_or(ParseError::MissingRarity)?;

    match value {
        "Normal" => Ok(Rarity::Normal),
        "Magic" => Ok(Rarity::Magic),
        "Rare" => Ok(Rarity::Rare),
        "Unique" => Ok(Rarity::Unique),
        "Currency" => Ok(Rarity::Currency),
        "Gem" => Ok(Rarity::Gem),
        "Divination Card" => Ok(Rarity::DivinationCard),
        other => Err(ParseError::UnknownRarity(other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RARE_ARMOUR: &str = "\
Item Class: Body Armours
Rarity: Rare
Doom Shell
Vaal Regalia
--------
Energy Shield: 512 (augmented)
";

    #[test]
    fn finds_rarity_of_rare_item() {
        assert_eq!(parse_rarity(RARE_ARMOUR), Ok(Rarity::Rare));
    }

    #[test]
    fn handles_windows_line_endings() {
        let text = RARE_ARMOUR.replace('\n', "\r\n");
        assert_eq!(parse_rarity(&text), Ok(Rarity::Rare));
    }

    #[test]
    fn rejects_text_without_rarity() {
        assert_eq!(parse_rarity("просто текст"), Err(ParseError::MissingRarity));
    }

    #[test]
    fn reports_unknown_rarity() {
        assert_eq!(
            parse_rarity("Rarity: Редкий"),
            Err(ParseError::UnknownRarity("Редкий".to_string()))
        );
    }
}
