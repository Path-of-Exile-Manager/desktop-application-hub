//! Справочник в памяти: предметы и классы текущего набора с индексами по id, названию
//! (русскому и английскому) и id сайта торговли.

use std::collections::HashMap;

use super::model::{CatalogItem, ItemClass, Manifest};
use super::store::DatasetStore;

pub struct Catalog {
    pub manifest: Manifest,
    pub items: Vec<CatalogItem>,
    pub classes: Vec<ItemClass>,
    by_id: HashMap<String, usize>,
    /// Нормализованное название (ru и en) → предметы: одно имя бывает у нескольких записей
    /// (уникальный на разных базах).
    by_name: HashMap<String, Vec<usize>>,
    by_trade_id: HashMap<String, usize>,
}

impl Catalog {
    /// Читает набор `id` с диска, проверяя файлы по манифесту.
    pub fn load(store: &DatasetStore, id: &str) -> Result<Self, String> {
        let manifest = store.read_manifest(id)?;
        let items: Vec<CatalogItem> =
            serde_json::from_slice(&store.read_file(id, &manifest, "items.json")?).map_err(|e| format!("items.json не разобран: {e}"))?;
        let classes: Vec<ItemClass> =
            serde_json::from_slice(&store.read_file(id, &manifest, "classes.json")?).map_err(|e| format!("classes.json не разобран: {e}"))?;
        Ok(Self::new(manifest, items, classes))
    }

    pub fn new(manifest: Manifest, items: Vec<CatalogItem>, classes: Vec<ItemClass>) -> Self {
        let mut by_id = HashMap::with_capacity(items.len());
        let mut by_name: HashMap<String, Vec<usize>> = HashMap::with_capacity(items.len() * 2);
        let mut by_trade_id = HashMap::new();
        for (i, item) in items.iter().enumerate() {
            by_id.insert(item.id.clone(), i);
            let en = normalize(&item.name.en);
            by_name.entry(en.clone()).or_default().push(i);
            if let Some(ru) = item.name.ru.as_deref().map(normalize).filter(|ru| *ru != en) {
                by_name.entry(ru).or_default().push(i);
            }
            if let Some(trade_id) = &item.trade_id {
                by_trade_id.insert(trade_id.clone(), i);
            }
        }
        Self { manifest, items, classes, by_id, by_name, by_trade_id }
    }

    pub fn get(&self, id: &str) -> Option<&CatalogItem> {
        self.by_id.get(id).map(|&i| &self.items[i])
    }

    /// Все записи с таким названием (русским или английским), без учёта регистра и «ё».
    pub fn find_by_name(&self, name: &str) -> Vec<&CatalogItem> {
        self.by_name.get(&normalize(name)).map(|list| list.iter().map(|&i| &self.items[i]).collect()).unwrap_or_default()
    }

    /// По id сайта торговли: `divine` → Divine Orb (курс), `chaos`.
    pub fn by_trade_id(&self, trade_id: &str) -> Option<&CatalogItem> {
        self.by_trade_id.get(trade_id).map(|&i| &self.items[i])
    }

    /// База, название которой содержится в имени волшебного предмета («Hale Vaal Regalia of the Fox»):
    /// самое длинное совпадение среди обычных записей, целыми словами.
    pub fn find_base_in(&self, name: &str) -> Vec<&CatalogItem> {
        let haystack = format!(" {} ", normalize(name));
        let mut best: Vec<&CatalogItem> = Vec::new();
        let mut best_len = 0;
        for item in &self.items {
            if item.rarity != super::model::ItemRarity::Normal {
                continue;
            }
            for candidate in [Some(item.name.en.as_str()), item.name.ru.as_deref()].into_iter().flatten() {
                let needle = normalize(candidate);
                if needle.len() >= best_len && haystack.contains(&format!(" {needle} ")) {
                    if needle.len() > best_len {
                        best.clear();
                        best_len = needle.len();
                    }
                    if !best.iter().any(|b| b.id == item.id) {
                        best.push(item);
                    }
                }
            }
        }
        best
    }

    /// Id класса по названию из текста предмета («Body Armours», «Доспехи»).
    pub fn class_id_by_name(&self, name: &str) -> Option<&str> {
        let name = normalize(name);
        self.classes
            .iter()
            .find(|c| normalize(&c.name.en) == name || c.name.ru.as_deref().map(normalize).as_deref() == Some(name.as_str()))
            .map(|c| c.id.as_str())
    }

    /// Поиск для интерфейса: сначала точные совпадения названия, затем начинающиеся с запроса,
    /// затем содержащие его.
    pub fn search(&self, query: &str, limit: usize) -> Vec<&CatalogItem> {
        let query = normalize(query);
        if query.is_empty() {
            return Vec::new();
        }
        let mut ranked: Vec<(u8, usize)> = Vec::new();
        for (i, item) in self.items.iter().enumerate() {
            let rank = [Some(item.name.en.as_str()), item.name.ru.as_deref()]
                .into_iter()
                .flatten()
                .filter_map(|name| {
                    let name = normalize(name);
                    if name == query {
                        Some(0)
                    } else if name.starts_with(&query) {
                        Some(1)
                    } else if name.contains(&query) {
                        Some(2)
                    } else {
                        None
                    }
                })
                .min();
            if let Some(rank) = rank {
                ranked.push((rank, i));
            }
        }
        ranked.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| self.items[a.1].name.en.len().cmp(&self.items[b.1].name.en.len())));
        ranked.into_iter().take(limit).map(|(_, i)| &self.items[i]).collect()
    }
}

/// Нижний регистр, «ё» → «е», лишние пробелы схлопнуты.
pub fn normalize(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase().replace('ё', "е")
}
