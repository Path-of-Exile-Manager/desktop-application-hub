//! Снапшоты тайника в `user.db` — только локально, на сервер не уходят (решение пользователя
//! 21.11.2026). Свои таблицы `stash_*` и своя версия схемы (`stash_meta`): `user_version` базы
//! принадлежит синхронизации (`sync/store.rs`), её не трогаем.

use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

const SCHEMA_VERSION: i64 = 1;

fn err(e: rusqlite::Error) -> String {
    format!("user.db (тайник): {e}")
}

pub struct SnapshotStore {
    conn: Connection,
}

/// Строка снапшота: один предмет (вариант цены) в одной вкладке.
pub struct RowRecord {
    pub tab_id: String,
    pub item_id: Option<String>,
    pub variant_key: String,
    pub name: String,
    pub quantity: u32,
    /// `None` — цены нет.
    pub unit_chaos: Option<f64>,
    pub reliable: bool,
    pub exact: bool,
    /// Почему нет цены.
    pub note: Option<String>,
}

pub struct TabRecord {
    pub tab_id: String,
    pub tab_index: u32,
    pub name: String,
    pub kind: String,
    pub colour: Option<String>,
    pub total_chaos: f64,
    pub priced: u32,
    pub unpriced: u32,
    pub skipped: u32,
}

pub struct SnapshotRecord {
    pub id: i64,
    pub league: String,
    pub account: String,
    pub taken_at: i64,
    pub total_chaos: f64,
    pub divine_chaos: Option<f64>,
    pub tabs: u32,
    pub priced: u32,
    pub unpriced: u32,
    pub skipped: u32,
    pub prices_updated: Option<String>,
}

