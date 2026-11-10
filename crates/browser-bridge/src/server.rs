//! Сторона приложения: принимает подключения мостов (по одному на профиль Chrome),
//! отвечает на рукопожатие, сообщает, какие расширения сейчас на связи, передаёт приложению
//! остальные сообщения и умеет писать расширениям само: рассылка всем ([`Hub::broadcast`]) и запрос
//! к профилю, который был активен последним ([`Hub::request_latest`]).

use std::collections::{BTreeMap, HashMap};
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{Map, Value};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};

use crate::frame::{read_frame, write_json};
use crate::protocol::{self, Incoming};

/// Возможности этой версии приложения по умолчанию (без обработчика сообщений): только рукопожатие.
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

/// Что приложение сделало с сообщением, которое не относится к рукопожатию.
pub enum Handled {
    /// Тип не знаком — на запрос ответим `not-supported`.
    Unknown,
    /// Ответить этим сообщением (его `re` проставит обработчик).
    Reply(Value),
    /// Принято, ответа не нужно.
    Done,
}

type Listener = Box<dyn Fn(Snapshot) + Send + Sync>;
type Handler = Box<dyn Fn(u64, &str, &Value) -> Handled + Send + Sync>;
/// Поля, которые добавляются в `welcome` (возможности, состояние аккаунта…).
type WelcomeExtra = Box<dyn Fn() -> Map<String, Value> + Send + Sync>;

struct Client {
    info: Option<ClientInfo>,
    tx: mpsc::UnboundedSender<Value>,
    /// Когда от клиента приходило последнее сообщение.
    last_active: u64,
}

/// Общее состояние сервера. Транспорт не важен: в приложении — именованный канал ([`serve`]),
/// в тестах — `tokio::io::duplex`.
pub struct Hub {
    app_version: String,
    next_id: AtomicU64,
    clients: Mutex<BTreeMap<u64, Client>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    on_change: Listener,
    handler: Handler,
    welcome_extra: WelcomeExtra,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Hub {
    pub fn new(app_version: impl Into<String>, on_change: impl Fn(Snapshot) + Send + Sync + 'static) -> Arc<Self> {
        Self::with_handler(app_version, on_change, |_, _, _| Handled::Unknown, Map::new)
    }

    /// Сервер с обработчиком сообщений приложения и дополнительными полями `welcome`.
    pub fn with_handler(
        app_version: impl Into<String>,
        on_change: impl Fn(Snapshot) + Send + Sync + 'static,
        handler: impl Fn(u64, &str, &Value) -> Handled + Send + Sync + 'static,
        welcome_extra: impl Fn() -> Map<String, Value> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            app_version: app_version.into(),
            next_id: AtomicU64::new(1),
            clients: Mutex::new(BTreeMap::new()),
            pending: Mutex::new(HashMap::new()),
            on_change: Box::new(on_change),
            handler: Box::new(handler),
            welcome_extra: Box::new(welcome_extra),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot { clients: self.clients.lock().unwrap().values().filter_map(|c| c.info.clone()).collect() }
    }

    fn notify(&self) {
        (self.on_change)(self.snapshot());
    }

    /// Отправить всем расширениям, прошедшим рукопожатие. Возвращает, скольким.
    pub fn broadcast(&self, message: &Value) -> usize {
        self.clients.lock().unwrap().values().filter(|c| c.info.is_some()).filter(|c| c.tx.send(message.clone()).is_ok()).count()
    }

    /// Запрос профилю, который был активен последним; ответ — сообщение с `re` = `id` запроса.
    /// `None` — никого нет на связи.
    pub fn request_latest(&self, message: Value) -> Option<oneshot::Receiver<Value>> {
        let id = message.get("id").and_then(Value::as_str)?.to_string();
        let clients = self.clients.lock().unwrap();
        let client = clients.values().filter(|c| c.info.is_some()).max_by_key(|c| c.last_active)?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        client.tx.send(message).ok()?;
        Some(rx)
    }

    /// Отправить одному клиенту.
    pub fn send_to(&self, client: u64, message: Value) -> bool {
        self.clients.lock().unwrap().get(&client).is_some_and(|c| c.tx.send(message).is_ok())
    }

    /// Обслужить одно подключение до его закрытия.
    pub async fn handle<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(self: &Arc<Self>, stream: S) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (mut reader, mut writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        self.clients.lock().unwrap().insert(id, Client { info: None, tx: tx.clone(), last_active: now_ms() });
        // Пишет одна задача: ответы, рассылки и запросы приложения не перемешиваются внутри кадра.
        let writer_task = tokio::spawn(async move {
            while let Some(message) = rx.recv().await {
                if write_json(&mut writer, &message).await.is_err() {
                    break;
                }
            }
        });

        loop {
            let frame = match read_frame(&mut reader).await {
                Ok(Some(frame)) => frame,
                Ok(None) | Err(_) => break,
            };
            if let Some(client) = self.clients.lock().unwrap().get_mut(&id) {
                client.last_active = now_ms();
            }
            // Ответ на запрос приложения — тому, кто ждёт.
            if let Ok(value) = serde_json::from_slice::<Value>(&frame)
                && let Some(re) = value.get("re").and_then(Value::as_str)
            {
                let waiting = self.pending.lock().unwrap().remove(re);
                if let Some(waiting) = waiting {
                    let _ = waiting.send(value);
                    continue;
                }
            }
            let reply = match protocol::parse(&frame) {
                Ok(Incoming::Hello { id: request, hello }) => {
                    let info = ClientInfo {
                        browser: hello.browser,
                        ext_version: hello.ext_version,
                        browser_version: hello.browser_version,
                        extension_id: hello.extension_id,
                        connected_at: now_ms(),
                    };
                    if let Some(client) = self.clients.lock().unwrap().get_mut(&id) {
                        client.info = Some(info);
                    }
                    self.notify();
                    let mut welcome = protocol::welcome(request.as_deref(), &self.app_version, FEATURES);
                    if let Value::Object(fields) = &mut welcome {
                        fields.extend((self.welcome_extra)());
                    }
                    Some(welcome)
                }
                Ok(Incoming::Unknown { id: request, kind }) => {
                    let value: Value = serde_json::from_slice(&frame).unwrap_or(Value::Null);
                    match (self.handler)(id, &kind, &value) {
                        Handled::Reply(reply) => Some(reply),
                        Handled::Done => None,
                        Handled::Unknown => request.map(|r| protocol::error(Some(&r), "not-supported", &format!("приложение не знает сообщение «{kind}»"))),
                    }
                }
                Err(e) => Some(protocol::error(e.id.as_deref(), "invalid", &e.message)),
            };
            if let Some(reply) = reply
                && tx.send(reply).is_err()
            {
                break;
            }
        }
        // Отправитель клиента уходит вместе с записью: тогда задача записи дописывает очередь и завершается.
        let was_greeted = self.clients.lock().unwrap().remove(&id).is_some_and(|c| c.info.is_some());
        drop(tx);
        let _ = writer_task.await;
        if was_greeted {
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
