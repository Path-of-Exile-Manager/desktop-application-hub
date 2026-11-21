//! Path of Exile 1 `Client.txt`: where it is, how to follow it and what boss runs it shows.
//!
//! - [`path`] — the log next to the game executable (`<install>\logs\Client.txt`) and the usual
//!   install folders. The executable of the running game comes from `game_window::exe_path(pid)`.
//! - [`Tail`] — follows the file from its end without locking it for the game.
//! - [`parse_line`] — one log line into a [`LogEntry`]. Area changes rely on the English `DEBUG`
//!   line `Generating level 83 area "MapWorldsShapersRealm" with seed 1`, written in every client
//!   language; deaths, level-ups and entered areas are matched in English and Russian.
//! - [`RunTracker`] — a pure state machine: log entries in, boss arena runs out.
//!
//! Plan and rules: `shared/docs/boss-farm.md`, section 7.3. Try it on a sample log:
//! `cargo run -p game-log --example runs`, or follow the real one with `-- --follow`.

mod area;
mod line;
pub mod path;
mod runs;
mod tail;

pub use area::is_safe_area;
pub use line::{parse_line, LogEntry, LogEvent};
pub use runs::{BossArena, BossRun, RunEvent, RunState, RunTracker, TrackerOptions};
pub use tail::{Start, Tail};
