//! Boss runs from the game log (`shared/docs/boss-farm.md`, 7.3) and the journal records they make
//! (7.4).
//!
//! A background thread finds `Client.txt` — the path chosen in Settings, else next to the
//! executable of the running game (`game_window::exe_path`), else in the usual install folders —
//! follows it from its end every 500 ms (`game_log::Tail`) and feeds `game_log::RunTracker` with the
//! arenas of `bosses.json` (rebuilt when a new dataset brings other arenas). The regular and the uber
//! fight share an arena id and differ by the area level: where an arena is shared, the uber boss
//! counts from level 85, the others up to 84. Deaths: only of the character named in Settings
//! (decision 13), every death when the name is empty.
//!
//! Events for the interface:
//! - `farm-log-status` — the switch, the file, the last line, the open run, an error;
//! - `farm-run` — a run started, left for a hideout, came back, ended (the "fight in progress"
//!   indicator);
//! - `boss-run-finished` — a run ended and was written to the journal (`bossKills`, `source: LOG`,
//!   `entryChaos` at current prices — decision 12) — the "record the drop?" toast.
//!
//! Quick drop (Ctrl+Alt+C on an item, `farm_drop_target` / `farm_add_drop`): an item from the drop
//! table of the open run's boss, or of the run finished in the last 10 minutes, adds a piece to that
//! run's record (an open run keeps it until the record is written).
//!
//! The interface sends the settings (`farm_log_configure`) on start and on every change; until then
//! the log is not read.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use farm_engine::{BossData, BossGroup, DropRef};
use game_log::{parse_line, path as log_path, BossArena, BossRun, RunEvent, RunState, RunTracker, Start, Tail, TrackerOptions};
use game_window::GameState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::dataset::DatasetService;
use crate::farm::{kill_prices, FarmText};
use crate::prices::PricesService;

pub const STATUS_EVENT: &str = "farm-log-status";
pub const RUN_EVENT: &str = "farm-run";
pub const FINISHED_EVENT: &str = "boss-run-finished";

const POLL: Duration = Duration::from_millis(500);
/// The running game's executable is looked up again when its process changes, at most this often.
const GAME_CHECK: Duration = Duration::from_secs(3);
/// Install folders are scanned when the game is not running, at most this often.
const INSTALLED_CHECK: Duration = Duration::from_secs(60);
/// The quick drop button works this long after a run ended.
const RECENT_MS: u64 = 10 * 60 * 1000;
/// Area level of the uber pinnacle fights; the regular ones sharing the arena are below it.
const UBER_LEVEL: u32 = 85;
const COLLECTION: &str = "bossKills";
const SECONDS_MAX: i64 = 86_400;
const QTY_MAX: u64 = 999;

// ---------- settings and status ----------

