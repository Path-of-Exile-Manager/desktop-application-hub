//! Индекс фильтров модов сайта торговли (`trade-stats.json`) для сопоставления строк модов
//! предмета со статами (план shared/docs/pob-trader.md, P2).
//!
//! Устройство индекса перенесено из `vendor/matcher.js` PoB Trade Finder (`buildStatIndex`),
//! MIT, Copyright (c) 2026 Jagomeiister — текст лицензии: crates/pob-parser/LICENSE-PoB-Trade-Finder.
//! Отличия: два языка (английский и русский) и id с несколькими текстами.
//!
//! Ключи:
//! - нормализованный — нижний регистр, числа заменены на `#`, пробелы схлопнуты (`+# to maximum life`);
//! - точный — то же, но с числами: статы с числом в тексте (notable кластеров, энчанты
//!   «Added Small Passive Skills grant: 12% …»);
//! - у многострочного стата — каждая строка и склейки первых строк: предмет показывает строки
//!   по отдельности, а PoB иногда пишет перенесённый стат одной строкой.

use std::collections::HashMap;

use item_parser::Language;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::dataset::model::{LocalizedName, TradeStat, TradeStatSection, TradeStatsFile};
use crate::dataset::DatasetService;

/// Ключи одного языка: ключ → номера статов в порядке файла.
#[derive(Default)]
struct Keys {
    norm: HashMap<String, Vec<u32>>,
    exact: HashMap<String, Vec<u32>>,
    /// Текст стата с выбранным вариантом вместо `#` (точный ключ) → (стат, id варианта).
    options: HashMap<String, Vec<(u32, u32)>>,
}

impl Keys {
    fn add(&mut self, text: &str, index: u32, language: Language) {
        let norm = normalize(text, language);
        let exact = exact_key(text, language);
        if exact != norm {
            push(&mut self.exact, exact, index);
        }
        if text.contains('\n') {
            let lines: Vec<&str> = text.split('\n').collect();
            for line in &lines {
                let key = normalize(line, language);
                if !key.is_empty() && key != norm {
                    push(&mut self.norm, key, index);
                }
            }
            for k in 2..lines.len() {
                let key = normalize(&lines[..k].join(" "), language);
                if !key.is_empty() && key != norm {
                    push(&mut self.norm, key, index);
                }
            }
        }
        push(&mut self.norm, norm, index);
    }
}

fn push(map: &mut HashMap<String, Vec<u32>>, key: String, index: u32) {
    let list = map.entry(key).or_default();
    if list.last() != Some(&index) {
        list.push(index);
    }
}

pub struct StatIndex {
    pub sections: Vec<TradeStatSection>,
    pub stats: Vec<TradeStat>,
    en: Keys,
    ru: Keys,
    by_id: HashMap<String, Vec<u32>>,
}

impl StatIndex {
    pub fn new(file: TradeStatsFile) -> Self {
        let mut en = Keys::default();
        let mut ru = Keys::default();
        let mut by_id: HashMap<String, Vec<u32>> = HashMap::with_capacity(file.stats.len());
        for (i, stat) in file.stats.iter().enumerate() {
            let i = i as u32;
            en.add(&stat.text.en, i, Language::En);
            if let Some(text) = &stat.text.ru {
                ru.add(text, i, Language::Ru);
            }
            // «Allocates #» + «Like Clockwork» → «Allocates Like Clockwork»: так строка выглядит на предмете.
            for option in stat.options.iter().flatten() {
                en.options.entry(exact_key(&stat.text.en.replacen('#', &option.text.en, 1), Language::En)).or_default().push((i, option.id));
                if let (Some(text), Some(option_text)) = (&stat.text.ru, &option.text.ru) {
                    ru.options.entry(exact_key(&text.replacen('#', option_text, 1), Language::Ru)).or_default().push((i, option.id));
                }
            }
            by_id.entry(stat.id.clone()).or_default().push(i);
        }
        Self { sections: file.sections, stats: file.stats, en, ru, by_id }
    }

