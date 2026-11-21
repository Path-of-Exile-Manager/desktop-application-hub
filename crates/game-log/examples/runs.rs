//! Boss runs from a `Client.txt`.
//!
//! ```text
//! cargo run -p game-log --example runs                              # both samples next to this file
//! cargo run -p game-log --example runs -- <file> [--character Name] # replay a log from its start
//! cargo run -p game-log --example runs -- --follow [<file>] [--character Name]
//! ```
//!
//! `--follow` without a file finds the log of the running game (window → process → exe), else of
//! an installed one, and prints what the game writes from now on (Ctrl+C to stop).

use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use chrono::{Local, NaiveDateTime};
use game_log::{parse_line, path, BossArena, LogEvent, RunEvent, RunTracker, Start, Tail, TrackerOptions};

/// A few arenas, as `areaIds` of `bosses.json` list them.
fn arenas() -> Vec<BossArena> {
    [
        ("the-shaper", "MapWorldsShapersRealm"),
        ("uber-elder", "MapWorldsElderArenaUber"),
        ("sirus", "AtlasExilesBoss5"),
        ("the-maven", "MavenBoss"),
        ("searing-exarch", "MapWorldsPrimordialBoss3"),
        ("eater-of-worlds", "MapWorldsPrimordialBoss4"),
    ]
    .into_iter()
    .map(|(boss, area)| BossArena::new(boss, vec![area.into()]))
    .collect()
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut file = None;
    let mut follow = false;
    let mut character = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--follow" => follow = true,
            "--character" => character = args.next(),
            _ => file = Some(PathBuf::from(arg)),
        }
    }

    if follow {
        let Some(log) = file.or_else(find_log) else {
            eprintln!("Client.txt not found: pass its path");
            std::process::exit(1);
        };
        follow_log(&log, character);
    } else if let Some(file) = file {
        replay(&file, character);
    } else {
        let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples");
        replay(&samples.join("sample-en.txt"), Some("Kirra_Witch".into()));
        replay(&samples.join("sample-ru.txt"), Some("Мирослава_Ведьма".into()));
    }
}

fn find_log() -> Option<PathBuf> {
    if let Some(window) = game_window::detect().window {
        match game_window::exe_path(window.pid) {
            Some(exe) => {
                println!("game: {}", exe.display());
                if let Some(log) = path::find_log_for_exe(&exe) {
                    return Some(log);
                }
            }
            None => println!("game window found, its process is not readable (elevated?)"),
        }
    }
    path::find_installed_log()
}

fn replay(file: &Path, character: Option<String>) {
    println!("== {} (character: {})", file.display(), character.as_deref().unwrap_or("any"));
    let mut tracker = RunTracker::new(arenas(), TrackerOptions::default());
    tracker.set_character(character);
    let mut tail = Tail::new(file, Start::Beginning);
    if !tail.is_open() {
        eprintln!("cannot open {}", file.display());
        return;
    }
    let mut last: Option<NaiveDateTime> = None;
    loop {
        let lines = tail.poll().expect("read log");
        if lines.is_empty() {
            break;
        }
        for line in lines {
            if let Some(entry) = parse_line(&line) {
                last = Some(entry.at);
                print_events(&tracker.push(&entry));
            }
        }
    }
    if let Some(at) = last {
        print_events(&tracker.finish(at));
    }
}

fn follow_log(file: &Path, character: Option<String>) {
    println!("following {} (character: {})", file.display(), character.as_deref().unwrap_or("any"));
    let mut tracker = RunTracker::new(arenas(), TrackerOptions::default());
    tracker.set_character(character);
    let mut tail = Tail::new(file, Start::End);
    loop {
        match tail.poll() {
            Ok(lines) => {
                for line in lines {
                    let Some(entry) = parse_line(&line) else { continue };
                    match &entry.event {
                        LogEvent::AreaGenerated { area_id, level, .. } => println!("{} area {area_id} (level {level})", entry.at),
                        LogEvent::AreaEntered { name } => println!("{} entered {name}", entry.at),
                        LogEvent::Died { character, .. } => println!("{} {character} died", entry.at),
                        LogEvent::LevelUp { character, class, level } => println!("{} {character} ({class}) level {level}", entry.at),
                    }
                    print_events(&tracker.push(&entry));
                }
            }
            Err(e) => eprintln!("read error: {e}"),
        }
        print_events(&tracker.tick(Local::now().naive_local()));
        thread::sleep(Duration::from_millis(500));
    }
}

fn print_events(events: &[RunEvent]) {
    for event in events {
        match event {
            RunEvent::Started { boss_id, area_id, at } => println!("  {at} start  {boss_id} ({area_id})"),
            RunEvent::Left { boss_id, at } => println!("  {at} left   {boss_id}"),
            RunEvent::Returned { boss_id, at } => println!("  {at} back   {boss_id}"),
            RunEvent::Discarded { boss_id, duration_sec, .. } => println!("  dropped {boss_id}: {duration_sec} s"),
            RunEvent::Finished(run) => println!(
                "  RUN {} {} → {}: {}, paused {}, deaths {}, overhead {}",
                run.boss_id,
                run.started_at.time(),
                run.ended_at.time(),
                clock(run.duration_sec),
                clock(run.paused_sec),
                run.deaths,
                run.overhead_sec.map_or("—".into(), clock),
            ),
        }
    }
}

fn clock(sec: i64) -> String {
    format!("{}:{:02}", sec / 60, sec % 60)
}
