//! Проверка поиска окна на поддельном окне игры.
//! Ненадолго показывает маленькое окно в углу экрана, фокус не забирает.
//! Если в этот момент запущен настоящий Path of Exile — тест его тоже увидит.

#![cfg(windows)]

use game_window::fake::{spawn, FakeOptions};
use game_window::{detect, GameKind, GameState, WindowMode};

fn opts(title: &str) -> FakeOptions<'_> {
    FakeOptions { title, borderless: false, x: 40, y: 40, width: 320, height: 200, no_activate: true }
}

// Один тест, а не несколько: окна одного класса в параллельных тестах мешали бы друг другу.
#[test]
fn finds_fake_game_windows() {
    // Сначала игры нет (если не запущена настоящая).
    let before = detect();
    if before.state != GameState::NotRunning {
        eprintln!("Path of Exile уже запущен — пропускаю проверку на поддельном окне");
        return;
    }

    // Только PoE2 — не поддерживается.
    let poe2 = spawn(opts("Path of Exile 2")).expect("create PoE2 window");
    let s = detect();
    assert_eq!(s.state, GameState::Unsupported);
    assert_eq!(s.window.as_ref().unwrap().kind, GameKind::Poe2);

    // PoE1 рядом с PoE2 — выбираем PoE1.
    let poe1 = spawn(opts("Path of Exile")).expect("create PoE1 window");
    let s = detect();
    assert_eq!(s.state, GameState::Running);
    let w = s.window.unwrap();
    assert_eq!(w.kind, GameKind::Poe1);
    assert_eq!(w.hwnd, poe1.hwnd);
    assert_eq!(w.pid, std::process::id());
    assert_eq!(w.mode, WindowMode::Windowed);
    assert_eq!(w.elevated, Some(s.app_elevated));
    assert!(w.exe.as_deref().is_some_and(|e| e.ends_with(".exe")));
    assert!(w.client.width > 0 && w.client.height > 0);

    drop(poe1);
    drop(poe2);
    assert_eq!(detect().state, GameState::NotRunning);
}
