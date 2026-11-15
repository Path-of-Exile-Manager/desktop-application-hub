//! Hold-to-Click: пока игрок держит сочетание (по умолчанию Ctrl+Ё), левая кнопка мыши нажимается
//! в текущей позиции курсора с интервалом 60–100 мс между началами кликов и удержанием 12–28 мс —
//! оба случайны и новые для каждого клика. Курсор не двигается, модификаторы не эмулируются: если
//! игрок держит Ctrl, игра видит Ctrl+клик (перенос предметов в тайнике).
//!
//! Нажатие ловит общая система горячих клавиш (`hotkeys.rs`, `Action::HoldClick`): она регистрирует
//! сочетание, только пока окно PoE1 в фокусе. Дальше цикл в своём потоке сам следит за клавишами
//! (`GetAsyncKeyState`) и останавливается, как только отпущена любая клавиша сочетания, сменилось
//! окно на переднем плане, игра потеряла фокус, сменились настройки или идёт запись клавиши. Цикл
//! всегда один; кнопка мыши, нажатая к моменту остановки, отпускается.
//!
//! Выключено по умолчанию: игра разрешает одно действие на одно нажатие клавиши, за автокликер
//! GGG может заблокировать аккаунт (предупреждение — в Настройках).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// Что держать и как кликать; готово к циклу (диапазоны проверены `hotkeys_set`).
#[derive(Debug, Clone, PartialEq)]
pub struct ClickConfig {
    /// Модификаторы сочетания: `Ctrl`, `Alt`, `Shift`, `Win`.
    pub modifiers: Vec<String>,
    /// Основная клавиша, как её пишет интерфейс: `Backquote`, `Q`, `F6`.
    pub key: String,
    pub interval_ms: (u32, u32),
    pub hold_ms: (u32, u32),
}

static CONFIG: Mutex<Option<ClickConfig>> = Mutex::new(None);
/// Меняется при каждой новой настройке, паузе и выходе: идущий цикл видит это и останавливается.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
static GAME_FOCUSED: AtomicBool = AtomicBool::new(false);
static PAUSED: AtomicBool = AtomicBool::new(false);

/// Как часто цикл проверяет клавиши во время удержания и ожидания.
const POLL: Duration = Duration::from_millis(2);

/// Новые настройки (`None` — выключено). Изменились — идущий цикл останавливается.
pub fn configure(config: Option<ClickConfig>) {
    let mut current = CONFIG.lock().unwrap();
    if *current != config {
        *current = config;
        GENERATION.fetch_add(1, Ordering::AcqRel);
    }
}

/// Окно PoE1 получило или потеряло фокус.
pub fn set_game_focused(focused: bool) {
    GAME_FOCUSED.store(focused, Ordering::Release);
    if !focused {
        GENERATION.fetch_add(1, Ordering::AcqRel);
    }
}

/// Идёт запись сочетания в Настройках: не запускаться.
pub fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::Release);
    if paused {
        GENERATION.fetch_add(1, Ordering::AcqRel);
    }
}

/// Выход из приложения: остановить цикл и дождаться, пока он отпустит кнопку мыши.
pub fn shutdown() {
    *CONFIG.lock().unwrap() = None;
    GENERATION.fetch_add(1, Ordering::AcqRel);
    let started = Instant::now();
    while RUNNING.load(Ordering::Acquire) && started.elapsed() < Duration::from_millis(200) {
        thread::sleep(POLL);
    }
}

/// Нажато сочетание Hold-to-Click: запустить цикл, если он ещё не идёт.
pub fn activate() {
    let Some(config) = CONFIG.lock().unwrap().clone() else { return };
    if PAUSED.load(Ordering::Acquire) || !GAME_FOCUSED.load(Ordering::Acquire) {
        return;
    }
    if RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    let generation = GENERATION.load(Ordering::Acquire);
    let spawned = thread::Builder::new().name("hold-to-click".into()).spawn(move || {
        win::run(&config, generation);
        RUNNING.store(false, Ordering::Release);
    });
    if spawned.is_err() {
        RUNNING.store(false, Ordering::Release);
    }
}

/// Цикл ещё нужен: настройки те же, игра в фокусе, записи клавиши нет.
fn current(generation: u64) -> bool {
    GENERATION.load(Ordering::Acquire) == generation && GAME_FOCUSED.load(Ordering::Acquire) && !PAUSED.load(Ordering::Acquire)
}

/// Случайные числа без зависимостей: xorshift64*, зерно — время и адрес стека.
struct Rng(u64);

impl Rng {
    fn new() -> Self {
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
        let local = 0u8;
        Rng((time ^ (&local as *const u8 as u64).rotate_left(32)) | 1)
    }

    /// Целое из `[min, max]`.
    fn range(&mut self, (min, max): (u32, u32)) -> u32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let value = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        min + (value % u64::from(max - min + 1)) as u32
    }
}