/// Settings → «Лог игры».
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct FarmLogSettings {
    /// «Читать лог игры» (on by default in the interface).
    pub enabled: bool,
    /// `Client.txt` chosen by hand; empty — found automatically.
    pub path: Option<String>,
    /// The player's character: only its deaths count; empty — every death in the arena.
    pub character: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FarmLogState {
    /// Switched off (or the interface has not sent the settings yet).
    Off,
    /// No log found yet: the game is not running and no install was found.
    Searching,
    /// The file does not exist (yet): waiting for it.
    Waiting,
    Reading,
    /// The file exists but cannot be read.
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FarmLogPathSource {
    /// Chosen in Settings.
    Manual,
    /// Next to the executable of the running (or last seen) game.
    Game,
    /// Found in an install folder (Program Files, Steam libraries, Epic).
    Installed,
}

/// The open run, for the "fight in progress" indicator. Times — ms since the epoch.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmRunState {
    pub boss_id: String,
    pub boss_name: FarmText,
    pub area_id: String,
    pub started_at: u64,
    /// Out of the arena since then; `null` — in the arena.
    pub away_since: Option<u64>,
    /// Time already spent out of the arena and come back from.
    pub paused_sec: u32,
    pub deaths: u32,
    /// Pieces added by Ctrl+Alt+C while the run is open (written with the record).
    pub pending_drops: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmLogStatus {
    pub state: FarmLogState,
    pub path: Option<String>,
    pub path_source: Option<FarmLogPathSource>,
    /// When the last line was read, ms.
    pub last_line_at: Option<u64>,
    /// Bosses with an arena in the current `bosses.json`; 0 — no table, runs are not recognized.
    pub arenas: u32,
    pub character: Option<String>,
    pub run: Option<FarmRunState>,
    pub error: Option<String>,
}

impl Default for FarmLogStatus {
    fn default() -> Self {
        FarmLogStatus { state: FarmLogState::Off, path: None, path_source: None, last_line_at: None, arenas: 0, character: None, run: None, error: None }
    }
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FarmRunKind {
    Started,
    Left,
    Returned,
    /// Ended and written to the journal (`boss-run-finished` follows).
    Finished,
    /// Ended shorter than 15 s: not a run.
    Discarded,
}

/// `farm-run`: what happened and the open run after it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmRunUpdate {
    pub kind: FarmRunKind,
    pub boss_id: String,
    pub run: Option<FarmRunState>,
}

/// A finished run. Times — ISO UTC.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmBossRun {
    pub boss_id: String,
    pub area_id: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_sec: u32,
    pub paused_sec: u32,
    pub deaths: u32,
    pub overhead_sec: Option<u32>,
}

/// `boss-run-finished`: the run and its journal record (`killId`; `null` — not written, see `error`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BossRunFinished {
    pub run: FarmBossRun,
    pub boss_id: String,
    pub boss_name: FarmText,
    pub league: Option<String>,
    pub kill_id: Option<String>,
    /// Pieces already added by Ctrl+Alt+C during the run.
    pub drops: u32,
    pub error: Option<String>,
}

/// Where Ctrl+Alt+C on an item can add it: the open run or the last finished one.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FarmDropTarget {
    pub boss_id: String,
    pub boss_name: FarmText,
    /// Drop key in the boss's pools.
    pub key: String,
    /// The record; `null` — the run is still open.
    pub kill_id: Option<String>,
    /// The run ended (or, while open, started) at, ms.
    pub at: u64,
    pub running: bool,
    /// Pieces of this drop already recorded for the run.
    pub qty: u32,
}

// ---------- service ----------

/// The last finished run, for the quick drop button.
#[derive(Debug, Clone)]
struct LastRun {
    boss_id: String,
    kill_id: String,
    ended_at: u64,
}

