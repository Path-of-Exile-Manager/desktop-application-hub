//! Поддельное окно Path of Exile для ручной проверки poe-manager без игры.
//!
//! cargo run -p game-window --example fake_poe                 — оконный, 1280×720
//! cargo run -p game-window --example fake_poe -- borderless   — без рамки на весь основной монитор
//! cargo run -p game-window --example fake_poe -- poe2         — окно Path of Exile 2
//!
//! Закрыть — Ctrl+C в консоли или закрыть окно.

fn main() {
    #[cfg(windows)]
    {
        use game_window::fake::{spawn, FakeOptions};
        let arg = std::env::args().nth(1).unwrap_or_default();
        let borderless = arg == "borderless";
        let title = if arg == "poe2" { "Path of Exile 2" } else { "Path of Exile" };
        let (width, height) = if borderless { primary_monitor_size() } else { (1280, 720) };
        let (x, y) = if borderless { (0, 0) } else { (120, 80) };
        let window = spawn(FakeOptions { title, borderless, x, y, width, height, no_activate: false }).expect("create window");
        println!("Поддельное окно «{title}» ({width}×{height}, {}) — hwnd {:#x}. Ctrl+C — выход.",
            if borderless { "без рамки" } else { "оконный" }, window.hwnd);
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let status = game_window::detect();
            println!("{:?} · {:?}", status.state, status.window.map(|w| (w.mode, w.focused, w.client)));
        }
    }
}

#[cfg(windows)]
fn primary_monitor_size() -> (i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}
