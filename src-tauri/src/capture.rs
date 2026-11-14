//! Захват предмета из игры: горячая клавиша → Ctrl+Alt+C в игру → текст из буфера обмена → оценка.
//!
//! Клавишу (по умолчанию Ctrl+D) регистрирует и разбирает `hotkeys.rs` вместе с командами чата.
//!
//! Буфер обмена пользователя не портится: прежний текст запоминается и возвращается после захвата.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::appraise;

/// Событие ошибки захвата (игра не скопировала предмет, текст не разобран).
pub const EVENT_FAILED: &str = "item-capture-failed";

/// Сколько ждать, пока игра положит текст в буфер.
const CLIPBOARD_TIMEOUT: Duration = Duration::from_millis(600);
const CLIPBOARD_POLL: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CaptureFailure {
    pub message: String,
}

/// Идёт захват: повторное нажатие до его конца игнорируется.
pub struct CaptureService(Mutex<bool>);

pub fn start(app: &AppHandle) {
    app.manage(CaptureService(Mutex::new(false)));
}

/// Нажата клавиша проверки (`hotkeys.rs`) — захват в своём потоке; повторное нажатие во время захвата игнорируется.
pub fn trigger(app: &AppHandle) {
    let service = app.state::<CaptureService>();
    {
        let mut busy = service.0.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
    }
    let app = app.clone();
    thread::spawn(move || {
        let result = capture_from_game().and_then(|text| appraise::appraise(&app, &text));
        match result {
            Ok(appraisal) => {
                appraise::publish(&app, appraisal);
                // Захват из игры — показать цену прямо поверх неё.
                crate::overlay::show_near_cursor(&app);
            }
            Err(message) => {
                let _ = app.emit(EVENT_FAILED, CaptureFailure { message });
            }
        }
        *app.state::<CaptureService>().0.lock().unwrap() = false;
    });
}

/// Ctrl+Alt+C в игру и текст предмета из буфера; прежний текст буфера возвращается.
fn capture_from_game() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("буфер обмена недоступен: {e}"))?;
    let previous = clipboard.get_text().ok();
    // Пустой буфер — чтобы отличить свежий текст игры от старого.
    let _ = clipboard.clear();

    send_copy_advanced();

    let started = Instant::now();
    let text = loop {
        if let Ok(text) = clipboard.get_text()
            && is_item_text(&text) {
                break Some(text);
            }
        if started.elapsed() > CLIPBOARD_TIMEOUT {
            break None;
        }
        thread::sleep(CLIPBOARD_POLL);
    };

    match &previous {
        Some(old) => {
            let _ = clipboard.set_text(old.clone());
        }
        None => {
            let _ = clipboard.clear();
        }
    }
    text.ok_or_else(|| "игра не скопировала предмет — наведите курсор на предмет".into())
}

fn is_item_text(text: &str) -> bool {
    let first = text.trim_start();
    first.starts_with("Item Class: ") || first.starts_with("Класс предмета: ")
}

/// Ctrl+Alt+C (расширенное описание предмета) через SendInput.
#[cfg(windows)]
fn send_copy_advanced() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_C, VK_CONTROL, VK_MENU,
    };
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 },
        },
    };
    let inputs = [key(VK_CONTROL, false), key(VK_MENU, false), key(VK_C, false), key(VK_C, true), key(VK_MENU, true), key(VK_CONTROL, true)];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn send_copy_advanced() {}

/// Оценить предмет, который уже лежит в буфере обмена (скопирован в игре вручную).
#[tauri::command]
pub async fn capture_from_clipboard(app: AppHandle) -> Result<appraise::Appraisal, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let text = arboard::Clipboard::new().and_then(|mut c| c.get_text()).map_err(|_| "в буфере обмена нет текста".to_string())?;
        if !is_item_text(&text) {
            return Err("в буфере обмена не предмет Path of Exile".to_string());
        }
        let appraisal = appraise::appraise(&handle, &text)?;
        appraise::publish(&handle, appraisal.clone());
        Ok(appraisal)
    })
    .await
    .map_err(|e| e.to_string())?
}
