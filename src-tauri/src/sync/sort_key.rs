//! Ключ порядка (`sortKey`) — дробный индекс: строка из печатного ASCII без пробела (`!`…`~`),
//! которую можно вставить между любыми двумя другими, не трогая их. Правило сервера:
//! `^[\x21-\x7e]{1,64}$` (`packages/domain/src/sync/rules.ts`).
//!
//! Цифры — 94 символа `!`…`~`; ключ читается как дробь `0.d1d2…`. Свой ключ никогда не кончается
//! самой младшей цифрой `!`, поэтому между двумя ключами всегда есть место.

const FIRST: u8 = 0x21;
const LAST: u8 = 0x7e;
const BASE: u8 = LAST - FIRST + 1;
const MAX_LEN: usize = 64;

fn digits(key: &str) -> Result<Vec<u8>, String> {
    if key.is_empty() || key.len() > MAX_LEN || !key.bytes().all(|b| (FIRST..=LAST).contains(&b)) {
        return Err(format!("ключ «{key}» — не 1–{MAX_LEN} печатных символов ASCII"));
    }
    Ok(key.bytes().map(|b| b - FIRST).collect())
}

/// Середина между `a` (пусто — начало) и `b` (`None` — конец); требует `a < b`.
fn mid(a: &[u8], b: Option<&[u8]>) -> Vec<u8> {
    if let Some(b) = b {
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(0) == b[n] {
            n += 1;
        }
        if n > 0 {
            let mut out = b[..n].to_vec();
            out.extend(mid(a.get(n..).unwrap_or(&[]), Some(&b[n..])));
            return out;
        }
    }
    let da = a.first().copied().unwrap_or(0);
    let db = b.and_then(|b| b.first().copied()).unwrap_or(BASE);
    if db - da > 1 {
        return vec![(da + db) / 2];
    }
    if let Some(b) = b
        && b.len() > 1 {
            return vec![b[0]];
        }
    let mut out = vec![da];
    out.extend(mid(a.get(1..).unwrap_or(&[]), None));
    out
}

/// Ключ между `before` и `after` (оба необязательны: в начало, в конец, в пустой список).
pub fn between(before: Option<&str>, after: Option<&str>) -> Result<String, String> {
    let a = before.map(digits).transpose()?.unwrap_or_default();
    let b = after.map(digits).transpose()?;
    if let Some(b) = &b {
        if a.as_slice() >= b.as_slice() {
            return Err(format!("«{}» не меньше «{}»", before.unwrap_or(""), after.unwrap_or("")));
        }
        if b.iter().all(|d| *d == 0) {
            return Err(format!("перед «{}» места нет", after.unwrap_or("")));
        }
    }
    let key: String = mid(&a, b.as_deref()).into_iter().map(|d| (d + FIRST) as char).collect();
    if key.len() > MAX_LEN {
        return Err("ключи слишком сблизились — нужна перенумерация списка".into());
    }
    Ok(key)
}
