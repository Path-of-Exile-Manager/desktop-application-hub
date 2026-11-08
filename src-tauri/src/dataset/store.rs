//! Наборы данных на диске: `datasets\<id>\` (манифест и файлы) и `datasets\current` (id текущего).
//!
//! Новый набор сначала целиком собирается в `datasets\<id>.part\`, проверяется и только потом
//! переименовывается и становится текущим: обрыв посреди загрузки не трогает рабочий набор.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::model::Manifest;
use crate::paths::write_atomic;

const CURRENT: &str = "current";
const MANIFEST: &str = "manifest.json";
/// Сколько наборов держать: текущий и один прошлый (откат, если новый окажется битым).
const KEEP: usize = 2;

pub struct DatasetStore {
    root: PathBuf,
}

impl DatasetStore {
    pub fn new(app_root: &Path) -> Self {
        Self { root: app_root.join("datasets") }
    }

    pub fn current_id(&self) -> Option<String> {
        let id = fs::read_to_string(self.root.join(CURRENT)).ok()?;
        let id = id.trim();
        is_dataset_id(id).then(|| id.to_string())
    }

    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    pub fn read_manifest(&self, id: &str) -> Result<Manifest, String> {
        let bytes = fs::read(self.dir(id).join(MANIFEST)).map_err(|e| format!("манифест набора {id}: {e}"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("манифест набора {id} не разобран: {e}"))
    }

    /// Файл набора, проверенный по sha256 и размеру из манифеста.
    pub fn read_file(&self, id: &str, manifest: &Manifest, name: &str) -> Result<Vec<u8>, String> {
        let entry = manifest.files.iter().find(|f| f.name == name).ok_or_else(|| format!("в манифесте нет {name}"))?;
        let bytes = fs::read(self.dir(id).join(name)).map_err(|e| format!("{name}: {e}"))?;
        verify(name, &bytes, entry.size, &entry.sha256)?;
        Ok(bytes)
    }

    /// Кладёт набор целиком и делает его текущим. `files` — уже проверенные байты.
    pub fn install(&self, manifest: &Manifest, files: &[(String, Vec<u8>)]) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let id = &manifest.dataset_id;
        let part = self.root.join(format!("{id}.part"));
        if part.exists() {
            fs::remove_dir_all(&part)?;
        }
        fs::create_dir_all(&part)?;
        for (name, bytes) in files {
            fs::write(part.join(name), bytes)?;
        }
        fs::write(part.join(MANIFEST), serde_json::to_vec_pretty(manifest).map_err(io::Error::other)?)?;

        let target = self.dir(id);
        if target.exists() {
            fs::remove_dir_all(&target)?;
        }
        fs::rename(&part, &target)?;
        write_atomic(&self.root.join(CURRENT), id.as_bytes())
    }

    /// Удаляет старые наборы и недокачанные `.part`, оставляя текущий и самый свежий из прочих.
    pub fn cleanup(&self) {
        let current = self.current_id();
        let Ok(entries) = fs::read_dir(&self.root) else { return };
        let mut ids: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.path().is_dir() {
                continue;
            }
            if name.ends_with(".part") {
                let _ = fs::remove_dir_all(entry.path());
            } else if is_dataset_id(&name) {
                ids.push(name);
            }
        }
        ids.retain(|id| Some(id) != current.as_ref());
        ids.sort_by_key(|id| std::cmp::Reverse(order_key(id)));
        for id in ids.into_iter().skip(KEEP - 1) {
            let _ = fs::remove_dir_all(self.dir(&id));
        }
    }
}

/// Проверка байтов по манифесту: размер и sha256 (нижний регистр hex).
pub fn verify(name: &str, bytes: &[u8], size: u64, sha256: &str) -> Result<(), String> {
    if bytes.len() as u64 != size {
        return Err(format!("{name}: размер {} вместо {size}", bytes.len()));
    }
    let actual = sha256_hex(bytes);
    if actual != sha256 {
        return Err(format!("{name}: sha256 не совпадает"));
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// `YYYYMMDD.N`.
fn is_dataset_id(id: &str) -> bool {
    match id.split_once('.') {
        Some((day, n)) => day.len() == 8 && day.bytes().all(|b| b.is_ascii_digit()) && !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Порядок наборов: по дню, затем по номеру как числу (`20261108.10` новее `20261108.9`).
fn order_key(id: &str) -> (u64, u64) {
    let (day, n) = id.split_once('.').unwrap_or((id, "0"));
    (day.parse().unwrap_or(0), n.parse().unwrap_or(0))
}
