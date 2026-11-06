//! Разбор текста предмета Path of Exile 1, скопированного из игры.
//!
//! Пока это заготовка: умеет только найти строку `Rarity: ...`.
//! Полноценный разбор (название, база, моды, тиры) — шаг 5 прототипа.

/// Версия парсера, чтобы её было видно в интерфейсе.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Редкость предмета, как её пишет игра в строке `Rarity: ...`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rarity {
    Normal,
    Magic,
    Rare,
    Unique,
    Currency,
    Gem,
    DivinationCard,
}

/// Почему не удалось разобрать текст.
#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    /// В тексте нет строки `Rarity: ...` — скорее всего, это не предмет PoE.
    MissingRarity,
    /// Строка есть, но значение незнакомое (новый тип предмета или другой язык клиента).
    UnknownRarity(String),
}

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
