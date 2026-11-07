//! Прототип (шаг 1 в shared/docs/discord-rich-presence.md): проверить, что статус, приглашения
//! и запуск по приглашению работают для нашего Discord-приложения без одобрения Discord.
//!
//! ```text
//! cargo run -p discord-presence --example spike -- [client_id] [флаги]
//!
//!   client_id          по умолчанию DISCORD_CLIENT_ID из desktop-application-hub/.env.local или .env
//!   --type <0|2|3|5>   тип активности: 0 «Играет» (по умолчанию), 2 «Слушает», 3 «Смотрит», 5 «Соревнуется»
//!   --details <текст>  первая строка (по умолчанию «Торгует в Path of Exile»)
//!   --state <текст>    вторая строка (по умолчанию нет; к ней Discord дописывает размер группы)
//!   --no-size          группа без размера — проверить, работают ли приглашения без «(1 из 4)»
//!   --no-party         без группы и secret — только статус
//!   --secret <текст>   join secret (по умолчанию «pm1:spike:<время>»)
//!   --pipe <0..9>      номер канала Discord (по умолчанию первый доступный). Нужен, когда на одном
//!                      компьютере запущены два клиента (Stable и PTB/Canary) под разными аккаунтами
//!   --unregister       удалить ключ запуска из реестра и выйти
//! ```
//!
//! При запуске пример записывает в реестр команду запуска — самого себя с теми же аргументами.
//! Когда получатель нажмёт «Присоединиться» при закрытом прототипе, Discord запустит его снова,
//! и новое окно консоли покажет `ACTIVITY_JOIN`. Всё пишется ещё и в
//! `%TEMP%\poe-manager-discord-spike.log` — на случай, если окно закроется сразу.

use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_presence::frame::{self, Opcode};
use discord_presence::{config, ipc, register};
use serde_json::{Value, json};

