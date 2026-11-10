//! Оверлей Price check поверх игры: второе окно Tauri (`overlay`) без рамки, с прозрачным фоном,
//! всегда сверху и без кнопки на панели задач. Создаётся скрытым при запуске; показывается у курсора
//! после захвата предмета горячей клавишей и закрывается по Esc, по клику мимо (если не закреплён)
//! или кнопкой. Интерфейс окна — тот же фронтенд, по метке окна (`ui/src/overlay/OverlayApp.tsx`).
//!
//! Игра в режиме «полный экран» (exclusive) поверх себя ничего не показывает — нужен оконный
//! режим или «окно без рамки».

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";
/// Ширина рамки оверлея (`--layout-overlay-width` в токенах) с запасом; высоту окно подгоняет под содержимое.
const WIDTH: f64 = 460.0;
const HEIGHT: f64 = 560.0;
/// Отступ от курсора, чтобы оверлей не закрывал сам предмет.
const CURSOR_GAP: f64 = 24.0;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("poe-manager — Price check")
        .inner_size(WIDTH, HEIGHT)
        .visible(false)
        .focused(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .build()?;
    Ok(())
}

/// Показать оверлей у курсора (в пределах окна игры, если оно найдено) и отдать ему фокус.
pub fn show_near_cursor(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if let (Ok(cursor), Ok(size), Ok(scale)) = (app.cursor_position(), window.outer_size(), window.scale_factor()) {
        let (w, h) = (size.width as f64, size.height as f64);
        let gap = CURSOR_GAP * scale;
        // Справа от курсора, если влезает, иначе слева; по вертикали — центр на курсоре.
        let mut x = cursor.x + gap;
        let mut y = cursor.y - h / 3.0;
        // Границы: окно игры, а без него — рабочая область монитора под курсором.
        let bounds = match crate::game::current(app).window {
            Some(game) => {
                let r = game.client;
                Some((r.x as f64, r.y as f64, (r.x + r.width) as f64, (r.y + r.height) as f64))
            }
            None => app.monitor_from_point(cursor.x, cursor.y).ok().flatten().map(|m| {
                let a = m.work_area();
                let (l, t) = (a.position.x as f64, a.position.y as f64);
                (l, t, l + a.size.width as f64, t + a.size.height as f64)
            }),
        };
        if let Some((left, top, right, bottom)) = bounds {
            if x + w > right {
                x = cursor.x - gap - w;
            }
            x = x.clamp(left, (right - w).max(left));
            y = y.clamp(top, (bottom - h).max(top));
        }
        let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Показать оверлей с последней оценкой (страница «Режим разработки» — проверка без игры).
#[tauri::command]
pub fn overlay_show(app: AppHandle) {
    show_near_cursor(&app);
}

/// Скрыть оверлей. `restore_game` — вернуть фокус игре (Esc, кнопка «Закрыть»).
#[tauri::command]
pub fn overlay_hide(app: AppHandle, restore_game: bool) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    if restore_game
        && let Some(game) = crate::game::current(&app).window {
            focus_window(game.hwnd);
        }
}

/// «Подробнее в окне»: скрыть оверлей, показать главное окно на странице Price check.
#[tauri::command]
pub fn overlay_open_main(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit("open-module", "price-check");
}

#[cfg(windows)]
fn focus_window(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    unsafe {
        let _ = SetForegroundWindow(HWND(hwnd as *mut core::ffi::c_void));
    }
}

#[cfg(not(windows))]
fn focus_window(_hwnd: isize) {}
