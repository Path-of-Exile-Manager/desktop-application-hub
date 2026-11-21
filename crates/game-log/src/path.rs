//! Where `Client.txt` is.
//!
//! The game writes `logs\Client.txt` next to its executable — the same for the standalone client
//! (`PathOfExile.exe`, `PathOfExile_x64.exe`), Steam (`PathOfExileSteam.exe`,
//! `PathOfExile_x64Steam.exe`) and Epic (`PathOfExileEGS.exe`); the file only grows. Recent clients
//! also write `logs\LatestClient.txt` with the current session only; it is a fallback when
//! `Client.txt` is missing.
//!
//! The executable of the running game: `game_window::detect()` gives the window's `pid`,
//! `game_window::exe_path(pid)` its path, [`find_log_for_exe`] the log.

use std::fs;
use std::path::{Path, PathBuf};

pub const LOG_FILE: &str = "Client.txt";
pub const LATEST_LOG_FILE: &str = "LatestClient.txt";

/// `<folder of exe>\logs\Client.txt`, whether it exists or not.
pub fn log_path_for_exe(exe: &Path) -> Option<PathBuf> {
    Some(exe.parent()?.join("logs").join(LOG_FILE))
}

/// The existing log next to the game executable: `Client.txt`, else `LatestClient.txt`.
pub fn find_log_for_exe(exe: &Path) -> Option<PathBuf> {
    find_log_in_install(exe.parent()?)
}

/// The existing log of an install folder (the one holding the executable).
pub fn find_log_in_install(install: &Path) -> Option<PathBuf> {
    let logs = install.join("logs");
    [LOG_FILE, LATEST_LOG_FILE].iter().map(|name| logs.join(name)).find(|path| path.is_file())
}

/// Usual install folders: standalone under Program Files, Epic, every Steam library
/// (`steamapps\libraryfolders.vdf` of Steam in Program Files). Not checked for existence.
pub fn install_candidates() -> Vec<PathBuf> {
    let program_files: Vec<PathBuf> = ["ProgramFiles(x86)", "ProgramFiles"]
        .iter()
        .filter_map(|var| std::env::var_os(var).map(PathBuf::from))
        .chain([PathBuf::from(r"C:\Program Files (x86)"), PathBuf::from(r"C:\Program Files")])
        .collect();

    let mut candidates = Vec::new();
    for root in &program_files {
        candidates.push(root.join("Grinding Gear Games").join("Path of Exile"));
        candidates.push(root.join("Epic Games").join("PathOfExile"));
    }
    let mut libraries: Vec<PathBuf> = program_files.iter().map(|root| root.join("Steam")).collect();
    for steam in libraries.clone() {
        libraries.extend(steam_libraries(&steam.join("steamapps").join("libraryfolders.vdf")));
    }
    candidates.extend(libraries.iter().map(|library| library.join("steamapps").join("common").join("Path of Exile")));

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|seen: &PathBuf| same_path(seen, &candidate)) {
            unique.push(candidate);
        }
    }
    unique
}

/// The log of an installed game when the game is not running: among the usual install folders
/// with a log, the one written last (a player may have both Steam and standalone installs).
pub fn find_installed_log() -> Option<PathBuf> {
    install_candidates()
        .iter()
        .filter_map(|install| find_log_in_install(install))
        .max_by_key(|log| fs::metadata(log).and_then(|m| m.modified()).ok())
}

/// Library folders from Steam's `libraryfolders.vdf`: lines `"path"  "D:\\SteamLibrary"`.
fn steam_libraries(vdf: &Path) -> Vec<PathBuf> {
    let Ok(text) = fs::read_to_string(vdf) else { return Vec::new() };
    text.lines()
        .filter_map(|line| {
            let mut quoted = line.split('"').skip(1).step_by(2);
            match (quoted.next(), quoted.next()) {
                (Some("path"), Some(value)) => Some(PathBuf::from(value.replace(r"\\", r"\"))),
                _ => None,
            }
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
}
