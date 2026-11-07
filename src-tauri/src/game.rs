//! Слежение за окном Path of Exile: фоновый поток раз в 700 мс проверяет окно игры
//! и сообщает интерфейсу событием `game-status`, только когда что-то изменилось.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use game_window::GameStatus;
use tauri::{AppHandle, Emitter, Manager, State};

/// Имя события, которое слушает интерфейс.
pub const EVENT: &str = "game-status";

const POLL_INTERVAL: Duration = Duration::from_millis(700);

/// Последнее известное состояние — для команды `game_status` при запуске интерфейса.
pub struct GameWatcher(Mutex<GameStatus>);

pub fn start(app: &AppHandle) {
    app.manage(GameWatcher(Mutex::new(game_window::detect())));
    let app = app.clone();
    thread::Builder::new()
        .name("game-window-watcher".into())
        .spawn(move || loop {
            thread::sleep(POLL_INTERVAL);
            let status = game_window::detect();
            let watcher = app.state::<GameWatcher>();
            let mut last = watcher.0.lock().unwrap();
            if *last != status {
                *last = status.clone();
                drop(last);
                crate::discord::on_game_status(&app, &status);
                let _ = app.emit(EVENT, status);
            }
        })
        .expect("spawn game window watcher");
}

/// Последнее известное состояние для других частей ядра.
pub fn current(app: &AppHandle) -> GameStatus {
    app.state::<GameWatcher>().0.lock().unwrap().clone()
}

/// Текущее состояние окна игры: `invoke("game_status")`.
#[tauri::command]
pub fn game_status(watcher: State<GameWatcher>) -> GameStatus {
    watcher.0.lock().unwrap().clone()
}