pub struct FarmLogService {
    settings: Mutex<Option<FarmLogSettings>>,
    status: Mutex<FarmLogStatus>,
    last: Mutex<Option<LastRun>>,
    /// Drop key → pieces, added while the run is open.
    pending: Mutex<BTreeMap<String, u32>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Log local time → ms since the epoch.
fn local_ms(at: NaiveDateTime) -> u64 {
    Local.from_local_datetime(&at).earliest().map_or(0, |t| t.timestamp_millis().max(0) as u64)
}

/// Log local time → ISO UTC with milliseconds (`2026-11-22T15:01:10.000Z`).
fn local_iso(at: NaiveDateTime) -> String {
    let utc: DateTime<Utc> = Local.from_local_datetime(&at).earliest().map_or_else(|| Utc.from_utc_datetime(&at), |t| t.with_timezone(&Utc));
    utc.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn seconds(value: i64) -> u32 {
    value.clamp(0, SECONDS_MAX) as u32
}

pub fn start(app: &AppHandle) {
    app.manage(FarmLogService {
        settings: Mutex::new(None),
        status: Mutex::new(FarmLogStatus::default()),
        last: Mutex::new(None),
        pending: Mutex::new(BTreeMap::new()),
    });
    let app = app.clone();
    let _ = thread::Builder::new().name("farm-log".into()).spawn(move || {
        let mut worker = Worker::default();
        loop {
            worker.step(&app);
            thread::sleep(POLL);
        }
    });
}

fn boss_table(app: &AppHandle) -> Option<std::sync::Arc<BossData>> {
    let catalog = app.state::<DatasetService>().catalog()?;
    match &catalog.bosses {
        Some(Ok(data)) => Some(data.clone()),
        _ => None,
    }
}

fn boss_name(data: Option<&BossData>, boss_id: &str) -> FarmText {
    data.and_then(|d| d.boss(boss_id)).map_or_else(|| FarmText { en: boss_id.to_owned(), ru: None }, |b| (&b.name).into())
}

/// Arenas of the table. A shared arena id (a regular fight and its uber version) is told apart by
/// the area level: uber bosses from 85, the others up to 84.
fn arenas_of(data: &BossData) -> Vec<BossArena> {
    let mut uses: HashMap<&str, u32> = HashMap::new();
    for id in data.bosses.iter().filter_map(|b| b.area_ids.as_ref()).flatten() {
        *uses.entry(id.as_str()).or_default() += 1;
    }
    data.bosses
        .iter()
        .filter_map(|boss| {
            let ids = boss.area_ids.as_ref().filter(|ids| !ids.is_empty())?;
            let mut arena = BossArena::new(boss.id.clone(), ids.clone());
            if ids.iter().any(|id| uses.get(id.as_str()).is_some_and(|n| *n > 1)) {
                if matches!(boss.group, BossGroup::PinnacleUber) {
                    arena.min_level = Some(UBER_LEVEL);
                } else {
                    arena.max_level = Some(UBER_LEVEL - 1);
                }
            }
            Some(arena)
        })
        .collect()
}

/// The drop key of a catalog item in a boss's pools: by `itemId`, or by the item of a special quote.
fn drop_key(data: &BossData, boss_id: &str, item_id: &str) -> Option<String> {
    let boss = data.boss(boss_id)?;
    boss.pools.iter().flat_map(|p| &p.entries).find_map(|entry| {
        let matches = match &entry.drop_ref {
            DropRef::Item { item_id: id, .. } => id == item_id,
            DropRef::Quote { quote } => data.quote(quote).and_then(|q| q.item_id.as_deref()) == Some(item_id),
            _ => false,
        };
        matches.then(|| entry.key.clone())
    })
}

// ---------- the reading thread ----------

#[derive(Default)]
struct Worker {
    tail: Option<Tail>,
    source: Option<FarmLogPathSource>,
    tracker: Option<RunTracker>,
    arenas: Vec<BossArena>,
    character: Option<String>,
    /// The game process whose log was looked up, and the log found.
    game_pid: Option<u32>,
    game_log: Option<PathBuf>,
    game_checked: Option<Instant>,
    installed: Option<PathBuf>,
    installed_checked: Option<Instant>,
    /// Time of the last understood line (log local time).
    last_entry: Option<NaiveDateTime>,
    last_line_at: Option<u64>,
    error: Option<String>,
}

impl Worker {
    fn step(&mut self, app: &AppHandle) {
        let service = app.state::<FarmLogService>();
        let settings = service.settings.lock().unwrap().clone();
        let data = boss_table(app);

        let Some(settings) = settings.filter(|s| s.enabled) else {
            // Switched off: an open run ends where the log was last read.
            if let (Some(tracker), Some(at)) = (self.tracker.as_mut(), self.last_entry) {
                let events = tracker.finish(at);
                self.handle(app, data.as_deref(), events);
            }
            self.tail = None;
            self.source = None;
            self.error = None;
            self.publish(app, data.as_deref(), FarmLogState::Off);
            return;
        };

        // Arenas of the current table: a new set — a new tracker.
        let arenas = data.as_deref().map(arenas_of).unwrap_or_default();
        if self.tracker.is_none() || arenas != self.arenas {
            self.tracker = Some(RunTracker::new(arenas.clone(), TrackerOptions::default()));
            self.arenas = arenas;
            service.pending.lock().unwrap().clear();
        }
        let character = settings.character.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(str::to_owned);
        let tracker = self.tracker.as_mut().expect("tracker");
        if tracker.character() != character.as_deref() {
            tracker.set_character(character.clone());
        }
        self.character = character;

        let game = crate::game::current(app);
        let (path, source) = self.resolve_path(&settings, &game);
        let Some(path) = path else {
            self.tail = None;
            self.source = None;
            self.publish(app, data.as_deref(), FarmLogState::Searching);
            return;
        };
        if self.tail.as_ref().is_none_or(|t| t.path() != path) {
            self.tail = Some(Tail::new(&path, Start::End));
            self.error = None;
        }
        self.source = source;

        let mut events = Vec::new();
        let tail = self.tail.as_mut().expect("tail");
        match tail.poll() {
            Ok(lines) => {
                self.error = None;
                if !lines.is_empty() {
                    self.last_line_at = Some(now_ms());
                }
                let tracker = self.tracker.as_mut().expect("tracker");
                for line in lines {
                    if let Some(entry) = parse_line(&line) {
                        self.last_entry = Some(entry.at);
                        events.extend(tracker.push(&entry));
                    }
                }
            }
            Err(e) => self.error = Some(format!("лог не читается: {e}")),
        }
        let tracker = self.tracker.as_mut().expect("tracker");
        events.extend(tracker.tick(Local::now().naive_local()));
        // The game closed in the middle of a run: it ends where the log stopped.
        if game.state == GameState::NotRunning
            && tracker.current().is_some_and(|run| run.away_since.is_none())
            && let Some(at) = self.last_entry
        {
            events.extend(tracker.finish(at));
        }
        self.handle(app, data.as_deref(), events);

        let state = if self.error.is_some() {
            FarmLogState::Error
        } else if self.tail.as_ref().is_some_and(Tail::is_open) {
            FarmLogState::Reading
        } else {
            FarmLogState::Waiting
        };
        self.publish(app, data.as_deref(), state);
    }

    /// Settings path, else the log next to the running (or last seen) game, else an installed one.
    fn resolve_path(&mut self, settings: &FarmLogSettings, game: &game_window::GameStatus) -> (Option<PathBuf>, Option<FarmLogPathSource>) {
        if let Some(manual) = settings.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            return (Some(PathBuf::from(manual)), Some(FarmLogPathSource::Manual));
        }
        let pid = game.window.as_ref().filter(|_| game.state == GameState::Running).map(|w| w.pid);
        if let Some(pid) = pid {
            let due = self.game_pid != Some(pid) || (self.game_log.is_none() && self.game_checked.is_none_or(|at| at.elapsed() >= GAME_CHECK));
            if due {
                self.game_checked = Some(Instant::now());
                self.game_pid = Some(pid);
                // The log may not exist yet on a fresh install: follow the path it will have.
                if let Some(exe) = game_window::exe_path(pid) {
                    self.game_log = log_path::find_log_for_exe(&exe).or_else(|| log_path::log_path_for_exe(&exe));
                }
            }
        }
        if let Some(log) = &self.game_log {
            return (Some(log.clone()), Some(FarmLogPathSource::Game));
        }
        if self.installed.is_none() && self.installed_checked.is_none_or(|at| at.elapsed() >= INSTALLED_CHECK) {
            self.installed_checked = Some(Instant::now());
            self.installed = log_path::find_installed_log();
        }
        match &self.installed {
            Some(log) => (Some(log.clone()), Some(FarmLogPathSource::Installed)),
            None => (None, None),
        }
    }

    fn handle(&self, app: &AppHandle, data: Option<&BossData>, events: Vec<RunEvent>) {
        let service = app.state::<FarmLogService>();
        for event in events {
            match event {
                RunEvent::Started { boss_id, .. } => {
                    service.pending.lock().unwrap().clear();
                    self.emit_run(app, data, FarmRunKind::Started, boss_id);
                }
                RunEvent::Left { boss_id, .. } => self.emit_run(app, data, FarmRunKind::Left, boss_id),
                RunEvent::Returned { boss_id, .. } => self.emit_run(app, data, FarmRunKind::Returned, boss_id),
                RunEvent::Discarded { boss_id, .. } => {
                    service.pending.lock().unwrap().clear();
                    self.emit_run(app, data, FarmRunKind::Discarded, boss_id);
                }
                RunEvent::Finished(run) => {
                    let pending = std::mem::take(&mut *service.pending.lock().unwrap());
                    let name = boss_name(data, &run.boss_id);
                    self.emit_run(app, data, FarmRunKind::Finished, run.boss_id.clone());
                    // Prices may need a request (special quotes): off the reading thread.
                    let app = app.clone();
                    let _ = thread::Builder::new().name("farm-log-kill".into()).spawn(move || finish_run(&app, run, name, pending));
                }
            }
        }
    }

    fn run_state(&self, app: &AppHandle, data: Option<&BossData>) -> Option<FarmRunState> {
        let run: RunState = self.tracker.as_ref()?.current()?;
        let pending = app.state::<FarmLogService>().pending.lock().unwrap().values().sum();
        Some(FarmRunState {
            boss_name: boss_name(data, &run.boss_id),
            boss_id: run.boss_id,
            area_id: run.area_id,
            started_at: local_ms(run.started_at),
            away_since: run.away_since.map(local_ms),
            paused_sec: seconds(run.paused_sec),
            deaths: run.deaths,
            pending_drops: pending,
        })
    }

    fn emit_run(&self, app: &AppHandle, data: Option<&BossData>, kind: FarmRunKind, boss_id: String) {
        let run = self.run_state(app, data);
        app.state::<FarmLogService>().status.lock().unwrap().run = run.clone();
        let _ = app.emit(RUN_EVENT, FarmRunUpdate { kind, boss_id, run });
    }

    fn publish(&self, app: &AppHandle, data: Option<&BossData>, state: FarmLogState) {
        let status = FarmLogStatus {
            state,
            path: self.tail.as_ref().map(|t| t.path().display().to_string()),
            path_source: self.source,
            last_line_at: self.last_line_at,
            arenas: self.arenas.len() as u32,
            character: self.character.clone(),
            run: if state == FarmLogState::Off { None } else { self.run_state(app, data) },
            error: self.error.clone(),
        };
        let service = app.state::<FarmLogService>();
        let mut current = service.status.lock().unwrap();
        if *current != status {
            *current = status.clone();
            drop(current);
            let _ = app.emit(STATUS_EVENT, status);
        }
    }
}

/// Writes a finished run to the journal and tells the interface.
fn finish_run(app: &AppHandle, run: BossRun, boss_name: FarmText, pending: BTreeMap<String, u32>) {
    let view = FarmBossRun {
        boss_id: run.boss_id.clone(),
        area_id: run.area_id.clone(),
        started_at: local_iso(run.started_at),
        ended_at: local_iso(run.ended_at),
        duration_sec: seconds(run.duration_sec),
        paused_sec: seconds(run.paused_sec),
        deaths: run.deaths.min(100),
        overhead_sec: run.overhead_sec.map(seconds),
    };
    let league = app.state::<PricesService>().league();
    let drops: u32 = pending.values().sum();
    let written = match &league {
        None => Err("лига не выбрана — убийство не записано".to_owned()),
        Some(league) => write_kill(app, league, &view, &pending),
    };
    let (kill_id, error) = match written {
        Ok(id) => {
            *app.state::<FarmLogService>().last.lock().unwrap() = Some(LastRun { boss_id: run.boss_id.clone(), kill_id: id.clone(), ended_at: local_ms(run.ended_at) });
            (Some(id), None)
        }
        Err(e) => (None, Some(e)),
    };
    let _ = app.emit(FINISHED_EVENT, BossRunFinished { boss_id: run.boss_id.clone(), boss_name, run: view, league, kill_id, drops, error });
}

fn write_kill(app: &AppHandle, league: &str, run: &FarmBossRun, pending: &BTreeMap<String, u32>) -> Result<String, String> {
    let prices = kill_prices(app, league, &run.boss_id, &[])?;
    let drops: Vec<Value> = pending
        .iter()
        .map(|(key, qty)| json!({ "key": key, "qty": (*qty).min(QTY_MAX as u32), "chaos": prices.drops.get(key).copied().flatten() }))
        .collect();
    let record = json!({
        "bossId": run.boss_id,
        "league": league,
        "dataVersion": prices.data_version,
        "at": run.ended_at,
        "durationSec": run.duration_sec,
        "overheadSec": run.overhead_sec,
        "pausedSec": run.paused_sec,
        "deaths": run.deaths,
        "source": "LOG",
        "killed": true,
        "dropsRecorded": !drops.is_empty(),
        "drops": drops,
        "extra": [],
        "entryChaos": prices.entry_chaos,
    });
    let saved = crate::sync::put_record(app, COLLECTION, record)?;
    saved.get("id").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "у записи нет id".to_owned())
}

