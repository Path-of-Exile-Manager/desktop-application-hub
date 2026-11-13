//! Оверлей Price check поверх игры: второе окно Tauri (`overlay`) без рамки, с прозрачным фоном,
//! всегда сверху и без кнопки на панели задач. Создаётся скрытым при запуске; показывается у курсора
//! после захвата предмета горячей клавишей и закрывается по Esc, по клику мимо (если не закреплён)
//! или кнопкой. Интерфейс окна — тот же фронтенд, по метке окна (`ui/src/overlay/OverlayApp.tsx`).
//!
//! Игра в режиме «полный экран» (exclusive) поверх себя ничего не показывает — нужен оконный
//! режим или «окно без рамки».

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

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

/// Где показан оверлей: курсор в момент захвата и границы (физические пиксели экрана). Высота окна
/// меняется после показа — под новый предмет (`overlay_fit`), и окно заново укладывается в границы
/// от той же точки: иначе высокий предмет у нижнего края уходил за экран.
#[derive(Clone, Copy)]
struct Anchor {
    cursor: (f64, f64),
    gap: f64,
    /// Левый, верхний, правый, нижний края; `None` — монитор не определён.
    bounds: Option<(f64, f64, f64, f64)>,
}

static ANCHOR: Mutex<Option<Anchor>> = Mutex::new(None);

/// Границы оверлея: рабочая область монитора под курсором, а если найдено окно игры — его
/// клиентская часть в пределах этого монитора (окно игры может выходить за экран).
fn bounds(app: &AppHandle, x: f64, y: f64) -> Option<(f64, f64, f64, f64)> {
    let monitor = app.monitor_from_point(x, y).ok().flatten().map(|m| {
        let a = m.work_area();
        let (l, t) = (a.position.x as f64, a.position.y as f64);
        (l, t, l + a.size.width as f64, t + a.size.height as f64)
    });
    let game = crate::game::current(app).window.map(|g| {
        let r = g.client;
        (r.x as f64, r.y as f64, (r.x + r.width) as f64, (r.y + r.height) as f64)
    });
    match (game, monitor) {
        (Some(g), Some(m)) => {
            let cut = (g.0.max(m.0), g.1.max(m.1), g.2.min(m.2), g.3.min(m.3));
            // Игра на другом мониторе (курсор вне неё) — пересечения нет, берём монитор.
            Some(if cut.0 < cut.2 && cut.1 < cut.3 { cut } else { m })
        }
        (g, m) => m.or(g),
    }
}

/// Позиция окна `w`×`h` у точки привязки: справа от курсора, если влезает, иначе слева; по
/// вертикали треть окна выше курсора; всё — в пределах границ.
fn position(anchor: &Anchor, w: f64, h: f64) -> (f64, f64) {
    let (cx, cy) = anchor.cursor;
    let mut x = cx + anchor.gap;
    let mut y = cy - h / 3.0;
    if let Some((left, top, right, bottom)) = anchor.bounds {
        if x + w > right {
            x = cx - anchor.gap - w;
        }
        x = x.clamp(left, (right - w).max(left));
        y = y.clamp(top, (bottom - h).max(top));
    }
    (x, y)
}

fn place(window: &tauri::WebviewWindow, anchor: &Anchor, w: f64, h: f64) {
    let (x, y) = position(anchor, w, h);
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// Показать оверлей у курсора (в пределах окна игры, если оно найдено) и отдать ему фокус.
pub fn show_near_cursor(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if let Ok(cursor) = app.cursor_position() {
        // Масштаб — монитора под курсором: окно могло остаться на другом.
        let scale = app.monitor_from_point(cursor.x, cursor.y).ok().flatten().map(|m| m.scale_factor()).or_else(|| window.scale_factor().ok()).unwrap_or(1.0);
        let anchor = Anchor { cursor: (cursor.x, cursor.y), gap: CURSOR_GAP * scale, bounds: bounds(app, cursor.x, cursor.y) };
        *ANCHOR.lock().unwrap() = Some(anchor);
        if let Ok(size) = window.outer_size() {
            place(&window, &anchor, size.width as f64, size.height as f64);
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Размер окна под содержимое (логические пиксели интерфейса) и позиция заново от точки показа.
/// Выше границ окно не становится. Ответ — наибольшая высота в логических пикселях (`null` —
/// границ нет): интерфейс ограничивает ею рамку и прокручивает остальное.
#[tauri::command]
pub fn overlay_fit(app: AppHandle, width: f64, height: f64) -> Option<f64> {
    let window = app.get_webview_window(LABEL)?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let anchor = *ANCHOR.lock().unwrap();
    let max = anchor.and_then(|a| a.bounds).map(|(_, top, _, bottom)| bottom - top);
    let w = (width * scale).ceil();
    let h = max.map_or((height * scale).ceil(), |max| (height * scale).ceil().min(max));
    if let Some(anchor) = anchor {
        place(&window, &anchor, w, h);
    }
    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
    max.map(|max| (max / scale).floor())
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
