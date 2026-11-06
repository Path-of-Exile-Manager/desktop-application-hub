//! Протокол расширение ⇄ приложение, версия 1. Конверт: `{ v, type, id?, re?, …поля }`.
//! Описание — docs/extension-bridge.md. Неизвестные типы молча пропускаются, на запросы
//! (`id` задан) с неизвестным типом отвечаем ошибкой `not-supported`.

use serde::Deserialize;
use serde_json::{Value, json};

pub const PROTOCOL_VERSION: u64 = 1;

/// Первое сообщение расширения после того, как мост сообщил, что приложение запущено.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub ext_version: String,
    pub browser: String,
    #[serde(default)]
    pub browser_version: Option<String>,
    #[serde(default)]
    pub extension_id: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Incoming {
    Hello { id: Option<String>, hello: Hello },
    /// Тип, которого эта версия приложения не знает.
    Unknown { id: Option<String>, kind: String },
}

#[derive(Debug, PartialEq)]
pub struct ParseError {
    pub id: Option<String>,
    pub message: String,
}

pub fn parse(bytes: &[u8]) -> Result<Incoming, ParseError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| ParseError { id: None, message: format!("не JSON: {e}") })?;
    let id = value.get("id").and_then(Value::as_str).map(String::from);
    let fail = |message: String| ParseError { id: id.clone(), message };

    let version = value.get("v").and_then(Value::as_u64).ok_or_else(|| fail("нет версии протокола v".into()))?;
    if version != PROTOCOL_VERSION {
        return Err(fail(format!("версия протокола {version} не поддерживается, нужна {PROTOCOL_VERSION}")));
    }
    let kind = value.get("type").and_then(Value::as_str).ok_or_else(|| fail("нет поля type".into()))?.to_string();

    match kind.as_str() {
        "hello" => {
            let hello = Hello::deserialize(&value).map_err(|e| fail(format!("hello: {e}")))?;
            Ok(Incoming::Hello { id, hello })
        }
        _ => Ok(Incoming::Unknown { id, kind }),
    }
}

pub fn welcome(re: Option<&str>, app_version: &str, features: &[&str]) -> Value {
    json!({ "v": PROTOCOL_VERSION, "type": "welcome", "re": re, "appVersion": app_version, "protocol": PROTOCOL_VERSION, "features": features })
}

/// Сообщение моста: запущено ли приложение.
pub fn app_status(running: bool) -> Value {
    json!({ "v": PROTOCOL_VERSION, "type": "app-status", "running": running })
}

pub fn error(re: Option<&str>, code: &str, message: &str) -> Value {
    json!({ "v": PROTOCOL_VERSION, "type": "error", "re": re, "code": code, "message": message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hello() {
        let msg = br#"{"v":1,"type":"hello","id":"h1","extVersion":"0.2.0","browser":"chrome","browserVersion":"153.0","extensionId":"abc"}"#;
        assert_eq!(
            parse(msg).unwrap(),
            Incoming::Hello {
                id: Some("h1".into()),
                hello: Hello { ext_version: "0.2.0".into(), browser: "chrome".into(), browser_version: Some("153.0".into()), extension_id: Some("abc".into()) },
            }
        );
    }

    #[test]
    fn unknown_types_and_errors() {
        assert_eq!(parse(br#"{"v":1,"type":"future","id":"x"}"#).unwrap(), Incoming::Unknown { id: Some("x".into()), kind: "future".into() });
        assert_eq!(parse(br#"{"v":2,"type":"hello","id":"x"}"#).unwrap_err().id.as_deref(), Some("x"));
        assert!(parse(b"not json").is_err());
        assert!(parse(br#"{"v":1,"type":"hello"}"#).is_err(), "у hello обязательны extVersion и browser");
    }

    #[test]
    fn builds_replies() {
        assert_eq!(welcome(Some("h1"), "0.1.0", &[])["re"], "h1");
        assert_eq!(app_status(false)["running"], false);
        assert_eq!(error(None, "invalid", "x")["code"], "invalid");
    }
}
