//! Discord Rich Presence для poe-manager (shared/docs/discord-rich-presence.md).
//!
//! ```text
//! poe-manager ──\\.\pipe\discord-ipc-N──▶ клиент Discord
//!      ▲                                       │ приглашение в чате, клик «Присоединиться»
//!      └────── ACTIVITY_JOIN { secret } ◀──────┘
//! ```
//!
//! Крейт не зависит от Tauri: приложение запускает [`session::run`] и шлёт ему команды через
//! [`session::Handle`], а события (подключение, ответы, приглашения, каждый кадр) получает в колбэке.
//! Отдельная проверка схемы без приложения — `examples/spike.rs`.

pub mod activity;
pub mod config;
pub mod frame;
pub mod ipc;
pub mod register;
#[cfg(windows)]
pub mod session;