/// One more piece of a drop in a journal record; the price of a new line — of this moment.
fn add_to_record(app: &AppHandle, kill_id: &str, key: &str) -> Result<u32, String> {
    let mut record = crate::sync::get_record(app, COLLECTION, kill_id).ok_or("запись убийства удалена")?;
    let league = record.get("league").and_then(Value::as_str).unwrap_or_default().to_owned();
    let boss_id = record.get("bossId").and_then(Value::as_str).unwrap_or_default().to_owned();
    let obj = record.as_object_mut().ok_or("запись убийства повреждена")?;
    let mut drops: Vec<Value> = obj.get("drops").and_then(Value::as_array).cloned().unwrap_or_default();
    let qty = match drops.iter_mut().find(|d| d.get("key").and_then(Value::as_str) == Some(key)) {
        Some(line) => {
            let qty = (line.get("qty").and_then(Value::as_u64).unwrap_or(0) + 1).min(QTY_MAX);
            line["qty"] = json!(qty);
            qty
        }
        None => {
            let chaos = kill_prices(app, &league, &boss_id, &[]).ok().and_then(|p| p.drops.get(key).copied().flatten());
            drops.push(json!({ "key": key, "qty": 1, "chaos": chaos }));
            1
        }
    };
    obj.insert("drops".into(), Value::Array(drops));
    obj.insert("dropsRecorded".into(), Value::Bool(true));
    obj.insert("killed".into(), Value::Bool(true));
    crate::sync::put_record(app, COLLECTION, record)?;
    Ok(qty as u32)
}