impl SnapshotStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(err)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS stash_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)?;
        let version: i64 = self
            .conn
            .query_row("SELECT value FROM stash_meta WHERE key = 'schema'", [], |r| r.get::<_, String>(0))
            .optional()
            .map_err(err)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if version > SCHEMA_VERSION {
            return Err(format!("снапшоты тайника в user.db новее приложения (схема {version}) — обновите приложение"));
        }
        if version < 1 {
            self.conn
                .execute_batch(
                    "BEGIN;
                     CREATE TABLE stash_snapshots (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       league TEXT NOT NULL,
                       account TEXT NOT NULL,
                       taken_at INTEGER NOT NULL,
                       total_chaos REAL NOT NULL,
                       divine_chaos REAL,
                       tabs INTEGER NOT NULL,
                       priced INTEGER NOT NULL,
                       unpriced INTEGER NOT NULL,
                       skipped INTEGER NOT NULL,
                       prices_updated TEXT
                     );
                     CREATE INDEX stash_snapshots_league ON stash_snapshots (account, league, taken_at);
                     CREATE TABLE stash_snapshot_tabs (
                       snapshot_id INTEGER NOT NULL REFERENCES stash_snapshots (id) ON DELETE CASCADE,
                       tab_id TEXT NOT NULL,
                       tab_index INTEGER NOT NULL,
                       name TEXT NOT NULL,
                       kind TEXT NOT NULL,
                       colour TEXT,
                       total_chaos REAL NOT NULL,
                       priced INTEGER NOT NULL,
                       unpriced INTEGER NOT NULL,
                       skipped INTEGER NOT NULL,
                       PRIMARY KEY (snapshot_id, tab_id)
                     );
                     CREATE TABLE stash_snapshot_rows (
                       snapshot_id INTEGER NOT NULL REFERENCES stash_snapshots (id) ON DELETE CASCADE,
                       tab_id TEXT NOT NULL,
                       item_id TEXT,
                       variant_key TEXT NOT NULL,
                       name TEXT NOT NULL,
                       quantity INTEGER NOT NULL,
                       unit_chaos REAL,
                       reliable INTEGER NOT NULL,
                       exact INTEGER NOT NULL,
                       note TEXT
                     );
                     CREATE INDEX stash_snapshot_rows_snapshot ON stash_snapshot_rows (snapshot_id);
                     INSERT INTO stash_meta (key, value) VALUES ('schema', '1')
                       ON CONFLICT (key) DO UPDATE SET value = excluded.value;
                     COMMIT;",
                )
                .map_err(err)?;
        }
        Ok(())
    }

    pub fn insert(&mut self, snapshot: &SnapshotRecord, tabs: &[TabRecord], rows: &[RowRecord]) -> Result<i64, String> {
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO stash_snapshots (league, account, taken_at, total_chaos, divine_chaos, tabs, priced, unpriced, skipped, prices_updated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                snapshot.league,
                snapshot.account,
                snapshot.taken_at,
                snapshot.total_chaos,
                snapshot.divine_chaos,
                snapshot.tabs,
                snapshot.priced,
                snapshot.unpriced,
                snapshot.skipped,
                snapshot.prices_updated
            ],
        )
        .map_err(err)?;
        let id = tx.last_insert_rowid();
        {
            let mut tab = tx
                .prepare("INSERT INTO stash_snapshot_tabs (snapshot_id, tab_id, tab_index, name, kind, colour, total_chaos, priced, unpriced, skipped) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
                .map_err(err)?;
            for t in tabs {
                tab.execute(params![id, t.tab_id, t.tab_index, t.name, t.kind, t.colour, t.total_chaos, t.priced, t.unpriced, t.skipped]).map_err(err)?;
            }
            let mut row = tx
                .prepare("INSERT INTO stash_snapshot_rows (snapshot_id, tab_id, item_id, variant_key, name, quantity, unit_chaos, reliable, exact, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
                .map_err(err)?;
            for r in rows {
                row.execute(params![id, r.tab_id, r.item_id, r.variant_key, r.name, r.quantity, r.unit_chaos, r.reliable, r.exact, r.note]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)?;
        Ok(id)
    }

    /// Снапшоты аккаунта в лиге, от старых к новым.
    pub fn list(&self, account: &str, league: &str) -> Result<Vec<SnapshotRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, league, account, taken_at, total_chaos, divine_chaos, tabs, priced, unpriced, skipped, prices_updated
                 FROM stash_snapshots WHERE account = ?1 AND league = ?2 ORDER BY taken_at",
            )
            .map_err(err)?;
        stmt.query_map(params![account, league], snapshot_from_row).map_err(err)?.collect::<Result<_, _>>().map_err(err)
    }

    pub fn get(&self, id: i64) -> Result<Option<SnapshotRecord>, String> {
        self.conn
            .query_row(
                "SELECT id, league, account, taken_at, total_chaos, divine_chaos, tabs, priced, unpriced, skipped, prices_updated FROM stash_snapshots WHERE id = ?1",
                [id],
                snapshot_from_row,
            )
            .optional()
            .map_err(err)
    }

    pub fn tabs(&self, id: i64) -> Result<Vec<TabRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT tab_id, tab_index, name, kind, colour, total_chaos, priced, unpriced, skipped FROM stash_snapshot_tabs WHERE snapshot_id = ?1 ORDER BY tab_index")
            .map_err(err)?;
        stmt.query_map([id], |r| {
            Ok(TabRecord {
                tab_id: r.get(0)?,
                tab_index: r.get(1)?,
                name: r.get(2)?,
                kind: r.get(3)?,
                colour: r.get(4)?,
                total_chaos: r.get(5)?,
                priced: r.get(6)?,
                unpriced: r.get(7)?,
                skipped: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
    }

    pub fn rows(&self, id: i64) -> Result<Vec<RowRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT tab_id, item_id, variant_key, name, quantity, unit_chaos, reliable, exact, note FROM stash_snapshot_rows WHERE snapshot_id = ?1")
            .map_err(err)?;
        stmt.query_map([id], |r| {
            Ok(RowRecord {
                tab_id: r.get(0)?,
                item_id: r.get(1)?,
                variant_key: r.get(2)?,
                name: r.get(3)?,
                quantity: r.get(4)?,
                unit_chaos: r.get(5)?,
                reliable: r.get(6)?,
                exact: r.get(7)?,
                note: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM stash_snapshots WHERE id = ?1", [id]).map(|_| ()).map_err(err)
    }
}

fn snapshot_from_row(r: &rusqlite::Row) -> rusqlite::Result<SnapshotRecord> {
    Ok(SnapshotRecord {
        id: r.get(0)?,
        league: r.get(1)?,
        account: r.get(2)?,
        taken_at: r.get(3)?,
        total_chaos: r.get(4)?,
        divine_chaos: r.get(5)?,
        tabs: r.get(6)?,
        priced: r.get(7)?,
        unpriced: r.get(8)?,
        skipped: r.get(9)?,
        prices_updated: r.get(10)?,
    })
}
