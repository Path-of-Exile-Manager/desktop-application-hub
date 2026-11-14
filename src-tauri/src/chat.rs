//! Команды чата по горячей клавише (`/hideout` на F5 и т. п.). Перенесено из Awakened PoE Trade
//! (`main/src/shortcuts/text-box.ts`, `typeInChat`, MIT, © SnosMe): текст кладётся в буфер обмена,
//! чат открывается Enter, текст вставляется Ctrl+V, с «отправить» — Enter. Одно нажатие игрока —
//! одно сообщение в чат (правило игры: одна клавиша — одно действие). Буфер пользователя
//! возвращается после вставки.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// Последний, кто писал в личку: `@last ty` — ответить ему, `/invite @last` — позвать его.
const PLACEHOLDER_LAST: &str = "@last";

/// С этих символов игра сама начинает строку чата заново: очищать её (Ctrl+A) не нужно.
const AUTO_CLEAR: [char; 6] = ['#', '%', '@', '$', '&', '/'];

/// Сколько ждать, пока игрок отпустит Ctrl/Alt/Shift горячей клавиши: иначе Enter станет Ctrl+Enter.
const MODIFIERS_TIMEOUT: Duration = Duration::from_millis(800);

/// Пауза между нажатиями: игре нужен кадр, чтобы открыть строку чата.
const KEY_GAP: Duration = Duration::from_millis(15);

/// Когда вернуть прежний текст буфера: игра должна успеть вставить наш.
const CLIPBOARD_RESTORE_AFTER: Duration = Duration::from_millis(150);

static BUSY: AtomicBool = AtomicBool::new(false);

/// Набрать команду в чате игры в своём потоке; нажатие во время набора предыдущей игнорируется.
pub fn run(text: String, send: bool) {
    if BUSY.swap(true, Ordering::AcqRel) {
        return;
    }
    thread::spawn(move || {
        if let Err(e) = type_in_chat(&text, send) {
            eprintln!("[chat] команда «{text}» не набрана: {e}");
        }
        BUSY.store(false, Ordering::Release);
    });
}

/// Как открыть строку чата под текст.
enum Open {
    /// Enter, строка очищается Ctrl+A, если игра не очистит её сама.
    Plain,
    /// Ctrl+Enter — личка последнему собеседнику (`@last ty`).
    ReplyLast,
    /// Ctrl+Enter, затем адресат `@имя` убирается: текст вставляется перед ним (`/invite @last`).
    BeforeLast,
}

fn type_in_chat(text: &str, send: bool) -> Result<(), String> {
    let (paste, open) = if let Some(rest) = text.strip_prefix(&format!("{PLACEHOLDER_LAST} ")) {
        (rest.to_string(), Open::ReplyLast)
    } else if let Some(rest) = text.strip_suffix(PLACEHOLDER_LAST) {
        (rest.to_string(), Open::BeforeLast)
    } else {
        (text.to_string(), Open::Plain)
    };

    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("буфер обмена недоступен: {e}"))?;
    let previous = clipboard.get_text().ok();
    clipboard.set_text(paste.clone()).map_err(|e| format!("буфер обмена недоступен: {e}"))?;

    keys::release_modifiers(MODIFIERS_TIMEOUT);
    match open {
        Open::Plain => {
            keys::tap(keys::ENTER, &[]);
            if !paste.starts_with(AUTO_CLEAR) {
                keys::tap(keys::A, &[keys::CTRL]);
            }
        }
        Open::ReplyLast => keys::tap(keys::ENTER, &[keys::CTRL]),
        Open::BeforeLast => {
            keys::tap(keys::ENTER, &[keys::CTRL]);
            keys::tap(keys::HOME, &[]);
            // Дважды — с геймпадом первое нажатие только ставит фокус в строку (так в APT).
            keys::tap(keys::HOME, &[]);
            keys::tap(keys::DELETE, &[]);
        }
    }
    keys::tap(keys::V, &[keys::CTRL]);
    if send {
        keys::tap(keys::ENTER, &[]);
        // Вернуть в строку чата прежнее сообщение игрока и закрыть её.
        keys::tap(keys::ENTER, &[]);
        keys::tap(keys::UP, &[]);
        keys::tap(keys::UP, &[]);
        keys::tap(keys::ESCAPE, &[]);
    }

    thread::sleep(CLIPBOARD_RESTORE_AFTER);
    match previous {
        Some(old) => {
            let _ = clipboard.set_text(old);
        }
        None => {
            let _ = clipboard.clear();
        }
    }
    Ok(())
}

#[cfg(windows)]
mod keys {
    use super::{Instant, KEY_GAP};
    use std::thread;
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_A, VK_CONTROL, VK_DELETE, VK_ESCAPE, VK_HOME, VK_LWIN, VK_MENU, VK_RETURN, VK_RWIN, VK_SHIFT, VK_UP, VK_V,
    };

    pub type Key = VIRTUAL_KEY;
    pub const ENTER: Key = VK_RETURN;
    pub const CTRL: Key = VK_CONTROL;
    pub const A: Key = VK_A;
    pub const V: Key = VK_V;
    pub const HOME: Key = VK_HOME;
    pub const DELETE: Key = VK_DELETE;
    pub const UP: Key = VK_UP;
    pub const ESCAPE: Key = VK_ESCAPE;

    const MODIFIERS: [Key; 5] = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];

    fn input(vk: Key, up: bool) -> INPUT {
        // Стрелки, Home и Delete — «расширенные» клавиши: без флага игра читает их как цифровой блок.
        let extended = [VK_HOME, VK_DELETE, VK_UP].contains(&vk);
        let mut flags = if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) };
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        let scan = unsafe { MapVirtualKeyW(u32::from(vk.0), MAPVK_VK_TO_VSC) } as u16;
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
    }

    /// Нажать клавишу с модификаторами (они зажимаются до и отпускаются после).
    pub fn tap(key: Key, modifiers: &[Key]) {
        let mut inputs: Vec<INPUT> = modifiers.iter().map(|m| input(*m, false)).collect();
        inputs.push(input(key, false));
        inputs.push(input(key, true));
        inputs.extend(modifiers.iter().rev().map(|m| input(*m, true)));
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        thread::sleep(KEY_GAP);
    }

    fn held(vk: Key) -> bool {
        unsafe { GetAsyncKeyState(i32::from(vk.0)) as u16 & 0x8000 != 0 }
    }

    /// Дождаться, пока игрок отпустит модификаторы; не отпустил — отпустить их за него.
    pub fn release_modifiers(timeout: Duration) {
        let started = Instant::now();
        while MODIFIERS.iter().any(|m| held(*m)) && started.elapsed() < timeout {
            thread::sleep(Duration::from_millis(10));
        }
        let still: Vec<INPUT> = MODIFIERS.iter().filter(|m| held(**m)).map(|m| input(*m, true)).collect();
        if !still.is_empty() {
            unsafe {
                SendInput(&still, std::mem::size_of::<INPUT>() as i32);
            }
        }
    }
}

#[cfg(not(windows))]
mod keys {
    use std::time::Duration;

    pub type Key = u16;
    pub const ENTER: Key = 0;
    pub const CTRL: Key = 0;
    pub const A: Key = 0;
    pub const V: Key = 0;
    pub const HOME: Key = 0;
    pub const DELETE: Key = 0;
    pub const UP: Key = 0;
    pub const ESCAPE: Key = 0;

    pub fn tap(_key: Key, _modifiers: &[Key]) {}
    pub fn release_modifiers(_timeout: Duration) {}
}