/// The run Ctrl+Alt+C on this item adds to: the open one, else the one finished in the last 10 min.
fn drop_target(app: &AppHandle, item_id: &str) -> Option<FarmDropTarget> {
    let data = boss_table(app)?;
    let service = app.state::<FarmLogService>();
    let open = service.status.lock().unwrap().run.clone();
    if let Some(run) = open
        && let Some(key) = drop_key(&data, &run.boss_id, item_id)
    {
        let qty = service.pending.lock().unwrap().get(&key).copied().unwrap_or(0);
        return Some(FarmDropTarget { boss_name: run.boss_name, boss_id: run.boss_id, key, kill_id: None, at: run.started_at, running: true, qty });
    }
    let last = service.last.lock().unwrap().clone()?;
    if now_ms().saturating_sub(last.ended_at) > RECENT_MS {
        return None;
    }
    let key = drop_key(&data, &last.boss_id, item_id)?;
    let record = crate::sync::get_record(app, COLLECTION, &last.kill_id)?;
    let qty = record
        .get("drops")
        .and_then(Value::as_array)
        .and_then(|drops| drops.iter().find(|d| d.get("key").and_then(Value::as_str) == Some(key.as_str())))
        .and_then(|d| d.get("qty").and_then(Value::as_u64))
        .unwrap_or(0) as u32;
    Some(FarmDropTarget { boss_name: boss_name(Some(&data), &last.boss_id), boss_id: last.boss_id, key, kill_id: Some(last.kill_id), at: last.ended_at, running: false, qty })
}

