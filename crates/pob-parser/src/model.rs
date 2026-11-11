//! Модель сборки Path of Building. Названия — как в PoB (английские): сопоставление
//! со справочником, ценами и сайтом торговли делает приложение.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Сборка из кода экспорта PoB.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobBuild {
    /// Класс: `Witch`.
    pub class_name: String,
    /// Восхождение: `Elementalist`; нет, если не выбрано (PoB пишет `None`).
    pub ascendancy: Option<String>,
    pub level: Option<u32>,
    /// Главная связка: номер (с 1) среди всех `<Skill>` активного набора камней, как в PoB.
    pub main_socket_group: Option<u32>,
    /// Версия игры, под которую сохранена сборка: `3_0`.
    pub target_version: Option<String>,
    /// Все предметы сборки в порядке файла; наборы и деревья ссылаются на них по `id`.
    pub items: Vec<PobItem>,
    /// Наборы предметов — «этапы» гайда (Leveling / Endgame…). Хотя бы один, если в сборке есть `<Items>`.
    pub item_sets: Vec<PobItemSet>,
    /// Индекс активного набора в `item_sets`.
    pub active_item_set: usize,
    /// Наборы камней. У старых сборок без `<SkillSet>` — один набор без названия.
    pub skill_sets: Vec<PobSkillSet>,
    pub active_skill_set: usize,
    /// Деревья пассивных умений (тоже «этапы»).
    pub tree_specs: Vec<PobTreeSpec>,
    pub active_tree_spec: usize,
    /// Заметки автора как есть, с цветовыми кодами PoB (`^7`, `^xFFFFFF`).
    pub notes: String,
}

impl PobBuild {
    pub fn item(&self, id: u32) -> Option<&PobItem> {
        self.items.iter().find(|item| item.id == id)
    }
}

/// Редкость предмета, как её пишет PoB (`Rarity: RARE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobRarity {
    Normal,
    Magic,
    Rare,
    Unique,
    /// Реликвия (Foil) — уникальный с особой рамкой.
    Relic,
}

/// Влияние базы, включая эльдрические (`Searing Exarch Item`, `Eater of Worlds Item`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobInfluence {
    Shaper,
    Elder,
    Crusader,
    Redeemer,
    Hunter,
    Warlord,
    SearingExarch,
    EaterOfWorlds,
}

/// Где стоит свойство: зачарование, implicit, explicit. Как раскладывает PoB: первые `Implicits: N`
/// строк — зачарования (`{crafted}`/`{enchant}`), Scourge (`{scourge}`) и implicit, остальные — explicit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobModKind {
    Enchant,
    Scourge,
    Implicit,
    Explicit,
    /// Свойство Crucible (`{crucible}`).
    Crucible,
}

/// Эльдрическое implicit-свойство (`{exarch}`, `{eater}`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobEldritch {
    SearingExarch,
    EaterOfWorlds,
}

/// Одна строка свойства предмета.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobMod {
    /// Текст без служебных пометок; диапазоны `(20-30)` заменены значением по положению ролла.
    pub line: String,
    /// Строка как в PoB, с пометками `{crafted}`, `{range:0.5}`, `{variant:2}`.
    pub raw: String,
    pub kind: PobModKind,
    /// Создано на верстаке (`{crafted}`); у зачарований тоже `true`, как в PoB.
    pub crafted: bool,
    pub fractured: bool,
    /// Свойство Foulborn (`{mutated}`).
    pub mutated: bool,
    pub eldritch: Option<PobEldritch>,
    /// Свойство, которого нет в данных PoB (вписано вручную, `{custom}`).
    pub custom: bool,
    /// В строке был диапазон `(a-b)`.
    pub ranged: bool,
    /// Границы ролла: среднее нижних и среднее верхних чисел (для «Adds (a-b) to (c-d)»).
    pub bounds: Option<[f64; 2]>,
    /// Положение ролла в диапазоне, 0…1: `{range:x}`, иначе `<ModRange>`, иначе 0,5.
    pub roll: Option<f64>,
    /// Строка выбранного варианта уникального (`{variant:N}`) — то, что отличает этот вариант от других.
    pub variant: bool,
}

/// Аффикс из крафтера PoB (`Prefix: {range:0.5}IncreasedLife7`): id мода игры и положение ролла.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobAffix {
    pub kind: PobAffixKind,
    pub mod_id: String,
    pub range: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PobAffixKind {
    Prefix,
    Suffix,
}

/// Гнёзда предмета.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobSockets {
    /// Как в PoB: `R-R-G B` (связанные — через `-`, группы — через пробел).
    pub text: String,
    pub count: u8,
    /// Самая большая связанная группа.
    pub links: u8,
}

