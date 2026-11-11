//! Код экспорта PoB → XML: base64url (иногда обычный base64) поверх zlib.

use std::io::Read;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flate2::read::ZlibDecoder;

use crate::PobError;

/// Предел XML после распаковки. Самые большие гайды — около 2 МБ; больше — скорее всего, мусор
/// или «zip-бомба».
pub const MAX_XML_BYTES: u64 = 20 * 1024 * 1024;

/// Раскодирует код экспорта PoB в текст XML. Пробелы и переводы строк в коде допустимы
/// (код часто переносят по строкам), как и обычный base64 с `+`, `/` и `=`.
pub fn decode_code(code: &str) -> Result<String, PobError> {
    let normalized: String = code
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            c => c,
        })
        .collect();
    let normalized = normalized.trim_end_matches('=');
    if normalized.is_empty() {
        return Err(PobError::EmptyCode);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(normalized)
        .map_err(|_| PobError::InvalidCode)?;

    let mut xml = Vec::new();
    ZlibDecoder::new(bytes.as_slice())
        .take(MAX_XML_BYTES + 1)
        .read_to_end(&mut xml)
        .map_err(|_| PobError::InvalidCode)?;
    if xml.len() as u64 > MAX_XML_BYTES {
        return Err(PobError::TooLarge);
    }
    String::from_utf8(xml).map_err(|_| PobError::InvalidCode)
}
