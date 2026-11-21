//! Boss arena runs from log entries: a pure state machine, no I/O and no clock of its own.
//!
//! - A run starts with the generation of a boss arena (`Generating … area "<arena id>"`): every
//!   generation is a new instance, so a new run, even of the same arena.
//! - Leaving the arena for a town, hideout or league hub ([`is_safe_area`]) **pauses** the run:
//!   the player may come back through a portal after a death or to grab loot. Coming back to the
//!   living instance writes no generation, only `You have entered <arena name>`; the arena's
//!   name is the one entered right after its generation.
//! - The run **ends** when any other area is generated or an existing non-hub instance is
//!   entered, when another boss arena is generated, or when the player has not come back within
//!   [`TrackerOptions::return_timeout_sec`] (checked on every entry and by [`RunTracker::tick`]).
//!   It ends at the moment the player last left the arena.
//! - Duration = end − start − pauses. Runs shorter than [`TrackerOptions::min_run_sec`] are
//!   dropped (entered and left). Deaths are counted while in the arena: those of the configured
//!   character, or every death when no character is set.
//! - Overhead = from the end of the previous kept run of the same boss to the start of this one,
//!   when shorter than [`TrackerOptions::overhead_gap_sec`] (a longer gap is a break).

use std::collections::HashMap;

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::area::is_safe_area;
use crate::line::{LogEntry, LogEvent};

/// A boss and the `WorldAreas` ids of its arena (`areaIds` of `bosses.json`).
///
/// A regular fight and its uber version share the arena id (Shaper, Sirus, Maven, Exarch…) and
/// differ by the area level in `Generating level 85 area …`: the level bounds tell them apart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BossArena {
    pub boss_id: String,
    pub area_ids: Vec<String>,
    /// The arena counts for this boss only from this area level (the uber version: 85).
    pub min_level: Option<u32>,
    /// …and only up to this level (the regular version next to an uber one: 84).
    pub max_level: Option<u32>,
}

impl BossArena {
    /// An arena of any level.
    pub fn new(boss_id: impl Into<String>, area_ids: Vec<String>) -> Self {
        BossArena { boss_id: boss_id.into(), area_ids, min_level: None, max_level: None }
    }

    fn fits(&self, level: u32) -> bool {
        self.min_level.is_none_or(|min| level >= min) && self.max_level.is_none_or(|max| level <= max)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TrackerOptions {
    /// Shorter runs are dropped.
    pub min_run_sec: i64,
    /// A longer gap between two runs of a boss is a break, not overhead.
    pub overhead_gap_sec: i64,
    /// How long a paused run waits for the player to come back to its arena.
    pub return_timeout_sec: i64,
}

impl Default for TrackerOptions {
    fn default() -> Self {
        TrackerOptions { min_run_sec: 15, overhead_gap_sec: 600, return_timeout_sec: 600 }
    }
}

/// A finished run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossRun {
    pub boss_id: String,
    pub area_id: String,
    /// Arena generated (log local time).
    pub started_at: NaiveDateTime,
    /// The player last left the arena.
    pub ended_at: NaiveDateTime,
    /// Time in the arena: `ended_at − started_at − paused_sec`.
    pub duration_sec: i64,
    /// Time spent out of the arena (hideout, town) before coming back to it.
    pub paused_sec: i64,
    pub deaths: u32,
    /// From the end of the previous run of the same boss, when under `overhead_gap_sec`.
    pub overhead_sec: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunEvent {
    /// A boss arena was generated.
    Started { boss_id: String, area_id: String, at: NaiveDateTime },
    /// The player left the arena for a safe area; the run waits for a return.
    Left { boss_id: String, at: NaiveDateTime },
    /// The player came back to the same arena instance.
    Returned { boss_id: String, at: NaiveDateTime },
    Finished(BossRun),
    /// Ended shorter than `min_run_sec`.
    Discarded { boss_id: String, area_id: String, duration_sec: i64 },
}

/// The open run, for a status line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub boss_id: String,
    pub area_id: String,
    pub started_at: NaiveDateTime,
    pub deaths: u32,
    /// Out of the arena since then; `None` — in the arena.
    pub away_since: Option<NaiveDateTime>,
    /// Time already spent out of the arena and come back from.
    pub paused_sec: i64,
}

#[derive(Debug)]
struct OpenRun {
    boss_id: String,
    area_id: String,
    /// Localized name the arena was entered by; a return enters it by the same name.
    area_name: Option<String>,
    started_at: NaiveDateTime,
    deaths: u32,
    away_since: Option<NaiveDateTime>,
    paused_sec: i64,
}

#[derive(Debug)]
pub struct RunTracker {
    /// Arena area id → the bosses fought there, with their level bounds.
    arenas: HashMap<String, Vec<BossArena>>,
    character: Option<String>,
    options: TrackerOptions,
    run: Option<OpenRun>,
    /// Generated area waiting for its `You have entered` line.
    generated: Option<String>,
    /// Localized area name → area id, learned from generation + entering pairs.
    area_ids: HashMap<String, String>,
    /// Boss id → end of its last kept run.
    last_end: HashMap<String, NaiveDateTime>,
}

impl RunTracker {
    pub fn new(arenas: impl IntoIterator<Item = BossArena>, options: TrackerOptions) -> Self {
        let mut by_area: HashMap<String, Vec<BossArena>> = HashMap::new();
        for arena in arenas {
            for area in &arena.area_ids {
                by_area.entry(area.clone()).or_default().push(arena.clone());
            }
        }
        RunTracker {
            arenas: by_area,
            character: None,
            options,
            run: None,
            generated: None,
            area_ids: HashMap::new(),
            last_end: HashMap::new(),
        }
    }

