//! Id устройства: UUID v7, создаётся при первом запуске и хранится в `device.json` папки данных.
//!
//! Уходит на сервер заголовком `X-Device-Id` в каждом запросе (лимиты анонимных запросов
//! считаются по нему и IP), а при входе в аккаунт становится id устройства в списке устройств.
//! Это не секрет: по нему нельзя ни войти, ни выйти. Расширение своего id не заводит —
//! с сервером общается только десктоп.

use std::fs;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::paths::{write_atomic, AppPaths};

const FILE: &str = "device.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceFile {
    device_id: Uuid,
}

/// Читает id из `device.json`, а если файла нет или он испорчен — создаёт новый и сохраняет.
/// Новый id означает для сервера новое устройство: прежний вход на этом компьютере придётся повторить.
pub fn load_or_create(paths: &AppPaths) -> Uuid {
    let path = paths.file(FILE);
    if let Some(id) = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<DeviceFile>(&bytes).ok()).map(|f| f.device_id) {
        return id;
    }
    let id = Uuid::now_v7();
    let bytes = serde_json::to_vec_pretty(&DeviceFile { device_id: id }).expect("serialize device.json");
    if let Err(e) = write_atomic(&path, &bytes) {
        // Без файла id проживёт до перезапуска — работать это не мешает.
        eprintln!("[device] не удалось сохранить {}: {e}", path.display());
    }
    id
}
