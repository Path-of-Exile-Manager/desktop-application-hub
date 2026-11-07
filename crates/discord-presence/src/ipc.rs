//! Поиск канала клиента Discord. Stable, PTB и Canary занимают первые свободные номера
//! `\\.\pipe\discord-ipc-0` … `discord-ipc-9`, поэтому перебираем все по порядку.

use std::io;

pub const PIPE_COUNT: u8 = 10;

pub fn pipe_name(index: u8) -> String {
    format!(r"\\.\pipe\discord-ipc-{index}")
}

/// Подключиться к первому доступному каналу. Возвращает канал и его номер.
#[cfg(windows)]
pub fn connect() -> io::Result<(tokio::net::windows::named_pipe::NamedPipeClient, u8)> {
    use tokio::net::windows::named_pipe::ClientOptions;

    let mut last_error = None;
    for index in 0..PIPE_COUNT {
        match ClientOptions::new().open(pipe_name(index)) {
            Ok(client) => return Ok((client, index)),
            Err(e) => last_error = Some(e),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "каналов Discord нет")))
}

/// Подключиться к каналу с заданным номером (когда на компьютере запущено несколько клиентов Discord).
#[cfg(windows)]
pub fn connect_to(index: u8) -> io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(pipe_name(index))
}

#[cfg(not(windows))]
pub fn connect_to(_index: u8) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "IPC Discord реализован только для Windows"))
}

#[cfg(not(windows))]
pub fn connect() -> io::Result<((), u8)> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "IPC Discord реализован только для Windows"))
}