    /// The player's character: only its deaths count. `None` — every death counts (solo play).
    pub fn set_character(&mut self, character: Option<String>) {
        self.character = character.filter(|name| !name.trim().is_empty());
    }

    pub fn character(&self) -> Option<&str> {
        self.character.as_deref()
    }

    pub fn current(&self) -> Option<RunState> {
        self.run.as_ref().map(|run| RunState {
            boss_id: run.boss_id.clone(),
            area_id: run.area_id.clone(),
            started_at: run.started_at,
            deaths: run.deaths,
            away_since: run.away_since,
            paused_sec: run.paused_sec,
        })
    }

    /// The boss fought in a generated area of this level, if any.
    fn boss_of(&self, area_id: &str, level: u32) -> Option<String> {
        self.arenas.get(area_id)?.iter().find(|arena| arena.fits(level)).map(|arena| arena.boss_id.clone())
    }

    /// Feeds one log entry, in log order.
    pub fn push(&mut self, entry: &LogEntry) -> Vec<RunEvent> {
        let mut events = self.tick(entry.at);
        let at = entry.at;
        match &entry.event {
            LogEvent::AreaGenerated { area_id, level, .. } => {
                self.generated = Some(area_id.clone());
                let boss = self.boss_of(area_id, *level);
                let pauses = boss.is_none() && is_safe_area(area_id);
                match self.run.as_mut() {
                    Some(run) if pauses => {
                        if run.away_since.is_none() {
                            run.away_since = Some(at);
                            events.push(RunEvent::Left { boss_id: run.boss_id.clone(), at });
                        }
                    }
                    Some(_) => events.extend(self.finish(at)),
                    None => {}
                }
                if let Some(boss_id) = boss {
                    events.push(RunEvent::Started { boss_id: boss_id.clone(), area_id: area_id.clone(), at });
                    self.run = Some(OpenRun {
                        boss_id,
                        area_id: area_id.clone(),
                        area_name: None,
                        started_at: at,
                        deaths: 0,
                        away_since: None,
                        paused_sec: 0,
                    });
                }
            }
            LogEvent::AreaEntered { name } => {
                if let Some(area_id) = self.generated.take() {
                    // The instance just generated: the transition was handled by its generation.
                    if let Some(run) = self.run.as_mut().filter(|run| run.area_id == area_id && run.away_since.is_none()) {
                        run.area_name.get_or_insert_with(|| name.clone());
                    }
                    self.area_ids.insert(name.clone(), area_id);
                } else {
                    events.extend(self.entered_existing(name, at));
                }
            }
            LogEvent::Died { character, .. } => {
                let own = self.character.as_deref().is_none_or(|own| own == character);
                if let Some(run) = self.run.as_mut().filter(|run| own && run.away_since.is_none()) {
                    run.deaths += 1;
                }
            }
            LogEvent::LevelUp { .. } => {}
        }
        events
    }

    /// Ends a paused run whose return window has passed by `now` (local time, as in the log).
    /// The caller may call it periodically so a run ends even when the log is quiet.
    pub fn tick(&mut self, now: NaiveDateTime) -> Vec<RunEvent> {
        match self.run.as_ref().and_then(|run| run.away_since) {
            Some(away) if (now - away).num_seconds() >= self.options.return_timeout_sec => self.finish(away),
            _ => Vec::new(),
        }
    }

    /// Ends the open run now (the game closed, tracking switched off).
    pub fn finish(&mut self, at: NaiveDateTime) -> Vec<RunEvent> {
        let Some(run) = self.run.take() else { return Vec::new() };
        let ended_at = run.away_since.unwrap_or(at).max(run.started_at);
        let duration_sec = (ended_at - run.started_at).num_seconds() - run.paused_sec;
        if duration_sec < self.options.min_run_sec {
            return vec![RunEvent::Discarded { boss_id: run.boss_id, area_id: run.area_id, duration_sec }];
        }
        let overhead_sec = self
            .last_end
            .get(&run.boss_id)
            .map(|previous| (run.started_at - *previous).num_seconds())
            .filter(|gap| (0..self.options.overhead_gap_sec).contains(gap));
        self.last_end.insert(run.boss_id.clone(), ended_at);
        vec![RunEvent::Finished(BossRun {
            boss_id: run.boss_id,
            area_id: run.area_id,
            started_at: run.started_at,
            ended_at,
            duration_sec,
            paused_sec: run.paused_sec,
            deaths: run.deaths,
            overhead_sec,
        })]
    }

    /// Entered a living instance (no generation before): back to the arena, a safe area, or
    /// somewhere else.
    fn entered_existing(&mut self, name: &str, at: NaiveDateTime) -> Vec<RunEvent> {
        let Some(run) = self.run.as_mut() else { return Vec::new() };
        let is_arena = run.area_name.as_deref() == Some(name);
        // Unknown names (an instance generated before tracking started) are taken as safe:
        // a hideout is by far the likeliest; the return timeout ends the run otherwise.
        let safe = self.area_ids.get(name).is_none_or(|id| is_safe_area(id));
        let away_since = run.away_since;
        match away_since {
            Some(away) if is_arena => {
                run.paused_sec += (at - away).num_seconds().max(0);
                run.away_since = None;
                vec![RunEvent::Returned { boss_id: run.boss_id.clone(), at }]
            }
            None if is_arena => Vec::new(),
            Some(_) if safe => Vec::new(),
            None if safe => {
                run.away_since = Some(at);
                vec![RunEvent::Left { boss_id: run.boss_id.clone(), at }]
            }
            _ => self.finish(at),
        }
    }
}
