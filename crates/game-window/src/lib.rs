//! Поиск окна Path of Exile и его состояние.
//!
//! Окно клиента PoE (и PoE1, и PoE2) имеет класс `POEWindowClass`. Отличаем игры по заголовку:
//! «Path of Exile 2» — вторая часть, любой другой — первая (заголовок у локализованных клиентов тот же).
//!
//! Модуль без зависимостей от Tauri: его можно проверять `cargo test -p game-window`
//! и пример `cargo run -p game-window --example fake_poe` (поддельное окно игры).

use serde::Serialize;

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::{detect, fake};

/// Класс окна клиента Path of Exile.
pub const WINDOW_CLASS: &str = "POEWindowClass";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GameKind {
    Poe1,
    Poe2,
}

/// Режим окна игры. Оверлей виден только в `Windowed` и `Borderless`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    /// Оконный: с заголовком и рамкой.
    Windowed,
    /// Оконный без рамки (Windowed Fullscreen): окно без рамки на весь монитор.
    Borderless,
    /// Эксклюзивный полноэкранный: оверлей поверх игры не виден.
    Fullscreen,
    /// Свёрнуто.
    Minimized,
}

/// Прямоугольник в физических пикселях экрана.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn from_ltrb(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Rect { x: left, y: top, width: right - left, height: bottom - top }
    }
}

/// Найденное окно игры.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameWindow {
    /// Дескриптор окна (HWND) — понадобится оверлею, чтобы следить за окном.
    pub hwnd: isize,
    pub kind: GameKind,
    pub pid: u32,
    pub title: String,
    /// Имя исполняемого файла: `PathOfExile_x64Steam.exe`. `None` — не удалось прочитать.
    pub exe: Option<String>,
    pub mode: WindowMode,
    /// Клиентская область (сама картинка игры) в координатах экрана.
    pub client: Rect,
    /// Окно игры сейчас на переднем плане.
    pub focused: bool,
    /// Игра запущена от администратора. `None` — не удалось узнать
    /// (обычно так и бывает, когда игра с правами администратора, а мы — нет).
    pub elevated: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GameState {
    /// Окна игры нет.
    NotRunning,
    /// Найден Path of Exile 1.
    Running,
    /// Найден только Path of Exile 2 — его не поддерживаем.
    Unsupported,
}

/// Итог проверки: то, что видит интерфейс.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    pub state: GameState,
    pub window: Option<GameWindow>,
    /// poe-manager запущен от администратора.
    pub app_elevated: bool,
}

impl GameStatus {
    /// Хватит ли нам прав, чтобы ловить клавиши в игре и отправлять ей ввод.
    /// Windows не пропускает ввод от обычного процесса в процесс администратора.
    pub fn input_blocked(&self) -> bool {
        match &self.window {
            Some(w) => !self.app_elevated && w.elevated != Some(false),
            None => false,
        }
    }
}

/// Какая это игра — по заголовку окна.
pub fn kind_from_title(title: &str) -> GameKind {
    let t = title.trim();
    if t.starts_with("Path of Exile 2") || t.starts_with("Path of Exile II") {
        GameKind::Poe2
    } else {
        GameKind::Poe1
    }
}

/// Признаки окна, по которым определяется режим.
#[derive(Debug, Clone, Copy)]
pub struct ModeInput {
    pub minimized: bool,
    /// У окна есть заголовок (WS_CAPTION).
    pub has_caption: bool,
    pub window: Rect,
    pub monitor: Rect,
    /// Windows сообщает, что на переднем плане D3D-приложение в эксклюзивном полноэкранном режиме,
    /// и это окно игры.
    pub exclusive_fullscreen: bool,
}

pub fn detect_mode(m: ModeInput) -> WindowMode {
    if m.minimized {
        WindowMode::Minimized
    } else if m.exclusive_fullscreen {
        WindowMode::Fullscreen
    } else if !m.has_caption && m.window == m.monitor {
        WindowMode::Borderless
    } else {
        WindowMode::Windowed
    }
}

/// Из всех найденных окон выбирает то, с которым работаем: PoE1 главнее PoE2.
pub fn pick(windows: Vec<GameWindow>, app_elevated: bool) -> GameStatus {
    let poe1 = windows.iter().find(|w| w.kind == GameKind::Poe1).cloned();
    let (state, window) = match poe1 {
        Some(w) => (GameState::Running, Some(w)),
        None => match windows.into_iter().next() {
            Some(w) => (GameState::Unsupported, Some(w)),
            None => (GameState::NotRunning, None),
        },
    };
    GameStatus { state, window, app_elevated }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(kind: GameKind) -> GameWindow {
        GameWindow {
            hwnd: 1,
            kind,
            pid: 1,
            title: String::new(),
            exe: None,
            mode: WindowMode::Windowed,
            client: Rect::default(),
            focused: false,
            elevated: Some(false),
        }
    }

    #[test]
    fn kind_by_title() {
        assert_eq!(kind_from_title("Path of Exile"), GameKind::Poe1);
        assert_eq!(kind_from_title("Path of Exile 2"), GameKind::Poe2);
        assert_eq!(kind_from_title(" Path of Exile 2 "), GameKind::Poe2);
    }

    #[test]
    fn modes() {
        let monitor = Rect { x: 0, y: 0, width: 1920, height: 1080 };
        let base = ModeInput { minimized: false, has_caption: false, window: monitor, monitor, exclusive_fullscreen: false };
        assert_eq!(detect_mode(base), WindowMode::Borderless);
        assert_eq!(detect_mode(ModeInput { has_caption: true, ..base }), WindowMode::Windowed);
        assert_eq!(detect_mode(ModeInput { window: Rect { width: 1280, height: 720, ..monitor }, ..base }), WindowMode::Windowed);
        assert_eq!(detect_mode(ModeInput { exclusive_fullscreen: true, ..base }), WindowMode::Fullscreen);
        assert_eq!(detect_mode(ModeInput { minimized: true, exclusive_fullscreen: true, ..base }), WindowMode::Minimized);
    }

    #[test]
    fn picks_poe1_over_poe2() {
        assert_eq!(pick(vec![], false).state, GameState::NotRunning);
        assert_eq!(pick(vec![win(GameKind::Poe2)], false).state, GameState::Unsupported);
        let s = pick(vec![win(GameKind::Poe2), win(GameKind::Poe1)], false);
        assert_eq!(s.state, GameState::Running);
        assert_eq!(s.window.unwrap().kind, GameKind::Poe1);
    }

    #[test]
    fn input_blocked_when_game_is_admin() {
        let mut s = pick(vec![win(GameKind::Poe1)], false);
        assert!(!s.input_blocked());
        s.window.as_mut().unwrap().elevated = Some(true);
        assert!(s.input_blocked());
        s.window.as_mut().unwrap().elevated = None;
        assert!(s.input_blocked());
        s.app_elevated = true;
        assert!(!s.input_blocked());
    }
}
