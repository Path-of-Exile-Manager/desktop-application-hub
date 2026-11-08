//! Разбор текста предмета: «табличка» (класс, редкость, имя, база) и секции через `--------`.
//! Порядок и правила секций повторяют Awakened PoE Trade (`renderer/src/parser/Parser.ts`):
//! каждая секция разбирается одним правилом, первое подходящее выигрывает.

use crate::item::{Affix, Influence, ModKind, ParsedItem, ParsedMod, Sockets};
use crate::strings::{self, Language, Strings, CRAFTED_MARK, ENCHANT_MARK, FRACTURED_MARK, IMPLICIT_MARK, SCOURGE_MARK, SECTION_SEPARATOR};
use crate::{ParseError, Rarity};

/// Разбирает текст предмета из игры (Ctrl+C или Ctrl+Alt+C), английский или русский клиент.
pub fn parse(text: &str) -> Result<ParsedItem, ParseError> {
    let mut sections = split_sections(text);
    let first = sections.first().and_then(|s| s.first()).ok_or(ParseError::NotAnItem)?;
    let language = if first.starts_with(strings::EN.item_class) {
        Language::En
    } else if first.starts_with(strings::RU.item_class) {
        Language::Ru
    } else {
        return Err(ParseError::NotAnItem);
    };
    let s = strings::strings(language);

    // «Вы не можете использовать этот предмет» вклинивается после редкости и делит табличку надвое.
    if sections[0].get(2).is_some_and(|l| *l == s.cannot_use) && sections.len() > 1 {
        let mut head = sections.remove(0);
        head.truncate(2);
        head.extend(sections[0].iter().copied());
        sections[0] = head;
    }

    let plate = sections.remove(0);
    let item_class = plate[0][s.item_class.len()..].trim().to_string();
    let rarity_text = plate.get(1).and_then(|l| l.strip_prefix(s.rarity)).ok_or(ParseError::MissingRarity)?;
    let rarity = rarity_of(s, rarity_text).ok_or_else(|| ParseError::UnknownRarity(rarity_text.to_string()))?;
    let name = plate.get(2).map(|l| clean_markup(l)).ok_or(ParseError::NotAnItem)?;
    let base_type = plate.get(3).map(|l| clean_markup(l));

    let mut item = ParsedItem {
        language,
        item_class,
        rarity,
        name,
        base_type,
        item_level: None,
        quality: None,
        gem_level: None,
        stack_size: None,
        sockets: None,
        map_tier: None,
        blight: None,
        influences: Vec::new(),
        corrupted: false,
        mirrored: false,
        split: false,
        unidentified: false,
        synthesised: false,
        foulborn: false,
        foil: false,
        mods: Vec::new(),
    };

    for section in &sections {
        parse_section(s, section, &mut item);
    }
    clean_names(s, &mut item);
    Ok(item)
}

fn split_sections(text: &str) -> Vec<Vec<&str>> {
    let mut sections: Vec<Vec<&str>> = vec![Vec::new()];
    for line in text.lines() {
        let line = line.trim_end();
        if line == SECTION_SEPARATOR {
            sections.push(Vec::new());
        } else if !line.is_empty() {
            sections.last_mut().expect("at least one section").push(line);
        }
    }
    sections.retain(|s| !s.is_empty());
    sections
}

fn rarity_of(s: &Strings, text: &str) -> Option<Rarity> {
    let text = text.trim();
    [
        (s.rarity_normal, Rarity::Normal),
        (s.rarity_magic, Rarity::Magic),
        (s.rarity_rare, Rarity::Rare),
        (s.rarity_unique, Rarity::Unique),
        (s.rarity_gem, Rarity::Gem),
        (s.rarity_currency, Rarity::Currency),
        (s.rarity_divination, Rarity::DivinationCard),
        (s.rarity_quest, Rarity::Quest),
    ]
    .into_iter()
    .find_map(|(t, r)| (t == text).then_some(r))
}

