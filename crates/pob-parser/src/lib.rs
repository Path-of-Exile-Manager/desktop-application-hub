//! Разбор кода экспорта Path of Building (только PoE1).
//!
//! - [`decode_code`] — код (base64url + zlib) → XML;
//! - [`parse_xml`] — XML → [`PobBuild`]: предметы со свойствами, наборы предметов, наборы камней, деревья;
//! - [`parse_code`] — оба шага сразу.
//!
//! Справочника, цен и сети у крейта нет: названия остаются как в PoB, сопоставление — в приложении.
//!
//! Разбор текста предмета и выбор наборов перенесены из PoB Trade Finder (`vendor/pob.js`) —
//! MIT, © 2026 Jagomeiister; текст лицензии — `LICENSE-PoB-Trade-Finder` рядом с `Cargo.toml`.

mod build;
mod decode;
mod item_text;
mod model;

pub use build::parse_xml;
pub use decode::{MAX_XML_BYTES, decode_code};
pub use model::{
    PobAffix, PobAffixKind, PobBuild, PobEldritch, PobGem, PobGemGroup, PobInfluence, PobItem,
    PobItemSet, PobMod, PobModKind, PobRarity, PobSkillSet, PobSlot, PobSockets, PobTreeSocket,
    PobTreeSpec,
};

/// Почему не удалось прочитать сборку.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PobError {
    /// Пустая строка вместо кода.
    EmptyCode,
    /// Не base64, не zlib или не UTF-8 — это не код PoB.
    InvalidCode,
    /// После распаковки больше [`MAX_XML_BYTES`].
    TooLarge,
    /// Распаковалось, но XML испорчен.
    InvalidXml(String),
    /// XML, но не сборка PoB.
    NotPathOfBuilding,
    /// Сборка Path of Building для PoE2.
    Poe2,
}

impl std::fmt::Display for PobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyCode => f.write_str("вставьте код экспорта Path of Building"),
            Self::InvalidCode => f.write_str("это не код экспорта Path of Building"),
            Self::TooLarge => f.write_str("сборка слишком большая"),
            Self::InvalidXml(reason) => write!(f, "код Path of Building повреждён: {reason}"),
            Self::NotPathOfBuilding => f.write_str("это не сборка Path of Building"),
            Self::Poe2 => f.write_str("сборка для Path of Exile 2 — поддерживается только PoE1"),
        }
    }
}

impl std::error::Error for PobError {}

/// Код экспорта PoB → сборка.
pub fn parse_code(code: &str) -> Result<PobBuild, PobError> {
    parse_xml(&decode_code(code)?)
}
