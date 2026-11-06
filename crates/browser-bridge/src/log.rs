//! Лог моста. Stdout моста занят протоколом, поэтому пишем в файл
//! `%LOCALAPPDATA%\com.poemanager.desktop\logs\bridge.log`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config;

/// Больше — начинаем файл заново, чтобы лог не рос бесконечно.
const MAX_LOG_BYTES: u64 = 512 * 1024;

pub fn path() -> PathBuf {
    config::local_data_dir().join("logs").join("bridge.log")
}

pub fn write(message: &str) {
    let path = path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::remove_file(&path);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(file, "[{secs}] pid {} {message}", std::process::id());
    }
}