#[cfg(windows)]
mod win {
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_MOUSE, MAPVK_VSC_TO_VK, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEINPUT, MOUSE_EVENT_FLAGS, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetSystemMetrics, SM_SWAPBUTTON};

    use super::{current, ClickConfig, Rng, POLL};

    pub fn run(config: &ClickConfig, generation: u64) {
        let Some(key) = key_vk(&config.key) else { return };
        let modifiers: Vec<Vec<u16>> = config.modifiers.iter().filter_map(|m| modifier_vks(m)).collect();
        // Сочетание поймано, пока игра в фокусе: её окно сейчас на переднем плане.
        let window = unsafe { GetForegroundWindow() };
        let alive = || {
            current(generation)
                && unsafe { GetForegroundWindow() } == window
                && held(key)
                && modifiers.iter().all(|any| any.iter().any(|vk| held(*vk)))
        };
        // Кнопки мыши поменяны местами в Windows: «левая» для игры — правая физическая.
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let (down, up) = if swapped { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
        let mut rng = Rng::new();
        while alive() {
            let interval = Duration::from_millis(u64::from(rng.range(config.interval_ms)));
            let hold = Duration::from_millis(u64::from(rng.range(config.hold_ms))).min(interval);
            let started = Instant::now();
            mouse(down);
            let held_out = wait(started + hold, &alive);
            // Отпустить всегда — и когда сочетание отпустили посреди нажатия.
            mouse(up);
            // Следующий клик — от начала этого: удержание входит в интервал. Опоздали — кликаем
            // сразу, без догоняющей пачки.
            if !held_out || !wait(started + interval, &alive) {
                break;
            }
        }
    }

    /// Ждать до момента, пока цикл нужен; `false` — пора остановиться.
    fn wait(until: Instant, alive: &impl Fn() -> bool) -> bool {
        loop {
            if !alive() {
                return false;
            }
            let now = Instant::now();
            if now >= until {
                return true;
            }
            thread::sleep((until - now).min(POLL));
        }
    }

    fn mouse(flags: MOUSE_EVENT_FLAGS) {
        // Без MOUSEEVENTF_MOVE: кнопка нажимается там, где курсор.
        let input = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
        unsafe {
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn held(vk: u16) -> bool {
        unsafe { GetAsyncKeyState(i32::from(vk)) as u16 & 0x8000 != 0 }
    }

    fn modifier_vks(name: &str) -> Option<Vec<u16>> {
        Some(match name {
            "Ctrl" => vec![VK_CONTROL.0],
            "Alt" => vec![VK_MENU.0],
            "Shift" => vec![VK_SHIFT.0],
            "Win" => vec![VK_LWIN.0, VK_RWIN.0],
            _ => return None,
        })
    }

    /// Виртуальный код основной клавиши. Знаки препинания — по скан-коду физической клавиши
    /// (Ё — 0x29), чтобы не зависеть от раскладки: виртуальный код берёт Windows для текущей.
    fn key_vk(key: &str) -> Option<u16> {
        if let Some(scan) = punctuation_scan(key) {
            let vk = unsafe { MapVirtualKeyW(scan, MAPVK_VSC_TO_VK) } as u16;
            return (vk != 0).then_some(vk);
        }
        let upper = key.to_ascii_uppercase();
        let bytes = upper.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_alphanumeric() {
            return Some(u16::from(bytes[0]));
        }
        if let Some(n) = upper.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()).filter(|n| (1..=24).contains(n)) {
            return Some(0x70 + n - 1);
        }
        if let Some(n) = upper.strip_prefix("NUMPAD").and_then(|n| n.parse::<u16>().ok()).filter(|n| *n <= 9) {
            return Some(0x60 + n);
        }
        Some(match upper.as_str() {
            "SPACE" | " " => 0x20,
            "TAB" => 0x09,
            "ENTER" => 0x0D,
            "BACKSPACE" => 0x08,
            "ESCAPE" => 0x1B,
            "INSERT" => 0x2D,
            "DELETE" => 0x2E,
            "HOME" => 0x24,
            "END" => 0x23,
            "PAGEUP" => 0x21,
            "PAGEDOWN" => 0x22,
            "ARROWLEFT" => 0x25,
            "ARROWUP" => 0x26,
            "ARROWRIGHT" => 0x27,
            "ARROWDOWN" => 0x28,
            _ => return None,
        })
    }

    /// Скан-коды (набор 1) клавиш со знаками: их символ зависит от раскладки, место — нет.
    fn punctuation_scan(key: &str) -> Option<u32> {
        Some(match key {
            "Backquote" => 0x29,
            "Minus" => 0x0C,
            "Equal" => 0x0D,
            "BracketLeft" => 0x1A,
            "BracketRight" => 0x1B,
            "Backslash" => 0x2B,
            "Semicolon" => 0x27,
            "Quote" => 0x28,
            "Comma" => 0x33,
            "Period" => 0x34,
            "Slash" => 0x35,
            "IntlBackslash" => 0x56,
            _ => return None,
        })
    }
}

#[cfg(not(windows))]
mod win {
    use super::ClickConfig;

    pub fn run(_config: &ClickConfig, _generation: u64) {}
}