// ---------- native file picker ----------

/// The Windows "Open" dialog for `Client.txt`, owned by the main window. `None` — cancelled.
#[cfg(windows)]
fn pick_file(owner: Option<isize>, current: Option<&Path>) -> Option<String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::Dialogs::{GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST, OPENFILENAMEW};

    let wide = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let filter = wide("Лог игры (Client.txt)\0Client.txt;LatestClient.txt\0Текстовые файлы (*.txt)\0*.txt\0\0");
    let mut title = wide("Файл лога Path of Exile — logs\\Client.txt");
    title.push(0);
    let mut initial_dir: Vec<u16> = current.and_then(Path::parent).map(|p| wide(&p.display().to_string())).unwrap_or_default();
    initial_dir.push(0);
    let mut file = vec![0u16; 2048];
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: HWND(owner.unwrap_or(0) as *mut core::ffi::c_void),
        lpstrFilter: PCWSTR(filter.as_ptr()),
        lpstrFile: PWSTR(file.as_mut_ptr()),
        nMaxFile: file.len() as u32,
        lpstrInitialDir: if initial_dir.len() > 1 { PCWSTR(initial_dir.as_ptr()) } else { PCWSTR::null() },
        lpstrTitle: PCWSTR(title.as_ptr()),
        Flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY | OFN_NOCHANGEDIR,
        ..Default::default()
    };
    // SAFETY: every pointer in `ofn` points into buffers that outlive the call.
    let ok = unsafe { GetOpenFileNameW(&mut ofn) }.as_bool();
    if !ok {
        return None;
    }
    let len = file.iter().position(|&c| c == 0).unwrap_or(file.len());
    Some(String::from_utf16_lossy(&file[..len]))
}

