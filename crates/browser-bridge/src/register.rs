//! Регистрация хоста Native Messaging в Chrome (текущий пользователь, без прав администратора).
//!
//! - Манифест: `%LOCALAPPDATA%\com.poemanager.desktop\native-messaging\com.poemanager.bridge.json`.
//! - Ключ: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.poemanager.bridge` → путь к манифесту.
//!
//! Приложение вызывает [`register_chrome`] при каждом запуске: если exe переехал или обновился,
//! путь в манифесте исправится сам. Удаляет ключ деинсталлятор (src-tauri/windows/hooks.nsh).

use std::io;
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::config::{self, HOST_NAME};

pub const CHROME_KEY: &str = r"Software\Google\Chrome\NativeMessagingHosts\com.poemanager.bridge";

pub fn manifest_dir() -> PathBuf {
    config::local_data_dir().join("native-messaging")
}

/// Текст манифеста хоста.
pub fn manifest_json(exe: &Path, allowed_origins: &[String]) -> String {
    let manifest = json!({
        "name": HOST_NAME,
        // Латиницей: Chrome это поле не показывает, а с ASCII не бывает сюрпризов с кодировкой.
        "description": "poe-manager browser extension bridge",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": allowed_origins,
    });
    serde_json::to_string_pretty(&manifest).expect("JSON манифеста") + "\n"
}

/// Записать манифест (если изменился) и ключ реестра (если изменился). Возвращает путь к манифесту.
#[cfg(windows)]
pub fn register_chrome(exe: &Path, dir: &Path, allowed_origins: &[String]) -> io::Result<PathBuf> {
    use std::fs;
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    fs::create_dir_all(dir)?;
    let manifest = dir.join(format!("{HOST_NAME}.json"));
    let text = manifest_json(exe, allowed_origins);
    if fs::read_to_string(&manifest).ok().as_deref() != Some(text.as_str()) {
        fs::write(&manifest, text)?;
    }
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(CHROME_KEY)?;
    let value = manifest.to_string_lossy().to_string();
    if key.get_value::<String, _>("").ok().as_deref() != Some(value.as_str()) {
        key.set_value("", &value)?;
    }
    Ok(manifest)
}

#[cfg(not(windows))]
pub fn register_chrome(_exe: &Path, _dir: &Path, _allowed_origins: &[String]) -> io::Result<PathBuf> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "регистрация хоста реализована только для Windows"))
}

/// Путь к манифесту, на который сейчас указывает реестр (для диагностики).
#[cfg(windows)]
pub fn registered_manifest() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(CHROME_KEY).ok()?.get_value("").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_has_required_fields() {
        let text = manifest_json(Path::new(r"C:\Apps\poe-manager\poe-manager.exe"), &["chrome-extension://abc/".into()]);
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["name"], HOST_NAME);
        assert_eq!(value["type"], "stdio");
        assert_eq!(value["path"], r"C:\Apps\poe-manager\poe-manager.exe");
        assert_eq!(value["allowed_origins"][0], "chrome-extension://abc/");
    }
}
