//! `user.db` — данные пользователя в SQLite: записи всех синхронизируемых коллекций и курсор.
//!
//! Одна таблица `records` на все коллекции: движку синхронизации записи непрозрачны (JSON формы
//! API, проверенный `records::check`), а выборки по полям делает SQLite (`json_extract`).
//! Служебные поля строки:
//! - `dirty` — изменена здесь и ещё не принята сервером;
//! - `deleted` — удалена здесь (надгробие до отправки), `data` пусто;
//! - `local_rev` — растёт с каждым изменением здесь: отправленная версия снимает `dirty`, только
//!   если за время отправки её не изменили снова;
//! - `rejected` — сервер отверг эту версию (почему); до следующего изменения не отправляется.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::records::COLLECTIONS;

const SCHEMA_VERSION: i64 = 1;

pub struct Store {
    conn: Connection,
}

/// Изменённая здесь запись, ждущая отправки.
pub struct DirtyRow {
    pub collection: String,
    pub id: String,
    /// `None` — удаление.
    pub data: Option<Value>,
    pub local_rev: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn err(e: rusqlite::Error) -> String {
    format!("user.db: {e}")
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(err)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(err)?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(err)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    /// Схема по `user_version`: новые шаги дописываются ниже, старые не меняются.
    fn migrate(&self) -> Result<(), String> {
        let version: i64 = self.conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(err)?;
        if version > SCHEMA_VERSION {
            return Err(format!("user.db новее приложения (схема {version}, знаем {SCHEMA_VERSION}) — обновите приложение"));
        }
        if version < 1 {
            self.conn
                .execute_batch(
                    "BEGIN;
                     CREATE TABLE records (
                       collection TEXT NOT NULL,
                       id TEXT NOT NULL,
                       data TEXT,
                       deleted INTEGER NOT NULL DEFAULT 0,
                       dirty INTEGER NOT NULL DEFAULT 0,
                       local_rev INTEGER NOT NULL DEFAULT 0,
                       rejected TEXT,
                       updated_at INTEGER NOT NULL,
                       PRIMARY KEY (collection, id)
                     );
                     CREATE INDEX records_dirty ON records (dirty) WHERE dirty = 1;
                     CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                     PRAGMA user_version = 1;
                     COMMIT;",
                )
                .map_err(err)?;
        }
        Ok(())
    }

    pub fn state(&self, key: &str) -> Option<String> {
        self.conn.query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_state(&self, key: &str, value: Option<&str>) -> Result<(), String> {
        match value {
            Some(v) => self.conn.execute("INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![key, v]),
            None => self.conn.execute("DELETE FROM sync_state WHERE key = ?1", [key]),
        }
        .map(|_| ())
        .map_err(err)
    }

    /// Живые записи коллекции.
    pub fn list(&self, collection: &str) -> Result<Vec<Value>, String> {
        let mut stmt = self.conn.prepare("SELECT data FROM records WHERE collection = ?1 AND deleted = 0 ORDER BY updated_at").map_err(err)?;
        let rows = stmt.query_map([collection], |r| r.get::<_, String>(0)).map_err(err)?;
        Ok(rows.filter_map(Result::ok).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    }

    /// Изменение здесь: запись станет «грязной» и уйдёт на сервер.
    pub fn put_local(&self, collection: &str, id: &str, data: &Value) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO records (collection, id, data, deleted, dirty, local_rev, rejected, updated_at)
                 VALUES (?1, ?2, ?3, 0, 1, 1, NULL, ?4)
                 ON CONFLICT (collection, id) DO UPDATE SET
                   data = excluded.data, deleted = 0, dirty = 1, local_rev = local_rev + 1, rejected = NULL, updated_at = excluded.updated_at",
                params![collection, id, data.to_string(), now_ms()],
            )
            .map(|_| ())
            .map_err(err)
    }

    /// Удаление здесь: надгробие до отправки. `false` — такой записи нет.
    pub fn delete_local(&self, collection: &str, id: &str) -> Result<bool, String> {
        self.conn
            .execute(
                "UPDATE records SET data = NULL, deleted = 1, dirty = 1, local_rev = local_rev + 1, rejected = NULL, updated_at = ?3
                 WHERE collection = ?1 AND id = ?2 AND deleted = 0",
                params![collection, id, now_ms()],
            )
            .map(|n| n > 0)
            .map_err(err)
    }

    /// Запись с сервера. Изменённая здесь и не отправленная не перезаписывается: её версия
    /// уйдёт на сервер следом и станет последней принятой.
    pub fn apply_upsert(&self, collection: &str, id: &str, data: &Value) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO records (collection, id, data, deleted, dirty, local_rev, rejected, updated_at)
                 VALUES (?1, ?2, ?3, 0, 0, 0, NULL, ?4)
                 ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at
                 WHERE dirty = 0",
                params![collection, id, data.to_string(), now_ms()],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn apply_delete(&self, collection: &str, id: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM records WHERE collection = ?1 AND id = ?2 AND dirty = 0", [collection, id]).map(|_| ()).map_err(err)
    }

    /// Полная копия с сервера: всё отправленное раньше заменяется ею, неотправленное остаётся.
    pub fn replace_clean(&self, records: &[(String, String, Value)]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        tx.execute("DELETE FROM records WHERE dirty = 0", []).map_err(err)?;
        for (collection, id, data) in records {
            tx.execute(
                "INSERT INTO records (collection, id, data, deleted, dirty, local_rev, rejected, updated_at)
                 VALUES (?1, ?2, ?3, 0, 0, 0, NULL, ?4) ON CONFLICT (collection, id) DO NOTHING",
                params![collection, id, data.to_string(), now_ms()],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    /// «Заменить» при первом входе: выбросить всё локальное.
    pub fn clear(&self) -> Result<(), String> {
        self.conn.execute("DELETE FROM records", []).map(|_| ()).map_err(err)
    }

    /// Другой аккаунт: всё, что лежит здесь, для него — новое.
    pub fn mark_all_dirty(&self) -> Result<(), String> {
        self.conn.execute("DELETE FROM records WHERE deleted = 1", []).map_err(err)?;
        self.conn.execute("UPDATE records SET dirty = 1, local_rev = local_rev + 1, rejected = NULL", []).map(|_| ()).map_err(err)
    }

    /// Ждут отправки (без отвергнутых), коллекции по порядку `COLLECTIONS`.
    pub fn dirty(&self) -> Result<Vec<DirtyRow>, String> {
        let mut stmt = self.conn.prepare("SELECT collection, id, data, local_rev FROM records WHERE dirty = 1 AND rejected IS NULL").map_err(err)?;
        let mut rows: Vec<DirtyRow> = stmt
            .query_map([], |r| {
                Ok(DirtyRow {
                    collection: r.get(0)?,
                    id: r.get(1)?,
                    data: r.get::<_, Option<String>>(2)?.and_then(|s| serde_json::from_str(&s).ok()),
                    local_rev: r.get(3)?,
                })
            })
            .map_err(err)?
            .filter_map(Result::ok)
            .collect();
        rows.sort_by_key(|r| COLLECTIONS.iter().position(|c| *c == r.collection).unwrap_or(usize::MAX));
        Ok(rows)
    }

    /// Сервер принял эти версии.
    pub fn mark_pushed(&self, rows: &[&DirtyRow]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for row in rows {
            if row.data.is_none() {
                tx.execute("DELETE FROM records WHERE collection = ?1 AND id = ?2 AND local_rev = ?3", params![row.collection, row.id, row.local_rev]).map_err(err)?;
            } else {
                tx.execute("UPDATE records SET dirty = 0 WHERE collection = ?1 AND id = ?2 AND local_rev = ?3", params![row.collection, row.id, row.local_rev]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    pub fn mark_rejected(&self, row: &DirtyRow, reason: &str) -> Result<(), String> {
        self.conn
            .execute("UPDATE records SET rejected = ?4 WHERE collection = ?1 AND id = ?2 AND local_rev = ?3", params![row.collection, row.id, row.local_rev, reason])
            .map(|_| ())
            .map_err(err)
    }

    /// Отвергнутые сервером: коллекция, id, причина.
    pub fn rejected(&self) -> Result<Vec<(String, String, String)>, String> {
        let mut stmt = self.conn.prepare("SELECT collection, id, rejected FROM records WHERE rejected IS NOT NULL ORDER BY collection, id").map_err(err)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// Живые записи по коллекциям и сколько ждут отправки.
    pub fn counts(&self) -> Result<(BTreeMap<String, u32>, u32), String> {
        let mut counts: BTreeMap<String, u32> = COLLECTIONS.iter().map(|c| (c.to_string(), 0)).collect();
        let mut stmt = self.conn.prepare("SELECT collection, COUNT(*) FROM records WHERE deleted = 0 GROUP BY collection").map_err(err)?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))).map_err(err)?.flatten() {
            counts.insert(row.0, row.1);
        }
        let pending: u32 = self.conn.query_row("SELECT COUNT(*) FROM records WHERE dirty = 1 AND rejected IS NULL", [], |r| r.get(0)).map_err(err)?;
        Ok((counts, pending))
    }

    /// Есть ли здесь живые записи, которых сервер ещё не видел.
    pub fn has_unsynced(&self) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS (SELECT 1 FROM records WHERE dirty = 1 AND deleted = 0)", [], |r| r.get(0)).map_err(err)
    }
}