fn parse_section(s: &Strings, section: &[&str], item: &mut ParsedItem) {
    // Однострочные отметки.
    if section.len() == 1 {
        let line = section[0];
        let flag = if line == s.corrupted || line == s.unmodifiable {
            Some(&mut item.corrupted)
        } else if line == s.unidentified {
            Some(&mut item.unidentified)
        } else if line == s.mirrored {
            Some(&mut item.mirrored)
        } else if line == s.split {
            Some(&mut item.split)
        } else if line == s.foil_unique {
            Some(&mut item.foil)
        } else if line == s.synthesised_section {
            Some(&mut item.synthesised)
        } else {
            None
        };
        if let Some(flag) = flag {
            *flag = true;
            return;
        }
    }

    // Влияния: секция из одной-двух строк «Shaper Item».
    if section.len() <= 2 {
        let found: Vec<Influence> = section.iter().filter_map(|l| s.influences.iter().find(|(t, _)| t == l).map(|(_, i)| *i)).collect();
        if found.len() == section.len() {
            item.influences.extend(found);
            return;
        }
    }

    // Свойства из расширенного описания.
    if is_mod_section(section) {
        parse_mods(s, section, item);
        return;
    }

    // Уровень камня: вторая строка секции свойств камня («Level: 20 (Max)»). Секция требований
    // («Requirements: / Level: 70») идёт позже — берётся только первое совпадение.
    if item.rarity == Rarity::Gem && item.gem_level.is_none() && section.get(1).is_some_and(|l| l.starts_with(s.gem_level)) {
        item.gem_level = leading_number(&section[1][s.gem_level.len()..]);
    }

    for line in section {
        if let Some(rest) = line.strip_prefix(s.item_level) {
            item.item_level = item.item_level.or(leading_number(rest));
        } else if let Some(rest) = line.strip_prefix(s.quality) {
            item.quality = item.quality.or(leading_number(rest));
        } else if let Some(rest) = line.strip_prefix(s.stack_size) {
            // «Stack Size: 2 448/40» — разделитель тысяч зависит от языка.
            let digits: String = rest.split('/').next().unwrap_or("").chars().filter(char::is_ascii_digit).collect();
            item.stack_size = item.stack_size.or(digits.parse().ok());
        } else if let Some(rest) = line.strip_prefix(s.sockets) {
            item.sockets = Some(parse_sockets(rest.trim()));
        } else if let Some(rest) = line.strip_prefix(s.map_tier_property) {
            item.map_tier = item.map_tier.or(leading_number(rest));
        }
    }
}

