//! «Приложение» без окна: слушает канал расширения и отвечает на рукопожатие.
//! Для проверки режима моста настоящего exe без запуска всего приложения:
//!
//! ```text
//! cargo run -p browser-bridge --example fake_app        # в одном терминале
//! node scripts/bridge-smoke.mjs                          # в другом
//! ```
//!
//! Внимание: занимает тот же канал, что и настоящее приложение, — не запускайте их одновременно.

use browser_bridge::pipe::default_pipe_name;
use browser_bridge::server::{Hub, serve};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let name = default_pipe_name();
    let hub = Hub::new("fake-app", |snapshot| {
        let clients: Vec<String> = snapshot.clients.iter().map(|c| format!("{} {}", c.browser, c.ext_version)).collect();
        println!("на связи: {clients:?}");
    });
    println!("слушаю {name}");
    if let Err(e) = serve(&name, hub).await {
        eprintln!("ошибка: {e}");
        std::process::exit(1);
    }
}