/// Предмет сборки.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobItem {
    /// Id предмета в сборке (`<Item id="5">`).
    pub id: u32,
    pub rarity: PobRarity,
    /// Имя. У редкого из крафтера PoB — `New Item`; у обычного и волшебного — вся строка с базой и аффиксами.
    pub name: String,
    /// База. У обычного и волшебного PoB пишет одну строку — тогда база равна имени (`Driftwood Wand of Talent`),
    /// настоящую базу ищет приложение по справочнику.
    pub base: String,
    pub item_level: Option<u32>,
    pub quality: Option<u32>,
    /// Требуемый уровень (`LevelReq`).
    pub level_req: Option<u32>,
    pub sockets: Option<PobSockets>,
    pub influences: Vec<PobInfluence>,
    pub corrupted: bool,
    pub mirrored: bool,
    pub split: bool,
    /// `Fractured Item`.
    pub fractured: bool,
    /// `Synthesised Item`.
    pub synthesised: bool,
    /// Собран в крафтере PoB (`Crafted: true`): тогда известны аффиксы.
    pub crafted: bool,
    pub armour: Option<u32>,
    pub evasion: Option<u32>,
    pub energy_shield: Option<u32>,
    pub ward: Option<u32>,
    /// Радиус самоцвета: `Medium`, `Variable`.
    pub radius: Option<String>,
    /// `Limited to: 1`.
    pub limited_to: Option<u32>,
    pub talisman_tier: Option<u32>,
    /// Катализатор на бижутерии: `Fertile`.
    pub catalyst: Option<String>,
    pub catalyst_quality: Option<u32>,
    /// Умение большого кластера: `affliction_cold_damage`.
    pub cluster_jewel_skill: Option<String>,
    pub cluster_jewel_node_count: Option<u32>,
    /// Лига, где выпал предмет (у предметов из старых лиг).
    pub league: Option<String>,
    /// Названия вариантов уникального (`Variant: Pre 3.12.0`) — в порядке PoB.
    pub variants: Vec<String>,
    /// Выбранный вариант: номер (с 1) в `variants`.
    pub selected_variant: Option<u32>,
    /// Выбранные дополнительные варианты (Watcher's Eye, Forbidden Flame…): номера в `variants`.
    pub selected_alt_variants: Vec<u32>,
    /// Аффиксы из крафтера PoB (только при `crafted`).
    pub affixes: Vec<PobAffix>,
    /// Свойства выбранных вариантов: зачарования, implicit, explicit — в порядке PoB.
    pub mods: Vec<PobMod>,
    /// Текст предмета из PoB: строки без отступов, без вложенных тегов.
    pub raw_text: String,
}

/// Набор предметов (`<ItemSet>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobItemSet {
    /// Id набора в сборке. Для старых сборок без `<ItemSet>` — `1`.
    pub id: u32,
    pub title: Option<String>,
    /// Занятые слоты (`itemId` не 0) в порядке файла, включая Swap, абиссальные гнёзда, фласки и графты.
    pub slots: Vec<PobSlot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobSlot {
    /// Слот как в PoB: `Weapon 1`, `Body Armour`, `Ring 2`, `Flask 3`, `Weapon 1 Swap`, `Helmet Abyssal Socket 1`.
    pub name: String,
    pub item_id: u32,
}

impl PobSlot {
    /// Слот второго комплекта оружия (`Weapon 1 Swap`, `Weapon 2 Swap Abyssal Socket 1`).
    pub fn is_swap(&self) -> bool {
        self.name.contains("Swap")
    }

    /// Фласка или настойка (`Flask 1`…`Flask 5`).
    pub fn is_flask(&self) -> bool {
        self.name.starts_with("Flask")
    }
}

/// Набор камней (`<SkillSet>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobSkillSet {
    /// Id набора; у старых сборок без `<SkillSet>` — `1`.
    pub id: u32,
    pub title: Option<String>,
    /// Все связки в порядке файла, включая выключенные и умения от предметов: по позиции считается
    /// `main_socket_group`.
    pub groups: Vec<PobGemGroup>,
}

/// Связка камней (`<Skill>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobGemGroup {
    /// Слот, где стоит связка: `Body Armour`; нет — камни не привязаны к предмету.
    pub slot: Option<String>,
    pub label: Option<String>,
    pub enabled: bool,
    /// Умение даёт предмет (`Item:12:…`), а не камень — покупать нечего.
    pub source: Option<String>,
    pub include_in_full_dps: bool,
    /// Камни с названием (`nameSpec`) в порядке связки.
    pub gems: Vec<PobGem>,
}

/// Камень (`<Gem>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobGem {
    /// Название: `Freezing Pulse`, `Added Cold Damage`, трансфигурированный — `Freezing Pulse of …`.
    pub name: String,
    /// Путь камня в данных игры: `Metadata/Items/Gems/SkillGemFreezingPulse`. Нет у умений от предметов.
    pub gem_id: Option<String>,
    /// Id варианта в данных PoB: `FreezingPulse`, `SupportAddedColdDamage`.
    pub variant_id: Option<String>,
    pub skill_id: Option<String>,
    pub level: u32,
    pub quality: u32,
    /// Альтернативное качество у старых сборок: `Alternate1`.
    pub quality_id: Option<String>,
    pub count: u32,
    pub enabled: bool,
    pub corrupted: bool,
}

/// Дерево пассивных умений (`<Spec>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobTreeSpec {
    pub title: Option<String>,
    /// Версия дерева: `3_29`.
    pub version: Option<String>,
    pub class_id: Option<u32>,
    pub ascend_class_id: Option<u32>,
    /// Взятые узлы.
    pub nodes: Vec<u32>,
    /// Выбранные мастерства: `[узел, эффект]`.
    pub masteries: Vec<[u32; 2]>,
    /// Самоцветы в гнёздах дерева (`itemId` не 0).
    pub sockets: Vec<PobTreeSocket>,
    /// Ссылка на дерево на сайте игры.
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobTreeSocket {
    pub node_id: u32,
    pub item_id: u32,
}
