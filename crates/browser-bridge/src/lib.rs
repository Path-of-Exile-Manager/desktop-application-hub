//! Связь приложения poe-manager с расширением браузера (docs/extension-bridge.md в общих документах).
//!
//! ```text
//! Chrome ──stdio──▶ poe-manager.exe chrome-extension://<id>/   (relay: режим «мост», без Tauri)
//!                         │ именованный канал (pipe)
//!                         ▼
//!                   запущенное приложение                       (server: Hub + serve)
//! ```
//!
//! Крейт не зависит от Tauri: режим моста запускается из `main()` до создания окна,
//! а приложение подключает [`server::Hub`] к своему интерфейсу.

pub mod config;
pub mod frame;
pub mod log;
pub mod pipe;
pub mod protocol;
pub mod register;
pub mod relay;
pub mod server;
