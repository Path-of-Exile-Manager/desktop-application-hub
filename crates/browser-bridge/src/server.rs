//! Сторона приложения: принимает подключения мостов (по одному на профиль Chrome),
//! отвечает на рукопожатие и сообщает, какие расширения сейчас на связи.

use std::collections::BTreeMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::frame::{read_frame, write_json};
use crate::protocol::{self, Incoming};

/// Возможности этой версии приложения — расширение по ним понимает, что можно просить.
/// Этап 1: только рукопожатие и статус.
pub const FEATURES: &[&str] = &[];

/// Расширение, которое прошло рукопожатие.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub browser: String,
    pub ext_version: String,
    pub browser_version: Option<String>,
    pub extension_id: Option<String>,
    /// Время рукопожатия, мс с 1970-01-01.
    pub connected_at: u64,
}

/// Кто на связи. Порядок — по времени подключения, последний — самый свежий.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Snapshot {
    pub clients: Vec<ClientInfo>,
}

type Listener = Box<dyn Fn(Snapshot) + Send + Sync>;

/// Общее состояние сервера. Транспорт не важен: в приложении — именованный канал ([`serve`]),
/// в тестах — `tokio::io::duplex`.
pub struct Hub {
    app_version: String,
    next_id: AtomicU64,
    clients: Mutex<BTreeMap<u64, ClientInfo>>,
    on_change: Listener,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Hub {
    pub fn new(app_version: impl Into<String>, on_change: impl Fn(Snapshot) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { app_version: app_version.into(), next_id: AtomicU64::new(1), clients: Mutex::new(BTreeMap::new()), on_change: Box::new(on_change) })
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot { clients: self.clients.lock().unwrap().values().cloned().collect() }
    }

    fn notify(&self) {
        (self.on_change)(self.snapshot());
    }

    /// Обслужить одно подключение до его закрытия.
    pub async fn handle<S: AsyncRead + AsyncWrite + Unpin>(self: &Arc<Self>, stream: S) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (mut reader, mut writer) = tokio::io::split(stream);
        loop {
            let frame = match read_frame(&mut reader).await {
                Ok(Some(frame)) => frame,
                Ok(None) | Err(_) => break,
            };
            let reply = match protocol::parse(&frame) {
                Ok(Incoming::Hello { id: request, hello }) => {
                    let info = ClientInfo {
                        browser: hello.browser,
                        ext_version: hello.ext_version,
                        browser_version: hello.browser_version,
                        extension_id: hello.extension_id,
                        connected_at: now_ms(),
                    };
                    self.clients.lock().unwrap().insert(id, info);
                    self.notify();
                    Some(protocol::welcome(request.as_deref(), &self.app_version, FEATURES))
                }
                Ok(Incoming::Unknown { id: Some(request), kind }) => {
                    Some(protocol::error(Some(&request), "not-supported", &format!("приложение не знает сообщение «{kind}»")))
                }
                Ok(Incoming::Unknown { id: None, .. }) => None,
                Err(e) => Some(protocol::error(e.id.as_deref(), "invalid", &e.message)),
            };
            if let Some(reply) = reply
                && write_json(&mut writer, &reply).await.is_err()
            {
                break;
            }
        }
        if self.clients.lock().unwrap().remove(&id).is_some() {
            self.notify();
        }
    }
}

/// Принимать подключения мостов по именованному каналу, пока приложение работает.
/// Ошибка сразу — канал занят (запущен второй экземпляр приложения).
#[cfg(windows)]
pub async fn serve(pipe_name: &str, hub: Arc<Hub>) -> io::Result<()> {
    use crate::pipe::create_server;
    let mut server = create_server(pipe_name, true)?;
    loop {
        server.connect().await?;
        let connected = server;
        // Следующий экземпляр создаём сразу, чтобы второй профиль Chrome мог подключиться.
        server = create_server(pipe_name, false)?;
        let hub = hub.clone();
        tokio::spawn(async move { hub.handle(connected).await });
    }
}

#[cfg(not(windows))]
pub async fn serve(_pipe_name: &str, _hub: Arc<Hub>) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "связь с расширением есть только в Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::write_frame;
    use std::sync::atomic::AtomicUsize;

    async fn reply(stream: &mut tokio::io::DuplexStream) -> serde_json::Value {
        serde_json::from_slice(&read_frame(stream).await.unwrap().unwrap()).unwrap()
    }

    #[tokio::test]
    async fn handshake_status_and_disconnect() {
        let changes = Arc::new(AtomicUsize::new(0));
        let seen = changes.clone();
        let hub = Hub::new("0.1.0", move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
        });
        let (mut ext, app) = tokio::io::duplex(4096);
        let task = tokio::spawn({
            let hub = hub.clone();
            async move { hub.handle(app).await }
        });

        write_frame(&mut ext, br#"{"v":1,"type":"hello","id":"h1","extVersion":"0.2.0","browser":"chrome"}"#).await.unwrap();
        let welcome = reply(&mut ext).await;
        assert_eq!((welcome["type"].as_str(), welcome["re"].as_str(), welcome["appVersion"].as_str()), (Some("welcome"), Some("h1"), Some("0.1.0")));
        assert_eq!(hub.snapshot().clients[0].ext_version, "0.2.0");

        write_frame(&mut ext, br#"{"v":1,"type":"bookmarks.sync","id":"q2"}"#).await.unwrap();
        let error = reply(&mut ext).await;
        assert_eq!((error["code"].as_str(), error["re"].as_str()), (Some("not-supported"), Some("q2")));

        write_frame(&mut ext, b"oops").await.unwrap();
        assert_eq!(reply(&mut ext).await["code"], "invalid");

        drop(ext);
        task.await.unwrap();
        assert!(hub.snapshot().clients.is_empty());
        assert_eq!(changes.load(Ordering::SeqCst), 2, "подключился и отключился");
    }
}
