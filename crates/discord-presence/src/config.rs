//! Настройки Discord-приложения.
//!
//! `client_id` публичный (секрет Discord-приложения десктопу не нужен) и берётся так же, как `API_URL`
//! в src-tauri/src/server.rs:
//! 1. переменная окружения `DISCORD_CLIENT_ID` при запуске; в отладочной сборке читаются и
//!    `desktop-application-hub/.env.local` / `.env` — путь зашит при компиляции, поэтому файлы находятся,
//!    даже когда exe запускает Discord из другой рабочей папки;
//! 2. `DISCORD_CLIENT_ID`, заданный при сборке (`option_env!`) — так значение попадёт в релиз.

pub const CLIENT_ID_ENV: &str = "DISCORD_CLIENT_ID";

/// `client_id` Discord-приложения или `None`, если он нигде не задан (или задан не числом).
pub fn client_id() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        // .env.local главнее .env; уже заданные переменные окружения не перезаписываются.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
        let _ = dotenvy::from_path(format!("{root}/.env.local"));
        let _ = dotenvy::from_path(format!("{root}/.env"));
    }
    std::env::var(CLIENT_ID_ENV)
        .ok()
        .filter(|id| is_client_id(id))
        .or_else(|| option_env!("DISCORD_CLIENT_ID").filter(|id| is_client_id(id)).map(str::to_string))
}

/// Discord ID (snowflake) — только цифры.
pub fn is_client_id(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_digit())
}
