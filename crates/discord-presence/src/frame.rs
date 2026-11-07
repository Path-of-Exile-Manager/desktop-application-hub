//! Кадры IPC Discord: `opcode: u32 LE`, `length: u32 LE`, затем UTF-8 JSON длиной `length`.

use std::io;

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Кадры Discord маленькие; лимит защищает от мусора в канале.
pub const MAX_FRAME: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opcode {
    /// Рукопожатие: `{ v: 1, client_id }`.
    Handshake,
    /// Команды и события.
    Frame,
    /// Discord закрывает соединение (в теле — код и причина).
    Close,
    Ping,
    Pong,
}

impl Opcode {
    pub fn code(self) -> u32 {
        match self {
            Opcode::Handshake => 0,
            Opcode::Frame => 1,
            Opcode::Close => 2,
            Opcode::Ping => 3,
            Opcode::Pong => 4,
        }
    }

    pub fn from_code(code: u32) -> Option<Self> {
        Some(match code {
            0 => Opcode::Handshake,
            1 => Opcode::Frame,
            2 => Opcode::Close,
            3 => Opcode::Ping,
            4 => Opcode::Pong,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub opcode: Opcode,
    pub body: Value,
}

/// Прочитать кадр. `None` — канал закрыт ровно на границе кадра.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Option<Frame>> {
    let mut header = [0u8; 8];
    match reader.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let code = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    let opcode = Opcode::from_code(code).ok_or_else(|| invalid(format!("неизвестный opcode {code}")))?;
    if len > MAX_FRAME {
        return Err(invalid(format!("кадр {len} байт больше лимита {MAX_FRAME}")));
    }
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await?;
    let body = if payload.is_empty() { Value::Null } else { serde_json::from_slice(&payload).map_err(|e| invalid(e.to_string()))? };
    Ok(Some(Frame { opcode, body }))
}

pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, opcode: Opcode, body: &Value) -> io::Result<()> {
    let payload = serde_json::to_vec(body).map_err(|e| invalid(e.to_string()))?;
    if payload.len() > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("кадр {} байт больше лимита {MAX_FRAME}", payload.len())));
    }
    let mut buf = Vec::with_capacity(8 + payload.len());
    buf.extend_from_slice(&opcode.code().to_le_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    buf.extend_from_slice(&payload);
    writer.write_all(&buf).await?;
    writer.flush().await
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
