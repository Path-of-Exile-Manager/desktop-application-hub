//! Клиент api-hub: единственная дорога из приложения на наш сервер (кроме опроса `/v1/health`
//! в `server.rs`). Интерфейс на сервер не ходит — только через команды ядра.
//!
//! Что делает за вызывающего:
//! - берёт адрес сервера у `ServerWatcher` (тот же, что проверяется на связь);
//! - ставит `X-Device-Id` и `User-Agent`, просит gzip (ureq распаковывает сам);
//! - разбирает конверт `{ result, errors }` в `T` или `ApiError` с кодами;
//! - `304 Not Modified` возвращает как `Reply::NotModified` (ETag прайса);
//! - после 429 выдерживает `Retry-After`: повтор того же маршрута до срока не уходит в сеть.
//!
//! Вызовы синхронные — делать их из своих потоков или `tauri::async_runtime::spawn_blocking`.

mod error;
pub mod probe;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::de::{DeserializeOwned, IgnoredAny};
use serde::Deserialize;
use uuid::Uuid;

pub use error::{ApiCode, ApiError, ApiErrorKind, ApiFieldError};

/// Таймаут по умолчанию; тяжёлые ответы (прайс, наборы данных) задают свой через `Call::timeout`.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);
/// Самый большой ответ, который готовы прочитать (прайс лиги ~13 МБ без сжатия).
const BODY_LIMIT: u64 = 64 * 1024 * 1024;
/// Пауза после 429, если сервер не прислал `Retry-After`.
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Delete,
}

impl Method {
    fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Delete => "DELETE",
        }
    }
}

/// Один запрос: `Call::get("/v1/leagues")`, `Call::post("/v1/sync", body)`.
pub struct Call {
    method: Method,
    /// Путь от адреса сервера, с ведущим «/»; сегменты уже закодированы (`/v1/prices/Hardcore%20Settlers`).
    path: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Option<serde_json::Value>,
    timeout: Duration,
}

#[allow(dead_code)] // часть методов понадобится с Ф2–Ф8
impl Call {
    pub fn new(method: Method, path: impl Into<String>) -> Self {
        Self { method, path: path.into(), query: Vec::new(), headers: Vec::new(), body: None, timeout: DEFAULT_TIMEOUT }
    }

    pub fn get(path: impl Into<String>) -> Self {
        Self::new(Method::Get, path)
    }

    pub fn post(path: impl Into<String>, body: serde_json::Value) -> Self {
        Self { body: Some(body), ..Self::new(Method::Post, path) }
    }

    pub fn delete(path: impl Into<String>) -> Self {
        Self::new(Method::Delete, path)
    }

    pub fn query(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.query.push((key.into(), value.into()));
        self
    }

    pub fn header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((key.into(), value.into()));
        self
    }

    /// `If-None-Match`: при совпадении сервер ответит 304 → `Reply::NotModified`.
    pub fn if_none_match(self, etag: impl Into<String>) -> Self {
        self.header("If-None-Match", etag)
    }

    /// `Authorization: Bearer <access>` для маршрутов, где нужен вход (Ф7).
    pub fn bearer(self, access_token: &str) -> Self {
        self.header("Authorization", format!("Bearer {access_token}"))
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Ключ паузы после 429: метод и путь без запроса (лимит сервер считает на маршрут).
    fn route(&self) -> String {
        format!("{} {}", self.method.as_str(), self.path)
    }
}

/// Сведения об ответе — для журнала и страницы «Режим разработки».
#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub status: u16,
    pub elapsed_ms: u64,
    pub etag: Option<String>,
    /// `X-RateLimit-Remaining`: сколько запросов к этому маршруту осталось в окне.
    pub rate_limit_remaining: Option<u32>,
    /// Размер тела после распаковки.
    pub bytes: u64,
}

pub enum Reply<T> {
    Fresh { value: T, meta: Meta },
    /// 304: у клиента актуальная копия (запрос был с `If-None-Match`).
    NotModified { meta: Meta },
}

#[derive(Deserialize)]
struct Envelope<T> {
    result: Option<T>,
    #[serde(default)]
    errors: Vec<RawError>,
}

#[derive(Deserialize)]
struct RawError {
    code: i64,
    #[serde(default)]
    message: String,
    field: Option<String>,
    params: Option<serde_json::Value>,
}

impl From<RawError> for ApiFieldError {
    fn from(e: RawError) -> Self {
        Self { name: ApiCode::from_code(e.code).map(|c| c.name().to_string()), code: e.code, message: e.message, field: e.field, params: e.params }
    }
}

pub struct Api {
    agent: ureq::Agent,
    device_id: Uuid,
    base_url: Box<dyn Fn() -> Option<String> + Send + Sync>,
    /// Маршрут → до какого момента не отправлять (после 429).
    cooldown: Mutex<HashMap<String, Instant>>,
}

impl Api {
    pub fn new(device_id: Uuid, base_url: impl Fn() -> Option<String> + Send + Sync + 'static) -> Self {
        let agent = ureq::Agent::config_builder()
            // Ошибочные статусы разбираем сами: в теле конверт с кодами.
            .http_status_as_error(false)
            .user_agent(format!("poe-manager-desktop/{}", env!("CARGO_PKG_VERSION")))
            .timeout_global(Some(DEFAULT_TIMEOUT))
            .build()
            .into();
        Self { agent, device_id, base_url: Box::new(base_url), cooldown: Mutex::new(HashMap::new()) }
    }