struct Args {
    client_id: String,
    activity_type: u8,
    details: String,
    state: Option<String>,
    party: bool,
    size: bool,
    secret: Option<String>,
    pipe: Option<u8>,
    unregister: bool,
}

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut args = Args {
        client_id: String::new(),
        activity_type: 0,
        details: "Торгует в Path of Exile".into(),
        state: None,
        party: true,
        size: true,
        secret: None,
        pipe: None,
        unregister: false,
    };
    let mut it = raw.iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or_else(|| format!("{name}: нужно значение"));
        match arg.as_str() {
            "--type" => args.activity_type = value("--type")?.parse().map_err(|_| "--type: число 0, 2, 3 или 5")?,
            "--details" => args.details = value("--details")?,
            "--state" => args.state = Some(value("--state")?),
            "--secret" => args.secret = Some(value("--secret")?),
            "--pipe" => args.pipe = Some(value("--pipe")?.parse().ok().filter(|n| *n < ipc::PIPE_COUNT).ok_or("--pipe: число от 0 до 9")?),
            "--no-size" => args.size = false,
            "--no-party" => args.party = false,
            "--unregister" => args.unregister = true,
            other if other.starts_with("--") => log(&format!("неизвестный аргумент (может, его передал Discord): {other}")),
            other if args.client_id.is_empty() && config::is_client_id(other) => args.client_id = other.to_string(),
            other => log(&format!("лишний аргумент (может, его передал Discord): {other}")),
        }
    }
    if args.client_id.is_empty() {
        args.client_id = config::client_id().ok_or(
            "нет client_id: задайте DISCORD_CLIENT_ID в desktop-application-hub/.env.local или передайте первым аргументом",
        )?;
    }
    Ok(args)
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn log(message: &str) {
    let secs = now_secs();
    let line = format!("[{:02}:{:02}:{:02} UTC] {message}", secs / 3600 % 24, secs / 60 % 60, secs % 60);
    println!("{line}");
    let path = std::env::temp_dir().join("poe-manager-discord-spike.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Командная строка для реестра: этот же exe с теми же аргументами (кроме --unregister).
fn launch_command(exe: &str, raw: &[String]) -> String {
    let mut command = format!("\"{exe}\"");
    for arg in raw.iter().filter(|a| a.as_str() != "--unregister") {
        command.push(' ');
        if arg.contains(' ') || arg.is_empty() { command.push_str(&format!("\"{arg}\"")) } else { command.push_str(arg) }
    }
    command
}

fn activity(args: &Args, started_at: u64) -> Value {
    let mut activity = json!({
        "type": args.activity_type,
        "details": args.details,
        "timestamps": { "start": started_at },
        "assets": { "large_image": "logo", "large_text": "poe-manager (прототип)" },
        "instance": false,
    });
    if let Some(state) = &args.state {
        activity["state"] = json!(state);
    }
    if args.party {
        let mut party = json!({ "id": format!("pm-spike-{}-{started_at}", std::process::id()) });
        if args.size {
            party["size"] = json!([1, 4]);
        }
        activity["party"] = party;
        let secret = args.secret.clone().unwrap_or_else(|| format!("pm1:spike:{started_at}"));
        activity["secrets"] = json!({ "join": secret });
    }
    activity
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    log(&format!("запуск: {:?}", std::env::args().collect::<Vec<_>>()));
    let args = match parse_args(&raw) {
        Ok(args) => args,
        Err(e) => {
            log(&format!("ошибка: {e}"));
            std::process::exit(2);
        }
    };

    if args.unregister {
        match register::unregister_launch(&args.client_id) {
            Ok(()) => log(&format!("ключ {} удалён", register::key_path(&args.client_id))),
            Err(e) => log(&format!("не удалось удалить ключ: {e}")),
        }
        return;
    }

    let exe = std::env::current_exe().expect("путь к exe").to_string_lossy().to_string();
    let command = launch_command(&exe, &raw);
    match register::register_launch(&args.client_id, &command, &exe) {
        Ok(()) => log(&format!("команда запуска в реестре: {command}")),
        Err(e) => log(&format!("не удалось записать ключ запуска: {e}")),
    }

    if let Err(e) = run(&args).await {
        log(&format!("ошибка: {e}"));
        std::process::exit(1);
    }
}

async fn run(args: &Args) -> std::io::Result<()> {
    let connected = match args.pipe {
        Some(index) => ipc::connect_to(index).map(|pipe| (pipe, index)),
        None => ipc::connect(),
    };
    let (pipe, index) = connected.map_err(|e| std::io::Error::new(e.kind(), format!("Discord не запущен или канал недоступен: {e}")))?;
    log(&format!("подключились к {}", ipc::pipe_name(index)));
    let (mut reader, mut writer) = tokio::io::split(pipe);

    frame::write_frame(&mut writer, Opcode::Handshake, &json!({ "v": 1, "client_id": args.client_id })).await?;

    let mut nonce = 0u32;
    let mut next_nonce = || {
        nonce += 1;
        nonce.to_string()
    };
    let started_at = now_secs();

    loop {
        let Some(frame) = frame::read_frame(&mut reader).await? else {
            log("Discord закрыл канал");
            return Ok(());
        };
        match frame.opcode {
            Opcode::Ping => frame::write_frame(&mut writer, Opcode::Pong, &frame.body).await?,
            Opcode::Close => {
                log(&format!("Discord закрыл соединение: {}", frame.body));
                return Ok(());
            }
            Opcode::Frame => {
                let cmd = frame.body["cmd"].as_str().unwrap_or("");
                let evt = frame.body["evt"].as_str().unwrap_or("");
                match (cmd, evt) {
                    ("DISPATCH", "READY") => {
                        let user = &frame.body["data"]["user"];
                        log(&format!("READY: пользователь {} ({})", user["global_name"].as_str().or(user["username"].as_str()).unwrap_or("?"), user["id"]));
                        for event in ["ACTIVITY_JOIN", "ACTIVITY_JOIN_REQUEST", "ACTIVITY_SPECTATE"] {
                            let body = json!({ "cmd": "SUBSCRIBE", "evt": event, "args": {}, "nonce": next_nonce() });
                            frame::write_frame(&mut writer, Opcode::Frame, &body).await?;
                        }
                        let activity = activity(args, started_at);
                        log(&format!("SET_ACTIVITY: {activity}"));
                        let body = json!({
                            "cmd": "SET_ACTIVITY",
                            "args": { "pid": std::process::id(), "activity": activity },
                            "nonce": next_nonce(),
                        });
                        frame::write_frame(&mut writer, Opcode::Frame, &body).await?;
                    }
                    ("DISPATCH", "ACTIVITY_JOIN") => {
                        log(&format!(">>> ACTIVITY_JOIN, secret = {}", frame.body["data"]["secret"]));
                    }
                    ("DISPATCH", "ACTIVITY_JOIN_REQUEST") => {
                        let user = &frame.body["data"]["user"];
                        log(&format!(">>> ACTIVITY_JOIN_REQUEST от {} ({})", user["username"], user["id"]));
                    }
                    (_, "ERROR") => log(&format!("ОШИБКА на {cmd}: {}", frame.body["data"])),
                    ("SUBSCRIBE", _) => log(&format!("подписка на {evt}: ок")),
                    ("SET_ACTIVITY", _) => log("статус выставлен, Discord ответил без ошибки"),
                    _ => log(&format!("кадр: {}", frame.body)),
                }
            }
            Opcode::Handshake | Opcode::Pong => log(&format!("кадр {:?}: {}", frame.opcode, frame.body)),
        }
    }
}
