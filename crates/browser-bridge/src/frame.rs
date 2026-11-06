//! Кадры Native Messaging: 4 байта длины (little-endian, «родной» порядок Chrome на Windows) + UTF-8 JSON.
//! Тот же формат и в именованном канале между мостом и приложением.

use std::io;

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Больше Chrome от хоста не принимает (1 МиБ). Тот же лимит — в обратную сторону.
pub const MAX_FRAME: usize = 1024 * 1024;

/// Прочитать кадр. `None` — поток закрыт ровно на границе кадра.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("кадр {len} байт больше лимита {MAX_FRAME}")));
    }
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("кадр {} байт больше лимита {MAX_FRAME}", payload.len())));
    }
    writer.write_all(&(payload.len() as u32).to_le_bytes()).await?;
    writer.write_all(payload).await?;
    writer.flush().await
}

pub async fn write_json<W: AsyncWrite + Unpin, T: Serialize>(writer: &mut W, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    write_frame(writer, &bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn roundtrip_and_eof() {
        let (mut a, mut b) = tokio::io::duplex(64);
        write_frame(&mut a, br#"{"v":1}"#).await.unwrap();
        drop(a);
        assert_eq!(read_frame(&mut b).await.unwrap().as_deref(), Some(&br#"{"v":1}"#[..]));
        assert_eq!(read_frame(&mut b).await.unwrap(), None);
    }

    #[tokio::test]
    async fn rejects_oversized_frames() {
        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&((MAX_FRAME as u32) + 1).to_le_bytes()).await.unwrap();
        assert_eq!(read_frame(&mut b).await.unwrap_err().kind(), io::ErrorKind::InvalidData);
        let big = vec![b' '; MAX_FRAME + 1];
        assert_eq!(write_frame(&mut a, &big).await.unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }
}