    fn keys(&self, language: Language) -> &Keys {
        match language {
            Language::En => &self.en,
            Language::Ru => &self.ru,
        }
    }

    /// Статы по нормализованному ключу (`normalize`), в порядке файла.
    pub fn by_norm(&self, language: Language, key: &str) -> impl Iterator<Item = &TradeStat> + Clone {
        self.resolve(self.keys(language).norm.get(key))
    }

    /// Статы по точному ключу (`exact_key`) — только у текстов с числами.
    pub fn by_exact(&self, language: Language, key: &str) -> impl Iterator<Item = &TradeStat> + Clone {
        self.resolve(self.keys(language).exact.get(key))
    }

    /// Статы-с-выбором по тексту с подставленным вариантом (`exact_key`): (стат, id варианта).
    pub fn by_option(&self, language: Language, key: &str) -> impl Iterator<Item = (&TradeStat, u32)> + Clone {
        self.keys(language).options.get(key).into_iter().flatten().map(|&(i, option)| (&self.stats[i as usize], option))
    }

    /// Все тексты стата (у одного id их бывает два).
    pub fn by_id(&self, id: &str) -> impl Iterator<Item = &TradeStat> + Clone {
        self.resolve(self.by_id.get(id))
    }

    fn resolve<'a>(&'a self, list: Option<&'a Vec<u32>>) -> impl Iterator<Item = &'a TradeStat> + Clone {
        list.into_iter().flatten().map(|&i| &self.stats[i as usize])
    }

}

/// Нормализованный ключ строки: нижний регистр, числа (`12`, `1.5`) → `#`, пробелы схлопнуты;
/// в русском «ё» → «е».
pub fn normalize(text: &str, language: Language) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
                chars.next();
            }
            // Дробная часть: «1.5» — одно число, «Level 3.» — нет.
            let mut rest = chars.clone();
            if rest.next() == Some('.') && rest.peek().is_some_and(|c| c.is_ascii_digit()) {
                chars.next();
                while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
                    chars.next();
                }
            }
            out.push('#');
        } else {
            out.push(c);
        }
    }
    exact_key(&out, language)
}

/// Точный ключ: как `normalize`, но числа остаются.
pub fn exact_key(text: &str, language: Language) -> String {
    let lower = text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    match language {
        Language::En => lower,
        Language::Ru => lower.replace('ё', "е"),
    }
}

/// Как найден стат: по id, по тексту с числами, по шаблону.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StatLookupBy {
    Id,
    Exact,
    Norm,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatLookup {
    pub by: StatLookupBy,
    /// Подпись раздела: `Explicit` / «Свойство предмета».
    pub section: Option<LocalizedName>,
    pub stat: TradeStat,
}

/// Статы по строке мода (английской или русской — по наличию кириллицы) или по id фильтра.
/// Отладка индекса, пока моды не сопоставляются (P3). Пусто — индекса нет или ничего не нашлось.
#[tauri::command]
pub fn trade_stats_lookup(service: State<DatasetService>, line: String) -> Vec<StatLookup> {
    let Some(Some(Ok(index))) = service.catalog().map(|c| c.trade_stats.clone()) else { return Vec::new() };
    let language = if line.chars().any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')) { Language::Ru } else { Language::En };
    let found: Vec<(StatLookupBy, &TradeStat)> = index
        .by_id(line.trim())
        .map(|s| (StatLookupBy::Id, s))
        .chain(index.by_exact(language, &exact_key(&line, language)).map(|s| (StatLookupBy::Exact, s)))
        .chain(index.by_norm(language, &normalize(&line, language)).map(|s| (StatLookupBy::Norm, s)))
        .collect();
    found
        .into_iter()
        .map(|(by, stat)| StatLookup { by, section: index.sections.iter().find(|s| s.id == stat.section).map(|s| s.label.clone()), stat: stat.clone() })
        .collect()
}
