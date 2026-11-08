//! Пробный запрос к api-hub со страницы «Режим разработки»: проверить маршрут, коды ошибок,
//! ETag и лимиты, не дописывая под это фичу.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use super::{Api, ApiError, Call, Method, Reply};

/// Сколько символов ответа отдать в интерфейс: прайс лиги — мегабайты, их достаточно увидеть началом.
const PREVIEW_CHARS: usize = 200_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[serde(rename_all = "UPPERCASE")]
#[ts(export)]
pub enum ProbeMethod {
    Get,
    Post,
    Delete,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProbeResult {
    /// HTTP-статус; `null` — ответа не было (нет связи, таймаут, пауза после 429).
    pub status: Option<u16>,
    pub elapsed_ms: Option<u64>,
    pub etag: Option<String>,
    pub rate_limit_remaining: Option<u32>,
    /// Размер тела после распаковки.
    pub bytes: Option<u64>,
    /// 304: копия с этим ETag актуальна.
    pub not_modified: bool,
    /// `result` конверта, отформатированный JSON (обрезан до `PREVIEW_CHARS`).
    pub result: Option<String>,
    pub truncated: bool,
    pub error: Option<ApiError>,
}

/// `invoke("api_probe", { method, path, ifNoneMatch, body })`.
#[tauri::command]
pub async fn api_probe(
    api: State<'_, Arc<Api>>,
    method: ProbeMethod,
    path: String,
    if_none_match: Option<String>,
    body: Option<String>,
) -> Result<ProbeResult, String> {
    let path = path.trim().to_string();
    if !path.starts_with('/') {
        return Err("путь должен начинаться с «/»: /v1/leagues".into());
    }
    let body = match body.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(text) => Some(serde_json::from_str::<serde_json::Value>(text).map_err(|e| format!("тело запроса — не JSON: {e}"))?),
        None => None,
    };
    let mut call = Call::new(
        match method {
            ProbeMethod::Get => Method::Get,
            ProbeMethod::Post => Method::Post,
            ProbeMethod::Delete => Method::Delete,
        },
        path,
    )
    .timeout(Duration::from_secs(60));
    call.body = body;
    if let Some(etag) = if_none_match.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        call = call.if_none_match(etag);
    }

    let api = api.inner().clone();
    let reply = tauri::async_runtime::spawn_blocking(move || api.send::<serde_json::Value>(call))
        .await
        .map_err(|e| format!("запрос прерван: {e}"))?;

    Ok(match reply {
        Ok(Reply::Fresh { value, meta }) => {
            let mut text = serde_json::to_string_pretty(&value).unwrap_or_default();
            let truncated = text.chars().count() > PREVIEW_CHARS;
            if truncated {
                text = text.chars().take(PREVIEW_CHARS).collect();
            }
            ProbeResult {
                status: Some(meta.status),
                elapsed_ms: Some(meta.elapsed_ms),
                etag: meta.etag,
                rate_limit_remaining: meta.rate_limit_remaining,
                bytes: Some(meta.bytes),
                not_modified: false,
                result: Some(text),
                truncated,
                error: None,
            }
        }
        Ok(Reply::NotModified { meta }) => ProbeResult {
            status: Some(meta.status),
            elapsed_ms: Some(meta.elapsed_ms),
            etag: meta.etag,
            rate_limit_remaining: meta.rate_limit_remaining,
            bytes: Some(0),
            not_modified: true,
            result: None,
            truncated: false,
            error: None,
        },
        Err(error) => ProbeResult {
            status: error.status,
            elapsed_ms: None,
            etag: None,
            rate_limit_remaining: None,
            bytes: None,
            not_modified: false,
            result: None,
            truncated: false,
            error: Some(error),
        },
    })
}
