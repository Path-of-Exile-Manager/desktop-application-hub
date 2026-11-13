//! Строки клиента игры, по которым разбирается текст предмета. Английский и русский клиент.
//!
//! Источник — словари Awakened PoE Trade (MIT): `renderer/public/data/{en,ru}/client_strings.js`,
//! проверенные пользователями на живых клиентах. Пометки расширенного описания (` (enchant)`,
//! ` (implicit)`) и разделитель секций одинаковы во всех языках.

use serde::Serialize;
use ts_rs::TS;

use crate::item::{Blight, Influence};

/// Язык клиента, на котором скопирован предмет.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Language {
    En,
    Ru,
}

pub(crate) struct Strings {
    pub item_class: &'static str,
    pub rarity: &'static str,
    pub rarity_normal: &'static str,
    pub rarity_magic: &'static str,
    pub rarity_rare: &'static str,
    pub rarity_unique: &'static str,
    pub rarity_gem: &'static str,
    pub rarity_currency: &'static str,
    pub rarity_divination: &'static str,
    pub rarity_quest: &'static str,
    pub item_level: &'static str,
    pub gem_level: &'static str,
    pub stack_size: &'static str,
    pub sockets: &'static str,
    pub quality: &'static str,
    pub corrupted: &'static str,
    pub unmodifiable: &'static str,
    pub unidentified: &'static str,
    pub mirrored: &'static str,
    pub split: &'static str,
    pub foil_unique: &'static str,
    pub synthesised_section: &'static str,
    pub cannot_use: &'static str,
    pub influences: [(&'static str, Influence); 6],
    /// «Superior X» / «X высокого качества».
    pub superior_prefix: Option<&'static str>,
    pub superior_suffix: Option<&'static str>,
    /// Тир карты в названии: ` (Tier 16)` / ` (Ур. 16)`.
    pub map_tier_open: &'static str,
    /// Тир карты свойством. Для ru — по аналогии, на живом клиенте не проверено.
    pub map_tier_property: &'static str,
    pub blight_prefixes: [(&'static str, Blight); 2],
    pub foulborn_prefixes: &'static [&'static str],
    pub synthesised_prefixes: &'static [&'static str],
    /// Заголовки свойств в фигурных скобках (Ctrl+Alt+C).
    pub prefix_modifier: &'static str,
    pub suffix_modifier: &'static str,
    pub crafted_prefix: &'static str,
    pub crafted_suffix: &'static str,
    pub fractured_prefix: &'static str,
    pub fractured_suffix: &'static str,
    pub implicit_modifier: &'static str,
    pub corrupted_implicit: &'static str,
    /// Строка энчанта кластерного самоцвета: `Added Small Passive Skills grant: 12% increased Fire Damage`.
    pub cluster_grant: Option<&'static str>,
    /// Свойства оружия (словари Awakened PoE Trade; урон хаосом — по аналогии, у APT его нет).
    pub physical_damage: &'static str,
    pub elemental_damage: &'static str,
    pub chaos_damage: &'static str,
    pub crit_chance: &'static str,
    pub attacks_per_second: &'static str,
}

pub(crate) const EN: Strings = Strings {
    item_class: "Item Class: ",
    rarity: "Rarity: ",
    rarity_normal: "Normal",
    rarity_magic: "Magic",
    rarity_rare: "Rare",
    rarity_unique: "Unique",
    rarity_gem: "Gem",
    rarity_currency: "Currency",
    rarity_divination: "Divination Card",
    rarity_quest: "Quest",
    item_level: "Item Level: ",
    gem_level: "Level: ",
    stack_size: "Stack Size: ",
    sockets: "Sockets: ",
    quality: "Quality: ",
    corrupted: "Corrupted",
    unmodifiable: "Unmodifiable",
    unidentified: "Unidentified",
    mirrored: "Mirrored",
    split: "Split",
    foil_unique: "Foil Unique",
    synthesised_section: "Synthesised Item",
    cannot_use: "You cannot use this item. Its stats will be ignored",
    influences: [
        ("Shaper Item", Influence::Shaper),
        ("Elder Item", Influence::Elder),
        ("Crusader Item", Influence::Crusader),
        ("Redeemer Item", Influence::Redeemer),
        ("Hunter Item", Influence::Hunter),
        ("Warlord Item", Influence::Warlord),
    ],
    superior_prefix: Some("Superior "),
    superior_suffix: None,
    map_tier_open: " (Tier ",
    map_tier_property: "Map Tier: ",
    blight_prefixes: [("Blighted ", Blight::Blighted), ("Blight-ravaged ", Blight::Ravaged)],
    foulborn_prefixes: &["Foulborn "],
    synthesised_prefixes: &["Synthesised "],
    prefix_modifier: "Prefix Modifier",
    suffix_modifier: "Suffix Modifier",
    crafted_prefix: "Master Crafted Prefix Modifier",
    crafted_suffix: "Master Crafted Suffix Modifier",
    fractured_prefix: "Fractured Prefix Modifier",
    fractured_suffix: "Fractured Suffix Modifier",
    implicit_modifier: "Implicit Modifier",
    corrupted_implicit: "Corruption Implicit Modifier",
    cluster_grant: Some("Added Small Passive Skills grant: "),
    physical_damage: "Physical Damage: ",
    elemental_damage: "Elemental Damage: ",
    chaos_damage: "Chaos Damage: ",
    crit_chance: "Critical Strike Chance: ",
    attacks_per_second: "Attacks per Second: ",
};

pub(crate) const RU: Strings = Strings {
    item_class: "Класс предмета: ",
    rarity: "Редкость: ",
    rarity_normal: "Обычный",
    rarity_magic: "Волшебный",
    rarity_rare: "Редкий",
    rarity_unique: "Уникальный",
    rarity_gem: "Камень",
    rarity_currency: "Валюта",
    rarity_divination: "Гадальная карта",
    rarity_quest: "Задание",
    item_level: "Уровень предмета: ",
    gem_level: "Уровень: ",
    stack_size: "Размер стопки: ",
    sockets: "Гнезда: ",
    quality: "Качество: ",
    corrupted: "Осквернено",
    unmodifiable: "Неизменяемый",
    unidentified: "Неопознано",
    mirrored: "Отражено",
    split: "Разделено",
    foil_unique: "Особый уникальный предмет",
    synthesised_section: "Синтезированный предмет",
    cannot_use: "Вы не можете использовать этот предмет, его параметры не будут учтены",
    influences: [
        ("Предмет Создателя", Influence::Shaper),
        ("Древний предмет", Influence::Elder),
        ("Предмет Крестоносца", Influence::Crusader),
        ("Предмет Избавительницы", Influence::Redeemer),
        ("Предмет Охотника", Influence::Hunter),
        ("Предмет Вождя", Influence::Warlord),
    ],
    superior_prefix: None,
    superior_suffix: Some(" высокого качества"),
    map_tier_open: " (Ур. ",
    map_tier_property: "Уровень карты: ",
    blight_prefixes: [("Заражённая ", Blight::Blighted), ("Разорённая Скверной ", Blight::Ravaged)],
    foulborn_prefixes: &["Нечестивый ", "Нечестивая ", "Нечестивое ", "Нечестивые "],
    synthesised_prefixes: &["Синтезированный ", "Синтезированная ", "Синтезированное ", "Синтезированные "],
    prefix_modifier: "Свойство-префикс",
    suffix_modifier: "Свойство-суффикс",
    crafted_prefix: "Ремесленное Свойство-префикс",
    crafted_suffix: "Ремесленное Свойство-суффикс",
    fractured_prefix: "Расколотое Свойство-префикс",
    fractured_suffix: "Расколотое Свойство-суффикс",
    implicit_modifier: "Собственное свойство",
    corrupted_implicit: "Осквернённое собственное свойство",
    // Русской строки энчанта кластера в словарях нет: энчант кластера в ru не разбирается.
    cluster_grant: None,
    physical_damage: "Физический урон: ",
    elemental_damage: "Урон от стихий: ",
    // На живом клиенте не проверено.
    chaos_damage: "Урон хаосом: ",
    crit_chance: "Шанс критического удара: ",
    attacks_per_second: "Атак в секунду: ",
};

pub(crate) fn strings(language: Language) -> &'static Strings {
    match language {
        Language::En => &EN,
        Language::Ru => &RU,
    }
}

/// Пометки расширенного описания — одинаковы во всех языках клиента.
pub(crate) const ENCHANT_MARK: &str = " (enchant)";
pub(crate) const IMPLICIT_MARK: &str = " (implicit)";
pub(crate) const SCOURGE_MARK: &str = " (scourge)";
pub(crate) const FRACTURED_MARK: &str = " (fractured)";
pub(crate) const CRAFTED_MARK: &str = " (crafted)";
pub(crate) const SECTION_SEPARATOR: &str = "--------";
