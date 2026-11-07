//! Сессия с клиентом Discord: подключение, рукопожатие, подписки, статус, переподключение.
//!
//! [`run`] работает, пока жив канал команд: Discord закрыт или перезапущен — ждём [`RETRY_INTERVAL`]
//! (или команду) и подключаемся снова. Последний заданный статус запоминается и выставляется
//! заново после каждого подключения. Обо всём, включая каждый кадр в обе стороны, сообщаем через `on_event`.

use std::io;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::AsyncWrite;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::frame::{self, Frame, Opcode};
use crate::ipc;

/// Пауза между попытками подключиться, пока Discord не запущен.
pub const RETRY_INTERVAL: Duration = Duration::from_secs(15);
/// Сколько ждём `READY` после рукопожатия.
const READY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub enum Command {
    /// Выставить (`Some`) или снять (`None`) статус. Запоминается и повторяется после переподключения.
    SetActivity(Option<Value>),
    /// Разорвать соединение и сразу подключиться заново.
    Reconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// От нас в Discord.
    Out,
    /// От Discord к нам.
    In,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
}

impl User {
    fn from_json(value: &Value) -> Self {
        User {
            id: value["id"].as_str().unwrap_or_default().to_string(),
            username: value["username"].as_str().unwrap_or_default().to_string(),
            global_name: value["global_name"].as_str().map(str::to_string),
        }
    }
}

#[derive(Debug, Clone)]
pub enum Event {
    Connecting,
    /// Рукопожатие прошло, Discord прислал `READY`.
    Connected { pipe: u8, user: User },
    /// Соединения нет. `error: None` — разорвали сами (команда `Reconnect`).
    Disconnected { error: Option<String> },
    /// Ответ на `SET_ACTIVITY`: `None` — принят, иначе текст ошибки от Discord.
    ActivityResult { error: Option<String> },
    /// Получатель нажал «Присоединиться» в приглашении.
    Join { secret: String },
    /// Кто-то просит присоединиться («Попросить присоединиться» в профиле).
    JoinRequest { user: User },
    /// Каждый кадр в обе стороны — для журнала обмена.
    Frame { direction: Direction, opcode: Opcode, body: Value },
}

/// Отправка команд в запущенную сессию.
#[derive(Debug, Clone)]
pub struct Handle(mpsc::UnboundedSender<Command>);

impl Handle {
    pub fn send(&self, command: Command) {
        let _ = self.0.send(command);
    }
}

pub fn channel() -> (Handle, mpsc::UnboundedReceiver<Command>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (Handle(tx), rx)
}

enum Exit {
    /// Канал команд закрыт — сессия больше не нужна.
    Closed,
    Reconnect,
}

/// Работать с Discord, пока жив канал команд. Запускать внутри рантайма tokio.
pub async fn run<F>(client_id: String, mut commands: mpsc::UnboundedReceiver<Command>, on_event: F)
where
    F: Fn(Event) + Send + Sync + 'static,
{
    let mut desired: Option<Value> = None;
    loop {
        on_event(Event::Connecting);
        let error = match session(&client_id, &mut commands, &mut desired, &on_event).await {
            Ok(Exit::Closed) => return,
            Ok(Exit::Reconnect) => {
                on_event(Event::Disconnected { error: None });
                continue;
            }
            Err(e) => e.to_string(),
        };
        on_event(Event::Disconnected { error: Some(error) });

        let sleep = tokio::time::sleep(RETRY_INTERVAL);
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                command = commands.recv() => match command {
                    None => return,
                    Some(Command::SetActivity(activity)) => desired = activity,
                    Some(Command::Reconnect) => break,
                },
            }
        }
    }
}