/// Первое число строки: `+20% (augmented)` → 20, `20 (Max)` → 20.
fn leading_number(text: &str) -> Option<u32> {
    let digits: String = text.trim_start_matches(|c: char| !c.is_ascii_digit()).chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

fn parse_sockets(text: &str) -> Sockets {
    let groups: Vec<&str> = text.split(' ').filter(|g| !g.is_empty()).collect();
    let sizes: Vec<u8> = groups.iter().map(|g| g.split('-').count() as u8).collect();
    Sockets {
        text: text.to_string(),
        count: sizes.iter().sum(),
        links: sizes.iter().copied().max().unwrap_or(0),
        white: text.chars().filter(|&c| c == 'W').count() as u8,
    }
}

fn is_mod_line_header(line: &str) -> bool {
    line.starts_with('{') && line.ends_with('}')
}

fn is_mod_section(section: &[&str]) -> bool {
    section.iter().any(|l| is_mod_line_header(l) || l.ends_with(ENCHANT_MARK) || l.ends_with(IMPLICIT_MARK) || l.ends_with(SCOURGE_MARK))
}

fn parse_mods(s: &Strings, section: &[&str], item: &mut ParsedItem) {
    if !is_mod_line_header(section[0]) {
        // Секция без заголовков: энчанты, проклятия Бича или собственные свойства обычным описанием.
        let kind = if section.iter().any(|l| l.ends_with(ENCHANT_MARK)) {
            ModKind::Enchant
        } else if section.iter().any(|l| l.ends_with(SCOURGE_MARK)) {
            ModKind::Scourge
        } else {
            ModKind::Implicit
        };
        let lines = section.iter().map(|l| strip_marks(l)).collect();
        item.mods.push(ParsedMod { kind, affix: None, name: None, tier: None, lines });
        return;
    }

    let mut current: Option<ParsedMod> = None;
    for line in section {
        if is_mod_line_header(line) {
            if let Some(done) = current.take() {
                item.mods.push(done);
            }
            current = Some(parse_header(s, line));
        } else if let Some(m) = current.as_mut() {
            // Строка-подсказка вроде «(Тег — описание)» к свойству не относится.
            if !(line.starts_with('(') && line.ends_with(')')) {
                m.lines.push(strip_marks(line));
            }
        }
    }
    item.mods.extend(current);
}

/// Заголовок свойства: `{ Prefix Modifier "Hale" (Tier: 7) — Life }`.
fn parse_header(s: &Strings, line: &str) -> ParsedMod {
    let inner = line.trim_start_matches('{').trim_end_matches('}').trim();
    let head = inner.split('\u{2014}').next().unwrap_or("").trim();
    let (kind_text, rest) = match head.find('"') {
        Some(at) => (head[..at].trim(), &head[at..]),
        None => match head.find('(') {
            Some(at) => (head[..at].trim(), &head[at..]),
            None => (head, ""),
        },
    };
    let name = rest.strip_prefix('"').and_then(|r| r.split('"').next()).map(str::to_string).filter(|n| !n.is_empty());
    let tier = rest.find('(').and_then(|at| leading_number(&rest[at..]));

    let (kind, affix) = if kind_text == s.prefix_modifier {
        (ModKind::Explicit, Some(Affix::Prefix))
    } else if kind_text == s.suffix_modifier {
        (ModKind::Explicit, Some(Affix::Suffix))
    } else if kind_text == s.crafted_prefix {
        (ModKind::Crafted, Some(Affix::Prefix))
    } else if kind_text == s.crafted_suffix {
        (ModKind::Crafted, Some(Affix::Suffix))
    } else if kind_text == s.fractured_prefix {
        (ModKind::Fractured, Some(Affix::Prefix))
    } else if kind_text == s.fractured_suffix {
        (ModKind::Fractured, Some(Affix::Suffix))
    } else if kind_text == s.implicit_modifier || kind_text == s.corrupted_implicit || kind_text.contains("Implicit") || kind_text.to_lowercase().contains("собственное свойство") {
        // Сюда же — собственные свойства Пожирателя, Экзарха и вояжа.
        (ModKind::Implicit, None)
    } else {
        // «Unique Modifier», «Foulborn Unique Modifier» и прочие — явные свойства без аффикса.
        (ModKind::Explicit, None)
    };
    ParsedMod { kind, affix, name, tier, lines: Vec::new() }
}

/// Убирает служебные пометки расширенного описания.
fn strip_marks(line: &str) -> String {
    let mut text = line.trim();
    for mark in [ENCHANT_MARK, IMPLICIT_MARK, SCOURGE_MARK, FRACTURED_MARK, CRAFTED_MARK] {
        if let Some(stripped) = text.strip_suffix(mark) {
            text = stripped;
        }
    }
    let text = text.split(" \u{2014} ").next().unwrap_or(text);
    text.trim().to_string()
}

/// Разметка условий в названиях (`<<set:MS>><<set:M>>…`, `<if:MS>{…}`): первое условие истинно.
fn clean_markup(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("<<set:") {
        out.push_str(&rest[..at]);
        rest = rest[at..].find(">>").map(|end| &rest[at + end + 2..]).unwrap_or("");
    }
    out.push_str(rest);
    let mut result = String::with_capacity(out.len());
    let mut rest = out.as_str();
    let mut taken = false;
    while let Some(at) = rest.find('<') {
        let Some(open) = rest[at..].find(">{").map(|o| at + o) else { break };
        let Some(close) = rest[open..].find('}').map(|c| open + c) else { break };
        result.push_str(&rest[..at]);
        let tag = &rest[at + 1..open];
        let body = &rest[open + 2..close];
        if tag.starts_with("if:") {
            result.push_str(body);
            taken = true;
        } else if !taken && tag == "else" {
            result.push_str(body);
        }
        rest = &rest[close + 1..];
    }
    result.push_str(rest);
    result.trim().trim_end_matches('\u{a0}').trim().to_string()
}

/// Чистит имя и базу от слов, которых нет в справочнике.
fn clean_names(s: &Strings, item: &mut ParsedItem) {
    let identified = !item.unidentified;

    // «Superior Vaal Regalia» / «Наряд ваал высокого качества» — у обычных и неопознанных.
    if item.rarity == Rarity::Normal || !identified {
        if let Some(p) = s.superior_prefix
            && let Some(rest) = item.name.strip_prefix(p) {
                item.name = rest.to_string();
            }
        if let Some(suffix) = s.superior_suffix
            && let Some(rest) = item.name.strip_suffix(suffix) {
                item.name = rest.to_string();
            }
    }

    if item.rarity == Rarity::Unique && identified {
        for p in s.foulborn_prefixes {
            if let Some(rest) = item.name.strip_prefix(p) {
                item.name = rest.to_string();
                item.foulborn = true;
                break;
            }
        }
    }

    // Синтезированная база.
    if item.synthesised {
        let target = item.base_type.as_mut().unwrap_or(&mut item.name);
        for p in s.synthesised_prefixes {
            if let Some(rest) = target.strip_prefix(p) {
                *target = rest.to_string();
                break;
            }
        }
    }

    // Тир и заражение карты — в имени (обычная, волшебная) или в базе (редкая, уникальная).
    for target in [Some(&mut item.name), item.base_type.as_mut()].into_iter().flatten() {
        if let Some(at) = target.rfind(s.map_tier_open)
            && target.ends_with(')')
                && let Some(tier) = leading_number(&target[at + s.map_tier_open.len()..]) {
                    item.map_tier = item.map_tier.or(Some(tier));
                    target.truncate(at);
                }
        for (prefix, blight) in s.blight_prefixes {
            if let Some(rest) = target.strip_prefix(prefix) {
                *target = rest.to_string();
                item.blight = Some(blight);
            }
        }
    }
}