    pub fn device_id(&self) -> Uuid {
        self.device_id
    }

    /// Выполняет запрос и разбирает `result` конверта в `T`.
    pub fn send<T: DeserializeOwned>(&self, call: Call) -> Result<Reply<T>, ApiError> {
        let (status, meta, body) = self.exchange(&call)?;
        if status == 304 {
            return Ok(Reply::NotModified { meta });
        }
        if (200..300).contains(&status) {
            let envelope: Envelope<T> = serde_json::from_slice(&body)
                .map_err(|e| with_status(ApiError::new(ApiErrorKind::InvalidResponse, format!("ответ не разобран: {e}")), status))?;
            // `result: null` допустим, только если T его принимает (Option, ()).
            let value = match envelope.result {
                Some(value) => value,
                None => serde_json::from_value(serde_json::Value::Null)
                    .map_err(|_| with_status(ApiError::new(ApiErrorKind::InvalidResponse, "в ответе нет result"), status))?,
            };
            return Ok(Reply::Fresh { value, meta });
        }
        Err(self.failure(&call, status, &body))
    }

    /// Запрос и чтение тела, без разбора: общая часть `send` и пробного запроса.
    fn exchange(&self, call: &Call) -> Result<(u16, Meta, Vec<u8>), ApiError> {
        let route = call.route();
        if let Some(until) = self.cooldown.lock().unwrap().get(&route).copied() {
            let now = Instant::now();
            if until > now {
                let secs = (until - now).as_secs().max(1);
                let mut error = ApiError::new(ApiErrorKind::RateLimited, format!("лимит запросов, повтор через {secs} с"));
                error.retry_after_secs = Some(secs);
                return Err(error);
            }
        }

        let base = (self.base_url)().ok_or_else(|| ApiError::new(ApiErrorKind::Unconfigured, "адрес сервера не задан"))?;
        let url = format!("{base}{}", call.path);
        let started = Instant::now();
        let mut response = self.execute(call, &url).map_err(|e| error::from_transport(&e, call.timeout.as_secs()))?;
        let status = response.status().as_u16();
        let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
        let mut meta = Meta {
            status,
            etag: header("etag"),
            rate_limit_remaining: header("x-ratelimit-remaining").and_then(|v| v.parse().ok()),
            ..Meta::default()
        };
        let retry_after = header("retry-after").and_then(|v| v.trim().parse::<u64>().ok());

        let body = if status == 304 {
            Vec::new()
        } else {
            response.body_mut().with_config().limit(BODY_LIMIT).read_to_vec().map_err(|e| with_status(error::from_transport(&e, call.timeout.as_secs()), status))?
        };
        meta.elapsed_ms = started.elapsed().as_millis() as u64;
        meta.bytes = body.len() as u64;

        if status == 429 {
            let wait = retry_after.map(Duration::from_secs).unwrap_or(DEFAULT_RETRY_AFTER);
            self.cooldown.lock().unwrap().insert(route, Instant::now() + wait);
        }
        Ok((status, meta, body))
    }

    fn execute(&self, call: &Call, url: &str) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
        match call.method {
            Method::Get => self.decorate(self.agent.get(url), call).call(),
            Method::Delete => self.decorate(self.agent.delete(url), call).call(),
            Method::Post => {
                let body = call.body.clone().unwrap_or_else(|| serde_json::json!({}));
                self.decorate(self.agent.post(url), call).send_json(body)
            }
        }
    }

    fn decorate<B>(&self, request: ureq::RequestBuilder<B>, call: &Call) -> ureq::RequestBuilder<B> {
        let mut request = request.header("X-Device-Id", self.device_id.to_string());
        for (key, value) in &call.headers {
            request = request.header(key, value);
        }
        for (key, value) in &call.query {
            request = request.query(key, value);
        }
        request.config().timeout_global(Some(call.timeout)).build()
    }

    /// Ответ не 2xx/304 → `ApiError`: из конверта, если он есть, иначе по статусу.
    fn failure(&self, call: &Call, status: u16, body: &[u8]) -> ApiError {
        let mut error = match serde_json::from_slice::<Envelope<IgnoredAny>>(body) {
            Ok(envelope) if !envelope.errors.is_empty() => {
                let errors: Vec<ApiFieldError> = envelope.errors.into_iter().map(Into::into).collect();
                let first = &errors[0];
                let message = match &first.name {
                    Some(name) => format!("{name}: {}", first.message),
                    None => first.message.clone(),
                };
                ApiError { kind: ApiErrorKind::Api, message, status: Some(status), errors, retry_after_secs: None }
            }
            _ => with_status(ApiError::new(ApiErrorKind::Http, format!("сервер ответил HTTP {status}")), status),
        };
        if status == 429 {
            error.kind = ApiErrorKind::RateLimited;
            error.retry_after_secs = self
                .cooldown
                .lock()
                .unwrap()
                .get(&call.route())
                .map(|until| until.saturating_duration_since(Instant::now()).as_secs().max(1));
        }
        error
    }
}

fn with_status(mut error: ApiError, status: u16) -> ApiError {
    error.status = Some(status);
    error
}
