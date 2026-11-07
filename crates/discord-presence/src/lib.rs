//! Discord Rich Presence для poe-manager (shared/docs/discord-rich-presence.md).
//!
//! ```text
//! poe-manager ──\\.\pipe\discord-ipc-N──▶ клиент Discord
//!      ▲                                       │ приглашение в чате, клик «Присоединиться»
//!      └────── ACTIVITY_JOIN { secret } ◀──────┘
//! ```
//!
//! Крейт не зависит от Tauri. Сейчас здесь транспорт (кадры, поиск канала) и регистрация запуска;
//! клиент с переподключением появится на шаге 2 плана. Проверка схемы — `examples/spike.rs`.

pub mod frame;
pub mod ipc;
pub mod register;
