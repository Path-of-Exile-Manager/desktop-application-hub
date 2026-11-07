//! Discord Rich Presence (shared/docs/discord-rich-presence.md).
//!
//! При запуске:
//! 1. берём `client_id` (`DISCORD_CLIENT_ID`, см. crates/discord-presence/src/config.rs); нет — функция выключена;
//! 2. пишем в реестр команду запуска по приглашению (`discord-<client_id>` → этот exe);
//! 3. запускаем сессию с клиентом Discord: она сама переподключается, если Discord закрыт или перезапущен.
//!
//! Статус собирается здесь по состоянию игры (вариант «по игре»): Path of Exile 1 запущен — показываем
//! «Торгует в Path of Exile» с таймером, иначе снимаем. Настройки (вкл/выкл и отладочные переопределения
//! со страницы «Режим разработки») приходят командой `discord_configure`.
//! Интерфейс получает событие `discord-status` (вместе с журналом обмена) и `discord-join`.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_presence::activity::{Activity, ActivityType, Party};
use discord_presence::session::{self, Command, Direction, Event, Handle};
use discord_presence::{config, register};
use game_window::{GameState, GameStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVENT: &str = "discord-status";
pub const JOIN_EVENT: &str = "discord-join";

/// Сколько последних кадров обмена хранить для страницы «Режим разработки».
const LOG_LIMIT: usize = 100;
/// Что получит приложение получателя. Содержимое приглашений пока не решено — только «открыть приложение».
const JOIN_SECRET: &str = "pm1:open";
const DETAILS: &str = "Торгует в Path of Exile";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    /// `DISCORD_CLIENT_ID` не задан — функция выключена.
    NoClientId,
    Connecting,
    Connected,
    Disconnected,
}

/// Когда показывать статус. `Auto` — по игре; `Show` / `Hide` — отладочные переопределения.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceMode {
    Auto,
    Show,
    Hide,
}

/// Настройки из интерфейса: `invoke("discord_configure", { settings })`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSettings {
    /// Переключатель «Показывать статус в Discord».
    pub enabled: bool,
    pub mode: PresenceMode,
    /// `playing` | `listening` | `watching` | `competing`.
    pub activity_type: String,
    /// Указывать размер группы («(1 из 4)» во второй строке).
    pub party_size: bool,
}

impl Default for PresenceSettings {
    fn default() -> Self {
        PresenceSettings { enabled: true, mode: PresenceMode::Auto, activity_type: "playing".into(), party_size: true }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
}

/// Регистрация запуска по приглашению.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    pub registered: bool,
    pub command: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub settings: PresenceSettings,
    /// Path of Exile 1 запущен.
    pub game_running: bool,
    /// Статус сейчас должен быть виден (с учётом настроек и игры).
    pub visible: bool,
    /// Почему статус скрыт: «выключен в настройках», «игра не запущена», «скрыт вручную».
    pub hidden_reason: Option<String>,
    /// Активность, которую мы последней отправили в Discord (`null` — сняли статус).
    pub activity: Option<Value>,
    /// Когда отправили, мс с 1970-01-01.
    pub sent_at: Option<u64>,
    /// Ответ Discord на последний `SET_ACTIVITY`: `ok` или текст ошибки.
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInfo {
    pub secret: String,
    pub at: u64,
}

/// Кадр обмена с Discord.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// мс с 1970-01-01.
    pub at: u64,
    /// `out` — от нас, `in` — от Discord.
    pub direction: &'static str,
    pub opcode: &'static str,
    pub body: Value,
}

/// То же, что тип `DiscordStatus` в ui/src/app/discord.tsx.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub state: ConnectionState,
    pub client_id: Option<String>,
    /// `\\.\pipe\discord-ipc-N`, к которому подключились.
    pub pipe: Option<String>,
    pub user: Option<DiscordUser>,
    pub error: Option<String>,
    /// Когда подключились или потеряли связь, мс с 1970-01-01.
    pub changed_at: Option<u64>,
    pub launch: Launch,
    pub presence: Presence,
    pub last_join: Option<JoinInfo>,
    pub log: VecDeque<LogEntry>,
}

