//! XML документа PoB → [`PobBuild`]: сборка, предметы, наборы предметов и камней, деревья.
//!
//! Что берётся и как выбирается активное — по `parseBuild` из PoB Trade Finder (`vendor/pob.js`;
//! MIT, © 2026 Jagomeiister) и загрузке сборки в PoB (`Classes/ItemsTab.lua`, `SkillsTab.lua`,
//! `TreeTab.lua`). XML разбирается парсером, а не регулярками; наборы и связки сохраняются целиком
//! (с выключенными, Swap, умениями от предметов) — что из них нужно, решает приложение.

use std::collections::HashMap;

use roxmltree::{Document, Node, ParsingOptions};

use crate::PobError;
use crate::item_text::{leading_u32, parse_item_text};
use crate::model::{
    PobBuild, PobGem, PobGemGroup, PobItem, PobItemSet, PobSkillSet, PobSlot, PobTreeSocket,
    PobTreeSpec,
};

fn attr<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attribute(name)
}

/// Непустой атрибут.
fn text_attr(node: Node, name: &str) -> Option<String> {
    attr(node, name)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn number_attr(node: Node, name: &str) -> Option<u32> {
    attr(node, name).and_then(leading_u32)
}

fn flag_attr(node: Node, name: &str) -> bool {
    attr(node, name) == Some("true")
}

fn children<'a, 'input>(
    node: Node<'a, 'input>,
    tag: &'a str,
) -> impl Iterator<Item = Node<'a, 'input>> + 'a {
    node.children().filter(move |child| child.has_tag_name(tag))
}

fn child<'a, 'input>(node: Node<'a, 'input>, tag: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|child| child.has_tag_name(tag))
}

/// Разбирает XML сборки PoB для PoE1.
pub fn parse_xml(xml: &str) -> Result<PobBuild, PobError> {
    let options = ParsingOptions {
        allow_dtd: true,
        ..ParsingOptions::default()
    };
    let doc = Document::parse_with_options(xml, options)
        .map_err(|e| PobError::InvalidXml(e.to_string()))?;
    let root = doc.root_element();
    match root.tag_name().name() {
        "PathOfBuilding" => {}
        "PathOfBuilding2" => return Err(PobError::Poe2),
        _ => return Err(PobError::NotPathOfBuilding),
    }

    let build = child(root, "Build");
    let (items, item_sets, active_item_set) = match child(root, "Items") {
        Some(node) => items(node),
        None => (Vec::new(), Vec::new(), 0),
    };
    let (skill_sets, active_skill_set) = child(root, "Skills").map(skills).unwrap_or_default();
    let (tree_specs, active_tree_spec) = child(root, "Tree").map(tree).unwrap_or_default();

    Ok(PobBuild {
        class_name: build
            .and_then(|b| text_attr(b, "className"))
            .unwrap_or_default(),
        ascendancy: build
            .and_then(|b| text_attr(b, "ascendClassName"))
            .filter(|a| a != "None"),
        level: build
            .and_then(|b| number_attr(b, "level"))
            .filter(|&level| level > 0),
        main_socket_group: build
            .and_then(|b| number_attr(b, "mainSocketGroup"))
            .filter(|&n| n > 0),
        target_version: build.and_then(|b| text_attr(b, "targetVersion")),
        items,
        item_sets,
        active_item_set,
        skill_sets,
        active_skill_set,
        tree_specs,
        active_tree_spec,
        notes: child(root, "Notes")
            .and_then(|n| n.text())
            .map(str::trim)
            .unwrap_or_default()
            .to_string(),
    })
}

/// `<Items>`: предметы, наборы и активный набор.
fn items(node: Node) -> (Vec<PobItem>, Vec<PobItemSet>, usize) {
    let mut list = Vec::new();
    for item in children(node, "Item") {
        let Some(id) = number_attr(item, "id") else {
            continue;
        };
        // текст предмета — текстовые узлы; вложенные `<ModRange id range>` — положение роллов
        let text: String = item
            .children()
            .filter(|c| c.is_text())
            .filter_map(|c| c.text())
            .collect();
        let mod_ranges: HashMap<u32, f64> = children(item, "ModRange")
            .filter_map(|r| {
                Some((
                    number_attr(r, "id")?,
                    attr(r, "range")?.trim().parse().ok()?,
                ))
            })
            .collect();
        if let Some(parsed) = parse_item_text(id, &text, &mod_ranges) {
            list.push(parsed);
        }
    }

    let mut sets: Vec<PobItemSet> = children(node, "ItemSet")
        .enumerate()
        .map(|(index, set)| PobItemSet {
            id: number_attr(set, "id").unwrap_or(index as u32 + 1),
            title: text_attr(set, "title"),
            slots: slots(set),
        })
        .collect();
    // Старые сборки: `<Slot>` прямо в `<Items>`, без наборов. PoB в этом случае создаёт набор 1.
    if sets.is_empty() {
        sets.push(PobItemSet {
            id: 1,
            title: None,
            slots: slots(node),
        });
    }
    let active_id = number_attr(node, "activeItemSet").unwrap_or(1);
    let active = sets.iter().position(|set| set.id == active_id).unwrap_or(0);
    (list, sets, active)
}

