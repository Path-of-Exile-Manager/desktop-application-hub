//! One `Client.txt` line into an event.
//!
//! ```text
//! 2026/11/22 01:23:45 123456789 cff945b9 [DEBUG Client 1234] Generating level 83 area "MapWorldsShapersRealm" with seed 1234567
//! 2026/11/22 01:23:47 123458801 cffb0719 [INFO Client 1234] : You have entered The Shaper's Realm.
//! ```
//!
//! Date and time are the local time of the player's computer, then come a millisecond tick counter,
//! a hash and `[LEVEL Client <pid>]`. System messages (what the chat shows without a sender) start
//! with `: `; chat messages carry a channel sign and a sender (`#Name: …`, `@From Name: …`), so a
//! player cannot fake a system message by typing it. The texts are `BackendErrors` strings of the
//! game files (3.30): `EnteredArea`, `PlayerSlain`, `PlayerSuicide`, `LevelUp`.

use chrono::NaiveDateTime;
use serde::Serialize;

/// A line the crate understands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Local time written in the line (second precision).
    pub at: NaiveDateTime,
    pub event: LogEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LogEvent {
    /// A new instance of an area was created for the player: a new map, arena, or a hideout whose
    /// previous instance had closed. Returning to a living instance writes no such line.
    /// `Generating level 83 area "MapWorldsShapersRealm" with seed 1234567` — English in every client.
    AreaGenerated { level: u32, area_id: String, seed: u64 },
    /// The player entered an area, by its localized name: after every generation and when coming
    /// back to a living instance (through a portal, to the hideout).
    /// `You have entered The Shaper's Realm.` / `Вы вошли в область Владения Создателя.`
    AreaEntered { name: String },
    /// A character died, the player's own or a party member's.
    /// `Name has been slain.` / `Name был повержен.`; suicide: `Name has committed suicide.` /
    /// `Name покончил с собой`.
    Died { character: String, suicide: bool },
    /// A character reached a level: `Name (Necromancer) is now level 92` /
    /// `Name (Некромант) достигает 92 уровня`. Party members' level-ups are written too.
    LevelUp { character: String, class: String, level: u32 },
}

/// Parses one line (without the line break). `None` — a line of no interest or of another format.
pub fn parse_line(line: &str) -> Option<LogEntry> {
    let at = NaiveDateTime::parse_from_str(line.get(..19)?, "%Y/%m/%d %H:%M:%S").ok()?;
    let rest = line.get(19..)?;
    let open = rest.find('[')?;
    let close = open + rest[open..].find("] ")?;
    let body = rest[close + 2..].trim_end();
    let event = match body.strip_prefix(": ") {
        Some(message) => system_message(message)?,
        None => area_generated(body)?,
    };
    Some(LogEntry { at, event })
}

fn area_generated(body: &str) -> Option<LogEvent> {
    let rest = body.strip_prefix("Generating level ")?;
    let (level, rest) = rest.split_once(" area \"")?;
    let (area_id, rest) = rest.split_once('"')?;
    let seed = rest.trim().strip_prefix("with seed ")?;
    Some(LogEvent::AreaGenerated {
        level: level.parse().ok()?,
        area_id: area_id.to_owned(),
        seed: seed.parse().ok()?,
    })
}

const ENTERED: &[&str] = &["You have entered ", "Вы вошли в область "];
const SLAIN: &[&str] = &[" has been slain.", " был повержен."];
const SUICIDE: &[&str] = &[" has committed suicide", " покончил с собой"];

fn system_message(message: &str) -> Option<LogEvent> {
    if let Some(name) = ENTERED.iter().find_map(|prefix| message.strip_prefix(prefix)) {
        let name = name.strip_suffix('.').unwrap_or(name);
        return (!name.is_empty()).then(|| LogEvent::AreaEntered { name: name.to_owned() });
    }
    if let Some(character) = SLAIN.iter().find_map(|suffix| message.strip_suffix(suffix)) {
        return died(character, false);
    }
    let unpunctuated = message.strip_suffix('.').unwrap_or(message);
    if let Some(character) = SUICIDE.iter().find_map(|suffix| unpunctuated.strip_suffix(suffix)) {
        return died(character, true);
    }
    level_up(message)
}

fn died(character: &str, suicide: bool) -> Option<LogEvent> {
    is_character_name(character).then(|| LogEvent::Died { character: character.to_owned(), suicide })
}

/// `Name (Class) is now level 92` / `Name (Класс) достигает 92 уровня`.
fn level_up(message: &str) -> Option<LogEvent> {
    let (character, rest) = message.split_once(" (")?;
    let (class, rest) = rest.split_once(") ")?;
    let level = match rest.strip_prefix("is now level ") {
        Some(level) => level,
        None => rest.strip_prefix("достигает ")?.strip_suffix(" уровня")?,
    };
    if !is_character_name(character) || class.is_empty() {
        return None;
    }
    Some(LogEvent::LevelUp { character: character.to_owned(), class: class.to_owned(), level: level.parse().ok()? })
}

/// Character names have no spaces: letters, digits and underscores.
fn is_character_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(char::is_whitespace)
}
