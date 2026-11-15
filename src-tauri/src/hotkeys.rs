//! Горячие клавиши в игре, как в Awakened PoE Trade: проверка предмета под курсором и команды чата
//! (`/hideout` на F5, `/exit` на F9…), а также Hold-to-Click (`clicker.rs`). Регистрируются только
//! пока окно PoE1 в фокусе (`on_game_status` из `game.rs`) и в Настройках не записывают сочетание
//! (`hotkeys_recording`): иначе F5 или Ctrl+D перехватывались бы в других программах.
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

/// Hold-to-Click (`clicker.rs`): включён ли, сочетание и диапазоны времени, мс.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HoldClickSettings {
    pub enabled: bool,
    /// `["Ctrl", "Backquote"]` — Ctrl+Ё; знаки препинания — по физической клавише (`KeyboardEvent.code`).
    pub hotkey: Vec<String>,
    /// Между началами кликов.
    pub interval_min: u32,
    pub interval_max: u32,
    /// Удержание кнопки мыши.
    pub hold_min: u32,
    pub hold_max: u32,
}

/// Чья клавиша не назначена.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum HotkeyTarget {
    Check,
    Chat,
    HoldClick,
}

/// Клавиша, которую не удалось назначить.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HotkeyProblem {
    pub target: HotkeyTarget,
    /// Номер команды чата в списке (у `chat`).
    pub command: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone)]
enum Action {
    Check,
    Chat { text: String, send: bool },
    HoldClick,
}

struct Inner {
    bindings: Vec<(Shortcut, Action)>,
    /// Зарегистрированы сейчас (игра в фокусе).
    registered: Vec<Shortcut>,
    game_focused: bool,
    /// В Настройках записывают сочетание: игровые клавиши сняты.
    recording: bool,
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
    app.manage(HotkeyService(Mutex::new(Inner { bindings, registered: Vec::new(), game_focused: false, recording: false })));
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
    crate::clicker::set_game_focused(inner.game_focused);
    sync_registration(app, &mut inner);
}

fn sync_registration(app: &AppHandle, inner: &mut Inner) {
    let active = inner.game_focused && !inner.recording;
    let wanted: Vec<Shortcut> = if active { inner.bindings.iter().map(|(s, _)| *s).collect() } else { Vec::new() };
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
        Some(Action::HoldClick) => crate::clicker::activate(),
        None => {}
    }
}

/// Модификаторы — как их пишет интерфейс (`keysFromEvent`).
const MODIFIERS: [&str; 4] = ["Ctrl", "Alt", "Shift", "Win"];

/// Hold-to-Click: настройки цикла или почему их нельзя принять.
fn hold_click_config(settings: &HoldClickSettings) -> Result<crate::clicker::ClickConfig, String> {
    let (modifiers, keys): (Vec<&String>, Vec<&String>) = settings.hotkey.iter().partition(|k| MODIFIERS.contains(&k.as_str()));
    let [key] = keys.as_slice() else {
        return Err(if keys.is_empty() { "нужна клавиша кроме Ctrl, Alt и Shift".into() } else { "в сочетании может быть только одна основная клавиша".into() });
    };
    let (interval, hold) = ((settings.interval_min, settings.interval_max), (settings.hold_min, settings.hold_max));
    if interval.0 == 0 || hold.0 == 0 {
        return Err("время должно быть больше нуля".into());
    }
    if interval.0 > interval.1 {
        return Err("минимальный интервал больше максимального".into());
    }
    if hold.0 > hold.1 {
        return Err("минимальное удержание больше максимального".into());
    }
    if hold.1 > interval.0 {
        return Err("максимальное удержание больше минимального интервала".into());
    }
    Ok(crate::clicker::ClickConfig { modifiers: modifiers.into_iter().cloned().collect(), key: (*key).clone(), interval_ms: interval, hold_ms: hold })
}

/// В Настройках записывают сочетание: снять игровые клавиши и остановить Hold-to-Click.
#[tauri::command]
pub fn hotkeys_recording(app: AppHandle, service: State<HotkeyService>, recording: bool) {
    crate::clicker::set_paused(recording);
    let mut inner = service.0.lock().unwrap();
    inner.recording = recording;
    sync_registration(&app, &mut inner);
}

fn parse(keys: &[String]) -> Result<Shortcut, String> {
    let text = keys.join("+");
    text.parse::<Shortcut>().map_err(|e| format!("клавиша «{text}» не поддерживается: {e}"))
}

/// Клавиши из настроек: проверка предмета, команды чата и Hold-to-Click. Ответ — что не назначено
/// и почему; остальное работает. Одна клавиша — одно действие: повтор клавиши достаётся первому
/// (Hold-to-Click — последним, так что чужую клавишу он не отнимает).
#[tauri::command]
pub fn hotkeys_set(
    app: AppHandle,
    service: State<HotkeyService>,
    check: Vec<String>,
    commands: Vec<ChatCommand>,
    hold_click: Option<HoldClickSettings>,
) -> Vec<HotkeyProblem> {
    let mut problems = Vec::new();
    let mut bindings: Vec<(Shortcut, Action)> = Vec::new();
    let mut add = |shortcut: Shortcut, action: Action, target: HotkeyTarget, command: Option<u32>, problems: &mut Vec<HotkeyProblem>| {
        if bindings.iter().any(|(s, _)| *s == shortcut) {
            problems.push(HotkeyProblem { target, command, message: "эта клавиша уже занята другим действием".into() });
            false
        } else {
            bindings.push((shortcut, action));
            true
        }
    };
    if !check.is_empty() {
        match parse(&check) {
            Ok(s) => {
                add(s, Action::Check, HotkeyTarget::Check, None, &mut problems);
            }
            Err(message) => problems.push(HotkeyProblem { target: HotkeyTarget::Check, command: None, message }),
        }
    }
    for (i, command) in commands.into_iter().enumerate() {
        let index = Some(i as u32);
        let text = command.text.trim().to_string();
        if command.hotkey.is_empty() || text.is_empty() {
            continue;
        }
        if text.contains(['\n', '\r']) {
            problems.push(HotkeyProblem { target: HotkeyTarget::Chat, command: index, message: "команда должна быть одной строкой".into() });
            continue;
        }
        match parse(&command.hotkey) {
            Ok(s) => {
                add(s, Action::Chat { text, send: command.send }, HotkeyTarget::Chat, index, &mut problems);
            }
            Err(message) => problems.push(HotkeyProblem { target: HotkeyTarget::Chat, command: index, message }),
        }
    }
    // Новые настройки останавливают идущий цикл кликов; без ошибок — включаются сразу.
    let mut click = None;
    if let Some(settings) = hold_click.filter(|s| s.enabled) {
        let problem = |message: String| HotkeyProblem { target: HotkeyTarget::HoldClick, command: None, message };
        match hold_click_config(&settings).and_then(|config| parse(&settings.hotkey).map(|s| (config, s))) {
            Ok((config, shortcut)) => {
                if add(shortcut, Action::HoldClick, HotkeyTarget::HoldClick, None, &mut problems) {
                    click = Some(config);
                }
            }
            Err(message) => problems.push(problem(message)),
        }
    }
    crate::clicker::configure(click);
    let mut inner = service.0.lock().unwrap();
    inner.bindings = bindings;
    sync_registration(&app, &mut inner);
    problems
}