fn slots(node: Node) -> Vec<PobSlot> {
    children(node, "Slot")
        .filter_map(|slot| {
            let name = text_attr(slot, "name")?;
            let item_id = number_attr(slot, "itemId").filter(|&id| id != 0)?;
            Some(PobSlot { name, item_id })
        })
        .collect()
}

/// `<Skills>`: наборы камней и активный набор.
fn skills(node: Node) -> (Vec<PobSkillSet>, usize) {
    let mut sets: Vec<PobSkillSet> = children(node, "SkillSet")
        .enumerate()
        .map(|(index, set)| PobSkillSet {
            id: number_attr(set, "id").unwrap_or(index as u32 + 1),
            title: text_attr(set, "title"),
            groups: children(set, "Skill").map(gem_group).collect(),
        })
        .collect();
    // Старые сборки: `<Skill>` прямо в `<Skills>`.
    if sets.is_empty() {
        let groups: Vec<PobGemGroup> = children(node, "Skill").map(gem_group).collect();
        if !groups.is_empty() {
            sets.push(PobSkillSet {
                id: 1,
                title: None,
                groups,
            });
        }
    }
    let active_id = number_attr(node, "activeSkillSet").unwrap_or(1);
    let active = sets.iter().position(|set| set.id == active_id).unwrap_or(0);
    (sets, active)
}

fn gem_group(node: Node) -> PobGemGroup {
    PobGemGroup {
        slot: text_attr(node, "slot"),
        label: text_attr(node, "label"),
        enabled: attr(node, "enabled") != Some("false"),
        source: text_attr(node, "source"),
        include_in_full_dps: flag_attr(node, "includeInFullDPS"),
        gems: children(node, "Gem")
            .filter_map(|gem| {
                Some(PobGem {
                    name: text_attr(gem, "nameSpec")?,
                    gem_id: text_attr(gem, "gemId"),
                    variant_id: text_attr(gem, "variantId"),
                    skill_id: text_attr(gem, "skillId"),
                    level: number_attr(gem, "level").unwrap_or(1),
                    quality: number_attr(gem, "quality").unwrap_or(0),
                    quality_id: text_attr(gem, "qualityId").filter(|q| q != "Default"),
                    count: number_attr(gem, "count").unwrap_or(1),
                    enabled: attr(gem, "enabled") != Some("false"),
                    corrupted: flag_attr(gem, "corrupted"),
                })
            })
            .collect(),
    }
}

/// `<Tree>`: деревья и активное (`activeSpec` — номер с 1).
fn tree(node: Node) -> (Vec<PobTreeSpec>, usize) {
    let specs: Vec<PobTreeSpec> = children(node, "Spec").map(tree_spec).collect();
    let active = match specs.len() {
        0 => 0,
        len => {
            (number_attr(node, "activeSpec")
                .unwrap_or(1)
                .clamp(1, len as u32)
                - 1) as usize
        }
    };
    (specs, active)
}

fn tree_spec(node: Node) -> PobTreeSpec {
    let numbers = |value: &str| -> Vec<u32> {
        value
            .split(',')
            .filter_map(|v| v.trim().parse().ok())
            .collect()
    };
    PobTreeSpec {
        title: text_attr(node, "title"),
        version: text_attr(node, "treeVersion"),
        class_id: number_attr(node, "classId"),
        ascend_class_id: number_attr(node, "ascendClassId"),
        nodes: attr(node, "nodes").map(numbers).unwrap_or_default(),
        // `{12125,34242},{60170,38814}`
        masteries: attr(node, "masteryEffects")
            .unwrap_or_default()
            .split('}')
            .filter_map(|pair| {
                let (node_id, effect) = pair.trim_start_matches([',', '{', ' ']).split_once(',')?;
                Some([node_id.trim().parse().ok()?, effect.trim().parse().ok()?])
            })
            .collect(),
        sockets: child(node, "Sockets")
            .map(|sockets| {
                children(sockets, "Socket")
                    .filter_map(|socket| {
                        Some(PobTreeSocket {
                            node_id: number_attr(socket, "nodeId")?,
                            item_id: number_attr(socket, "itemId").filter(|&id| id != 0)?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        url: child(node, "URL")
            .and_then(|url| url.text())
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .map(str::to_string),
    }
}
