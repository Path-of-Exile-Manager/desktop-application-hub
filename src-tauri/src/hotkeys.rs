//! Горячие клавиши в игре, как в Awakened PoE Trade: проверка предмета под курсором и команды чата
//! (`/hideout` на F5, `/exit` на F9…). Регистрируются только пока окно PoE1 в фокусе
//! (`on_game_status` из `game.rs`): иначе F5 или Ctrl+D перехватывались бы в других программах.
//! Набор задаёт интерфейс командой `hotkeys_set` (настройки сохраняет он).

use std::sync::Mutex;

use game_window::{GameKind, GameState, GameStatus};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use ts_rs::TS;

/// Команда чата с горячей клавишей. Клавиша пустая — команда сохранена, но не назначена.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatCommand {
    /// Как в чате игры: `/hideout`, `@last ty`, `/invite @last`.
    pub text: String,
    /// `["F5"]`, `["Ctrl", "H"]`.
    pub hotkey: Vec<String>,
    /// Отправить (Enter); иначе только вписать в строку чата.
    pub send: bool,
}

/// Клавиша, которую не удалось назначить.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HotkeyProblem {
    /// `null` — клавиша проверки предмета, иначе номер команды в списке.
    pub command: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone)]
enum Action {
    Check,
    Chat { text: String, send: bool },
}

struct Inner {
    bindings: Vec<(Shortcut, Action)>,
    /// Зарегистрированы сейчас (игра в фокусе).
    registered: Vec<Shortcut>,
    game_focused: bool,
}

pub struct HotkeyService(Mutex<Inner>);

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                dispatch(app, shortcut);
            }
        })
        .build()
}

/// До первого `hotkeys_set` — только проверка предмета на Ctrl+D.
pub fn start(app: &AppHandle, game: &GameStatus) {
    let bindings = "Ctrl+D".parse::<Shortcut>().map(|s| vec![(s, Action::Check)]).unwrap_or_default();
    app.manage(HotkeyService(Mutex::new(Inner { bindings, registered: Vec::new(), game_focused: false })));
    on_game_status(app, game);
}

fn poe1_focused(status: &GameStatus) -> bool {
    status.state == GameState::Running && status.window.as_ref().is_some_and(|w| w.kind == GameKind::Poe1 && w.focused)
}

/// Игра получила или потеряла фокус — включить или снять горячие клавиши.
pub fn on_game_status(app: &AppHandle, status: &GameStatus) {
    let Some(service) = app.try_state::<HotkeyService>() else { return };
    let mut inner = service.0.lock().unwrap();
    inner.game_focused = poe1_focused(status);
    sync_registration(app, &mut inner);
}

fn sync_registration(app: &AppHandle, inner: &mut Inner) {
    let wanted: Vec<Shortcut> = if inner.game_focused { inner.bindings.iter().map(|(s, _)| *s).collect() } else { Vec::new() };
    let shortcuts = app.global_shortcut();
    inner.registered.retain(|s| {
        let keep = wanted.contains(s);
        if !keep {
            let _ = shortcuts.unregister(*s);
        }
        keep
    });
    for s in wanted {
        if inner.registered.contains(&s) {
            continue;
        }
        match shortcuts.register(s) {
            Ok(()) => inner.registered.push(s),
            Err(e) => eprintln!("[hotkeys] клавиша не зарегистрирована: {e}"),
        }
    }
}

fn dispatch(app: &AppHandle, shortcut: &Shortcut) {
    let action = {
        let service = app.state::<HotkeyService>();
        let inner = service.0.lock().unwrap();
        inner.bindings.iter().find(|(s, _)| s == shortcut).map(|(_, a)| a.clone())
    };
    match action {
        Some(Action::Check) => crate::capture::trigger(app),
        Some(Action::Chat { text, send }) => crate::chat::run(text, send),
        None => {}
    }
}

fn parse(keys: &[String]) -> Result<Shortcut, String> {
    let text = keys.join("+");
    text.parse::<Shortcut>().map_err(|e| format!("клавиша «{text}» не поддерживается: {e}"))
}

/// Клавиши из настроек: проверка предмета и команды чата. Ответ — что не назначено и почему;
/// остальное работает. Одна клавиша — одно действие: повтор клавиши достаётся первому.
#[tauri::command]
pub fn hotkeys_set(app: AppHandle, service: State<HotkeyService>, check: Vec<String>, commands: Vec<ChatCommand>) -> Vec<HotkeyProblem> {
    let mut problems = Vec::new();
    let mut bindings: Vec<(Shortcut, Action)> = Vec::new();
    let mut add = |shortcut: Shortcut, action: Action, command: Option<u32>, problems: &mut Vec<HotkeyProblem>| {
        if bindings.iter().any(|(s, _)| *s == shortcut) {
            problems.push(HotkeyProblem { command, message: "эта клавиша уже занята другим действием".into() });
        } else {
            bindings.push((shortcut, action));
        }
    };
    if !check.is_empty() {
        match parse(&check) {
            Ok(s) => add(s, Action::Check, None, &mut problems),
            Err(message) => problems.push(HotkeyProblem { command: None, message }),
        }
    }
    for (i, command) in commands.into_iter().enumerate() {
        let index = Some(i as u32);
        let text = command.text.trim().to_string();
        if command.hotkey.is_empty() || text.is_empty() {
            continue;
        }
        if text.contains(['\n', '\r']) {
            problems.push(HotkeyProblem { command: index, message: "команда должна быть одной строкой".into() });
            continue;
        }
        match parse(&command.hotkey) {
            Ok(s) => add(s, Action::Chat { text, send: command.send }, index, &mut problems),
            Err(message) => problems.push(HotkeyProblem { command: index, message }),
        }
    }
    let mut inner = service.0.lock().unwrap();
    inner.bindings = bindings;
    sync_registration(&app, &mut inner);
    problems
}
