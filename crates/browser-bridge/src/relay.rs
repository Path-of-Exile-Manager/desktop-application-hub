//! Режим «мост»: Chrome запускает `poe-manager.exe chrome-extension://<id>/`, а мы пересылаем кадры
//! между stdio и именованным каналом запущенного приложения.
//!
//! - Приложения нет → сообщаем расширению `app-status: false` и раз в `poll` проверяем канал.
//!   Сами приложение не запускаем (решение 16).
//! - Приложение появилось → `app-status: true`; дальше расширение шлёт `hello`.
//! - Приложение закрылось → снова `false` и ожидание.
//! - Закрылся stdin (Chrome отключил порт) → выходим.
//!
//! Кадры, пришедшие от расширения, пока приложения нет, отбрасываются: расширение повторит
//! рукопожатие после `app-status: true`.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{Mutex, mpsc};

use crate::frame::{read_frame, write_frame, write_json};
use crate::protocol;

#[cfg(windows)]
pub async fn relay<I, O>(input: I, output: O, pipe_name: &str, poll: Duration) -> io::Result<()>
where
    I: AsyncRead + Unpin + Send + 'static,
    O: AsyncWrite + Unpin + Send + 'static,
{
    use crate::pipe::{ERROR_PIPE_BUSY, open_client};

    let output = Arc::new(Mutex::new(output));
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);
    tokio::spawn(async move {
        let mut input = input;
        while let Ok(Some(frame)) = read_frame(&mut input).await {
            if tx.send(frame).await.is_err() {
                break;
            }
        }
        // tx уничтожен → rx.recv() вернёт None → выход из relay.
    });

    let mut announced: Option<bool> = None;
    let announce = |running: bool, announced: &mut Option<bool>| {
        let changed = *announced != Some(running);
        *announced = Some(running);
        let output = output.clone();
        async move {
            if changed {
                write_json(&mut *output.lock().await, &protocol::app_status(running)).await
            } else {
                Ok(())
            }
        }
    };

    loop {
        match open_client(pipe_name) {
            Ok(client) => {
                if announce(true, &mut announced).await.is_err() {
                    return Ok(()); // stdout закрыт — Chrome ушёл
                }
                let (mut pipe_reader, mut pipe_writer) = tokio::io::split(client);
                let out = output.clone();
                // Приложение → Chrome. Возвращает true, если закрыт stdout.
                let mut from_app = tokio::spawn(async move {
                    loop {
                        match read_frame(&mut pipe_reader).await {
                            Ok(Some(frame)) => {
                                if write_frame(&mut *out.lock().await, &frame).await.is_err() {
                                    return true;
                                }
                            }
                            _ => return false,
                        }
                    }
                });
                // Chrome → приложение.
                let stdout_closed = loop {
                    tokio::select! {
                        frame = rx.recv() => match frame {
                            Some(frame) => {
                                if write_frame(&mut pipe_writer, &frame).await.is_err() {
                                    from_app.abort();
                                    break false;
                                }
                            }
                            None => {
                                from_app.abort();
                                return Ok(());
                            }
                        },
                        result = &mut from_app => break result.unwrap_or(false),
                    }
                };
                if stdout_closed || announce(false, &mut announced).await.is_err() {
                    return Ok(());
                }
            }
            Err(error) => {
                let busy = error.raw_os_error() == Some(ERROR_PIPE_BUSY);
                if !busy && announce(false, &mut announced).await.is_err() {
                    return Ok(());
                }
                let wait = if busy { Duration::from_millis(50) } else { poll };
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    frame = rx.recv() => if frame.is_none() { return Ok(()) },
                }
            }
        }
    }
}

#[cfg(not(windows))]
pub async fn relay<I, O>(_input: I, _output: O, _pipe_name: &str, _poll: Duration) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "мост есть только в Windows"))
}

/// Точка входа режима «мост» из `main()`. Возвращает код выхода процесса.
pub fn run_stdio(origin: &str) -> i32 {
    use crate::{config, log, pipe};

    log::write(&format!("мост запущен для {origin}"));
    if !config::origin_allowed(origin) {
        log::write(&format!("отказ: {origin} нет среди разрешённых расширений {:?}", config::extension_ids()));
        return 2;
    }
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(e) => {
            log::write(&format!("не удалось создать runtime: {e}"));
            return 1;
        }
    };
    let result = runtime.block_on(relay(tokio::io::stdin(), tokio::io::stdout(), &pipe::default_pipe_name(), Duration::from_secs(2)));
    match result {
        Ok(()) => {
            log::write("мост завершён: Chrome закрыл соединение");
            0
        }
        Err(e) => {
            log::write(&format!("мост завершён с ошибкой: {e}"));
            1
        }
    }
}