#[cfg(not(windows))]
fn pick_file(_owner: Option<isize>, _current: Option<&Path>) -> Option<String> {
    None
}

// ---------- commands ----------

/// Settings from the interface: on start and on every change.
#[tauri::command]
pub fn farm_log_configure(app: AppHandle, settings: FarmLogSettings) {
    *app.state::<FarmLogService>().settings.lock().unwrap() = Some(settings);
}

#[tauri::command]
pub fn farm_log_status(app: AppHandle) -> FarmLogStatus {
    app.state::<FarmLogService>().status.lock().unwrap().clone()
}

/// "Choose file…": the native open dialog; `null` — cancelled.
#[tauri::command]
pub async fn farm_log_pick_file(app: AppHandle, current: Option<String>) -> Result<Option<String>, String> {
    let owner = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || pick_file(owner, current.as_deref().map(Path::new))).await.map_err(|e| e.to_string())
}

/// Whether Ctrl+Alt+C on this catalog item can add it to a run's drop.
#[tauri::command]
pub async fn farm_drop_target(app: AppHandle, item_id: String) -> Option<FarmDropTarget> {
    tauri::async_runtime::spawn_blocking(move || drop_target(&app, &item_id)).await.ok().flatten()
}

/// Adds one piece of the item to the run `farm_drop_target` names. Returns the target after it.
#[tauri::command]
pub async fn farm_add_drop(app: AppHandle, item_id: String) -> Result<FarmDropTarget, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = drop_target(&app, &item_id).ok_or("предмета нет в дропе босса последнего захода")?;
        let qty = match &target.kill_id {
            Some(kill_id) => add_to_record(&app, kill_id, &target.key)?,
            None => {
                let service = app.state::<FarmLogService>();
                let (qty, total) = {
                    let mut pending = service.pending.lock().unwrap();
                    let qty = pending.entry(target.key.clone()).or_default();
                    *qty = (*qty + 1).min(QTY_MAX as u32);
                    let qty = *qty;
                    (qty, pending.values().sum())
                };
                let status = {
                    let mut status = service.status.lock().unwrap();
                    if let Some(run) = status.run.as_mut() {
                        run.pending_drops = total;
                    }
                    status.clone()
                };
                let _ = app.emit(STATUS_EVENT, status);
                qty
            }
        };
        Ok(FarmDropTarget { qty, ..target })
    })
    .await
    .map_err(|e| e.to_string())?
}