struct Inner {
    status: DiscordStatus,
    handle: Option<Handle>,
    /// id группы — один на запуск приложения.
    party_id: String,
    /// Когда статус стал видимым: начало таймера.
    visible_since: Option<u64>,
}

pub struct DiscordWatcher(Mutex<Inner>);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn game_running(game: &GameStatus) -> bool {
    game.state == GameState::Running
}

/// Пересчитать, что должно быть в статусе, и отправить в Discord, если изменилось.
fn refresh(inner: &mut Inner, version: &str) {
    let presence = &mut inner.status.presence;
    let settings = &presence.settings;
    let hidden_reason = if !settings.enabled {
        Some("выключен в настройках")
    } else {
        match settings.mode {
            PresenceMode::Hide => Some("скрыт вручную (режим разработки)"),
            PresenceMode::Show => None,
            PresenceMode::Auto if presence.game_running => None,
            PresenceMode::Auto => Some("Path of Exile не запущен"),
        }
    };
    presence.visible = hidden_reason.is_none();
    presence.hidden_reason = hidden_reason.map(str::to_string);

    let activity = if presence.visible {
        let since = *inner.visible_since.get_or_insert_with(|| now_ms() / 1000);
        let activity = Activity {
            kind: ActivityType::parse(&settings.activity_type).unwrap_or(ActivityType::Playing),
            details: Some(DETAILS.into()),
            state: None,
            start: Some(since),
            large_image: Some("logo".into()),
            large_text: Some(format!("poe-manager {version}")),
            party: Some(Party { id: inner.party_id.clone(), size: settings.party_size.then_some((1, 4)) }),
            join_secret: Some(JOIN_SECRET.into()),
        };
        Some(activity.to_json())
    } else {
        inner.visible_since = None;
        None
    };

    // Первый расчёт отправляем всегда (sent_at ещё нет), дальше — только изменения.
    if presence.sent_at.is_some() && presence.activity == activity {
        return;
    }
    presence.activity = activity.clone();
    presence.sent_at = Some(now_ms());
    presence.result = None;
    if let Some(handle) = &inner.handle {
        handle.send(Command::SetActivity(activity));
    }
}

fn update(app: &AppHandle, change: impl FnOnce(&mut Inner)) {
    let watcher = app.state::<DiscordWatcher>();
    let status = {
        let mut inner = watcher.0.lock().unwrap();
        change(&mut inner);
        inner.status.clone()
    };
    let _ = app.emit(EVENT, status);
}

fn user(user: session::User) -> DiscordUser {
    DiscordUser { id: user.id, username: user.username, global_name: user.global_name }
}

fn on_event(app: &AppHandle, event: Event) {
    if let Event::Join { secret } = &event {
        let _ = app.emit(JOIN_EVENT, serde_json::json!({ "secret": secret }));
    }
    update(app, |inner| {
        let status = &mut inner.status;
        match event {
            Event::Connecting => {
                status.state = ConnectionState::Connecting;
            }
            Event::Connected { pipe, user: u } => {
                status.state = ConnectionState::Connected;
                status.pipe = Some(discord_presence::ipc::pipe_name(pipe));
                status.user = Some(user(u));
                status.error = None;
                status.changed_at = Some(now_ms());
            }
            Event::Disconnected { error } => {
                status.state = ConnectionState::Disconnected;
                status.pipe = None;
                status.user = None;
                status.error = error;
                status.changed_at = Some(now_ms());
            }
            Event::ActivityResult { error } => {
                status.presence.result = Some(error.unwrap_or_else(|| "ok".into()));
            }
            Event::Join { secret } => {
                status.last_join = Some(JoinInfo { secret, at: now_ms() });
            }
            Event::JoinRequest { .. } => {}
            Event::Frame { direction, opcode, body } => {
                if status.log.len() >= LOG_LIMIT {
                    status.log.pop_front();
                }
                let direction = if direction == Direction::Out { "out" } else { "in" };
                status.log.push_back(LogEntry { at: now_ms(), direction, opcode: opcode.name(), body });
            }
        }
    });
}

