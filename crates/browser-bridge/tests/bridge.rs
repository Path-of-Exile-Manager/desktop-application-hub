//! Полный путь «Chrome → мост → именованный канал → приложение» на настоящем канале Windows.
//! Вместо stdio Chrome — потоки в памяти.
#![cfg(windows)]

use std::sync::Arc;
use std::time::Duration;

use browser_bridge::frame::{read_frame, write_frame};
use browser_bridge::relay::relay;
use browser_bridge::server::{Hub, serve};
use serde_json::Value;
use tokio::io::DuplexStream;
use tokio::time::timeout;

fn unique_pipe() -> String {
    format!(r"\\.\pipe\poe-manager-bridge-test-{}-{}", std::process::id(), rand_suffix())
}

fn rand_suffix() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
}

async fn next(chrome: &mut DuplexStream) -> Value {
    let frame = timeout(Duration::from_secs(5), read_frame(chrome)).await.expect("ответ за 5 с").unwrap().expect("кадр");
    serde_json::from_slice(&frame).unwrap()
}

/// Мост с «Chrome» на другом конце потоков в памяти.
fn start_relay(pipe: &str) -> (DuplexStream, DuplexStream) {
    let (chrome_out, bridge_in) = tokio::io::duplex(64 * 1024);
    let (bridge_out, chrome_in) = tokio::io::duplex(64 * 1024);
    let pipe = pipe.to_string();
    tokio::spawn(async move { relay(bridge_in, bridge_out, &pipe, Duration::from_millis(100)).await });
    (chrome_out, chrome_in)
}

#[tokio::test(flavor = "multi_thread")]
async fn handshake_through_real_pipe() {
    let pipe = unique_pipe();
    let hub = Hub::new("9.9.9", |_| {});
    spawn_server(&pipe, hub.clone());

    let (mut to_bridge, mut from_bridge) = start_relay(&pipe);
    // Сервер мог не успеть создать канал раньше моста: тогда сначала придёт running: false.
    let mut status = next(&mut from_bridge).await;
    if status["running"] == false {
        status = next(&mut from_bridge).await;
    }
    assert_eq!(status["running"], true);

    write_frame(&mut to_bridge, br#"{"v":1,"type":"hello","id":"h1","extVersion":"0.2.0","browser":"chrome"}"#).await.unwrap();
    let welcome = next(&mut from_bridge).await;
    assert_eq!(welcome["type"], "welcome");
    assert_eq!(welcome["appVersion"], "9.9.9");
    assert_eq!(hub.snapshot().clients.len(), 1);

    // Chrome закрыл порт → мост выходит, приложение видит отключение.
    drop(to_bridge);
    timeout(Duration::from_secs(5), async {
        while !hub.snapshot().clients.is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("приложение заметило отключение");
}

#[tokio::test(flavor = "multi_thread")]
async fn waits_for_app_and_reports_when_it_appears() {
    let pipe = unique_pipe();
    let (_to_bridge, mut from_bridge) = start_relay(&pipe);
    assert_eq!(next(&mut from_bridge).await["running"], false, "приложение ещё не запущено");

    let hub = Hub::new("1.0.0", |_| {});
    spawn_server(&pipe, hub);
    assert_eq!(next(&mut from_bridge).await["running"], true, "мост сам нашёл запущенное приложение");
}

#[tokio::test(flavor = "multi_thread")]
async fn second_server_on_same_pipe_fails() {
    let pipe = unique_pipe();
    let _first = browser_bridge::pipe::create_server(&pipe, true).unwrap();
    assert!(browser_bridge::pipe::create_server(&pipe, true).is_err(), "второй экземпляр приложения не перехватит канал");
}

fn spawn_server(pipe: &str, hub: Arc<Hub>) {
    let pipe = pipe.to_string();
    tokio::spawn(async move {
        let _ = serve(&pipe, hub).await;
    });
}