/// Читатель кадров живёт в отдельной задаче (`read_exact` нельзя прерывать в `select!`)
/// и останавливается вместе с сессией.
struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn session<F: Fn(Event)>(
    client_id: &str,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    desired: &mut Option<Value>,
    on_event: &F,
) -> io::Result<Exit> {
    let (pipe, index) = ipc::connect().map_err(|e| io::Error::new(e.kind(), format!("Discord не запущен ({e})")))?;
    let (mut reader, mut writer) = tokio::io::split(pipe);

    let (frames_tx, mut frames) = mpsc::unbounded_channel::<io::Result<Option<Frame>>>();
    let _reader = AbortOnDrop(tokio::spawn(async move {
        loop {
            let result = frame::read_frame(&mut reader).await;
            let stop = !matches!(result, Ok(Some(_)));
            if frames_tx.send(result).is_err() || stop {
                break;
            }
        }
    }));

    let mut nonce = 0u64;
    send(&mut writer, Opcode::Handshake, json!({ "v": 1, "client_id": client_id }), on_event).await?;

    let mut ready = false;
    let ready_timeout = tokio::time::sleep(READY_TIMEOUT);
    tokio::pin!(ready_timeout);

    loop {
        tokio::select! {
            _ = &mut ready_timeout, if !ready => {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "Discord не ответил на рукопожатие"));
            }
            incoming = frames.recv() => {
                let frame = match incoming {
                    Some(Ok(Some(frame))) => frame,
                    Some(Ok(None)) | None => return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "Discord закрыл канал")),
                    Some(Err(e)) => return Err(e),
                };
                on_event(Event::Frame { direction: Direction::In, opcode: frame.opcode, body: frame.body.clone() });
                match frame.opcode {
                    Opcode::Ping => send(&mut writer, Opcode::Pong, frame.body, on_event).await?,
                    Opcode::Close => {
                        let message = frame.body["message"].as_str().unwrap_or("без причины");
                        let code = &frame.body["code"];
                        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, format!("Discord закрыл соединение: {code} {message}")));
                    }
                    Opcode::Frame => {
                        let cmd = frame.body["cmd"].as_str().unwrap_or("");
                        let evt = frame.body["evt"].as_str().unwrap_or("");
                        let data = &frame.body["data"];
                        match (cmd, evt) {
                            ("DISPATCH", "READY") => {
                                ready = true;
                                on_event(Event::Connected { pipe: index, user: User::from_json(&data["user"]) });
                                for event in ["ACTIVITY_JOIN", "ACTIVITY_JOIN_REQUEST"] {
                                    nonce += 1;
                                    let body = json!({ "cmd": "SUBSCRIBE", "evt": event, "args": {}, "nonce": nonce.to_string() });
                                    send(&mut writer, Opcode::Frame, body, on_event).await?;
                                }
                                nonce += 1;
                                send(&mut writer, Opcode::Frame, set_activity(desired, nonce), on_event).await?;
                            }
                            ("DISPATCH", "ACTIVITY_JOIN") => {
                                on_event(Event::Join { secret: data["secret"].as_str().unwrap_or_default().to_string() });
                            }
                            ("DISPATCH", "ACTIVITY_JOIN_REQUEST") => {
                                on_event(Event::JoinRequest { user: User::from_json(&data["user"]) });
                            }
                            ("SET_ACTIVITY", _) => {
                                let error = (evt == "ERROR").then(|| data["message"].as_str().unwrap_or("ошибка без описания").to_string());
                                on_event(Event::ActivityResult { error });
                            }
                            _ => {}
                        }
                    }
                    Opcode::Handshake | Opcode::Pong => {}
                }
            }
            command = commands.recv(), if ready => match command {
                None => return Ok(Exit::Closed),
                Some(Command::Reconnect) => return Ok(Exit::Reconnect),
                Some(Command::SetActivity(activity)) => {
                    *desired = activity;
                    nonce += 1;
                    send(&mut writer, Opcode::Frame, set_activity(desired, nonce), on_event).await?;
                }
            },
        }
    }
}

fn set_activity(activity: &Option<Value>, nonce: u64) -> Value {
    json!({
        "cmd": "SET_ACTIVITY",
        // Без activity (null) Discord снимает статус.
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce.to_string(),
    })
}

async fn send<W: AsyncWrite + Unpin, F: Fn(Event)>(writer: &mut W, opcode: Opcode, body: Value, on_event: &F) -> io::Result<()> {
    frame::write_frame(writer, opcode, &body).await?;
    on_event(Event::Frame { direction: Direction::Out, opcode, body });
    Ok(())
}