pub fn start(app: &AppHandle, game: &GameStatus) {
    let client_id = config::client_id();
    let mut launch = Launch { registered: false, command: None, error: None };

    if let Some(id) = &client_id {
        match std::env::current_exe() {
            Ok(exe) => {
                let exe = exe.to_string_lossy().to_string();
                let command = format!("\"{exe}\"");
                match register::register_launch(id, &command, &exe) {
                    Ok(()) => {
                        launch.registered = true;
                        launch.command = Some(command);
                    }
                    Err(e) => launch.error = Some(format!("не удалось записать команду запуска: {e}")),
                }
            }
            Err(e) => launch.error = Some(format!("не удалось узнать путь к exe: {e}")),
        }
    }

    let (handle, commands) = match &client_id {
        Some(_) => {
            let (handle, commands) = session::channel();
            (Some(handle), Some(commands))
        }
        None => (None, None),
    };

    let mut inner = Inner {
        status: DiscordStatus {
            state: if client_id.is_some() { ConnectionState::Connecting } else { ConnectionState::NoClientId },
            client_id: client_id.clone(),
            pipe: None,
            user: None,
            error: None,
            changed_at: None,
            launch,
            presence: Presence {
                settings: PresenceSettings::default(),
                game_running: game_running(game),
                visible: false,
                hidden_reason: None,
                activity: None,
                sent_at: None,
                result: None,
            },
            last_join: None,
            log: VecDeque::new(),
        },
        handle,
        party_id: format!("pm-{}-{}", std::process::id(), now_ms()),
        visible_since: None,
    };
    refresh(&mut inner, &app.package_info().version.to_string());
    app.manage(DiscordWatcher(Mutex::new(inner)));

    if let (Some(id), Some(commands)) = (client_id, commands) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let events = app.clone();
            session::run(id, commands, move |event| on_event(&events, event)).await;
        });
    }
}

/// Игра появилась или пропала — пересчитать статус. Вызывается из game.rs при каждом изменении.
pub fn on_game_status(app: &AppHandle, game: &GameStatus) {
    let Some(watcher) = app.try_state::<DiscordWatcher>() else { return };
    let running = game_running(game);
    if watcher.0.lock().unwrap().status.presence.game_running == running {
        return;
    }
    let version = app.package_info().version.to_string();
    update(app, |inner| {
        inner.status.presence.game_running = running;
        refresh(inner, &version);
    });
}

/// Текущее состояние: `invoke("discord_status")`.
#[tauri::command]
pub fn discord_status(watcher: State<DiscordWatcher>) -> DiscordStatus {
    watcher.0.lock().unwrap().status.clone()
}

/// Настройки статуса: переключатель из Настроек и переопределения со страницы «Режим разработки».
#[tauri::command]
pub fn discord_configure(app: AppHandle, settings: PresenceSettings) -> Result<(), String> {
    if ActivityType::parse(&settings.activity_type).is_none() {
        return Err(format!("неизвестный тип активности: {}", settings.activity_type));
    }
    let version = app.package_info().version.to_string();
    update(&app, |inner| {
        inner.status.presence.settings = settings;
        refresh(inner, &version);
    });
    Ok(())
}

/// Разорвать соединение и подключиться заново: `invoke("discord_reconnect")`.
#[tauri::command]
pub fn discord_reconnect(watcher: State<DiscordWatcher>) -> Result<(), String> {
    let inner = watcher.0.lock().unwrap();
    match &inner.handle {
        Some(handle) => {
            handle.send(Command::Reconnect);
            Ok(())
        }
        None => Err("DISCORD_CLIENT_ID не задан".into()),
    }
}

/// Очистить журнал обмена: `invoke("discord_clear_log")`.
#[tauri::command]
pub fn discord_clear_log(app: AppHandle) {
    update(&app, |inner| inner.status.log.clear());
}
