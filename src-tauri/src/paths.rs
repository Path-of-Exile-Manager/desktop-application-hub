//! Папка данных приложения: `%LOCALAPPDATA%\com.poemanager.desktop\` (Tauri `app_local_data_dir`;
//! ту же папку использует мост с расширением — `browser_bridge::config`).
//!
//! Что в ней лежит (план — `shared/docs/desktop-integration.md`):
//! - `device.json` — id устройства;
//! - `datasets\`, `icons\`, `prices\` — кэш данных с сервера (Ф2–Ф4);
//! - `user.db` — данные пользователя (Ф8);
//! - `native-messaging\`, `logs\` — мост с расширением.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub struct AppPaths {
    root: PathBuf,
}

impl AppPaths {
    /// Находит папку данных и создаёт её, если её ещё нет.
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let root = app.path().app_local_data_dir().map_err(|e| format!("папка данных приложения: {e}"))?;
        fs::create_dir_all(&root).map_err(|e| format!("не удалось создать {}: {e}", root.display()))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

/// Записывает файл целиком или не трогает его: пишет во временный рядом и переименовывает.
/// На Windows `fs::rename` заменяет существующий файл (MoveFileEx с REPLACE_EXISTING).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}
