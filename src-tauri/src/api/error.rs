//! Ошибки запросов к api-hub.
//!
//! Сервер отвечает конвертом `{ result, errors }`; у ошибки `code` < 0 — доменная (таблица ниже),
//! `code` > 0 — HTTP-статус (400 валидации, 429 лимита…). Ветвиться по `code`, а не по `message`.
//! Справочник кодов — `shared/docs/desktop-integration.md`, «Справочник ошибок api-hub».

use serde::Serialize;
use ts_rs::TS;

/// Что пошло не так — для выбора реакции, без разбора текста.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ApiErrorKind {
    /// Адрес сервера не задан.
    Unconfigured,
    /// Нет соединения: DNS, отказ, обрыв, TLS.
    Network,
    Timeout,
    /// Лимит запросов: сервер ответил 429 или пауза после него ещё не прошла.
    RateLimited,
    /// Сервер ответил ошибкой вне конверта (прокси, 413 body-parser, неизвестный маршрут без JSON).
    Http,
    /// Ошибка в конверте `{ result: null, errors: [...] }`.
    Api,
    /// Ответ 2xx, но тело не разбирается в ожидаемый тип.
    InvalidResponse,
}

/// Одна ошибка из конверта.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApiFieldError {
    pub code: i64,
    /// Имя известного кода (`LeagueNotFound`…), `null` — код HTTP или незнакомый клиенту.
    pub name: Option<String>,
    pub message: String,
    /// Поле запроса: `league`, `upserts.watchlist[0].itemId`…
    pub field: Option<String>,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApiError {
    pub kind: ApiErrorKind,
    /// Для человека, по-русски.
    pub message: String,
    /// HTTP-статус, если ответ был.
    pub status: Option<u16>,
    pub errors: Vec<ApiFieldError>,
    /// Через сколько секунд можно повторить (для `rateLimited`).
    pub retry_after_secs: Option<u64>,
}

impl ApiError {
    pub fn new(kind: ApiErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), status: None, errors: Vec::new(), retry_after_secs: None }
    }

    /// Первый известный доменный код ошибки.
    #[allow(dead_code)] // понадобится с первыми запросами Ф2–Ф7
    pub fn code(&self) -> Option<ApiCode> {
        self.errors.iter().find_map(|e| ApiCode::from_code(e.code))
    }

    #[allow(dead_code)]
    pub fn has(&self, code: ApiCode) -> bool {
        self.errors.iter().any(|e| e.code == code as i64)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Доменные коды ошибок api-hub (`nodejs-monolith/apps/api-hub/src/domain/*/errors.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i64)]
#[allow(dead_code)] // варианты используются по мере подключения эндпоинтов
pub enum ApiCode {
    /// 404, поле `league`.
    LeagueNotFound = -100000,
    /// 404, поле `priceKeyId` (история цены).
    PriceKeyNotFound = -400000,
    /// 404: ни одного опубликованного набора данных.
    DatasetNotFound = -500000,
    /// 503: на сервере не настроен вход через Discord.
    SignInNotConfigured = -600000,
    /// 404: попытки входа нет или неверный poll secret.
    LoginNotFound = -600001,
    /// 410: попытка входа истекла — начать заново.
    LoginExpired = -600002,
    /// 410: токены по попытке уже забраны.
    LoginAlreadyCollected = -600003,
    /// 403: пользователь заблокирован.
    UserBlocked = -600004,
    /// 502: Discord не ответил (только в браузерной странице входа).
    IdentityProviderFailed = -600005,
    /// 401: refresh неизвестен, истёк, отозван или проиграл гонку.
    RefreshTokenInvalid = -600006,
    /// 401: предъявлен предыдущий refresh — устройство отозвано.
    RefreshTokenReused = -600007,
    /// 401: маршрут требует входа (нет access или он просрочен).
    AccessTokenRequired = -600008,
    /// 404, поле `deviceId`.
    DeviceNotFound = -600009,
    /// 401: аккаунт удалён, а токен ещё жив.
    UserNotFound = -600010,
    /// 400: одна запись дважды в пачке синхронизации, поле `<collection>:<id>`.
    SyncChangeConflict = -700000,
    /// 400: watchlist ссылается на неизвестный предмет.
    WatchlistItemNotFound = -700001,
    /// 400: запись пачки нарушает правила, поле `upserts.<collection>[i]`.
    SyncRecordInvalid = -700002,
}

const ALL: [ApiCode; 17] = [
    ApiCode::LeagueNotFound,
    ApiCode::PriceKeyNotFound,
    ApiCode::DatasetNotFound,
    ApiCode::SignInNotConfigured,
    ApiCode::LoginNotFound,
    ApiCode::LoginExpired,
    ApiCode::LoginAlreadyCollected,
    ApiCode::UserBlocked,
    ApiCode::IdentityProviderFailed,
    ApiCode::RefreshTokenInvalid,
    ApiCode::RefreshTokenReused,
    ApiCode::AccessTokenRequired,
    ApiCode::DeviceNotFound,
    ApiCode::UserNotFound,
    ApiCode::SyncChangeConflict,
    ApiCode::WatchlistItemNotFound,
    ApiCode::SyncRecordInvalid,
];

impl ApiCode {
    pub fn from_code(code: i64) -> Option<Self> {
        ALL.into_iter().find(|c| *c as i64 == code)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::LeagueNotFound => "LeagueNotFound",
            Self::PriceKeyNotFound => "PriceKeyNotFound",
            Self::DatasetNotFound => "DatasetNotFound",
            Self::SignInNotConfigured => "SignInNotConfigured",
            Self::LoginNotFound => "LoginNotFound",
            Self::LoginExpired => "LoginExpired",
            Self::LoginAlreadyCollected => "LoginAlreadyCollected",
            Self::UserBlocked => "UserBlocked",
            Self::IdentityProviderFailed => "IdentityProviderFailed",
            Self::RefreshTokenInvalid => "RefreshTokenInvalid",
            Self::RefreshTokenReused => "RefreshTokenReused",
            Self::AccessTokenRequired => "AccessTokenRequired",
            Self::DeviceNotFound => "DeviceNotFound",
            Self::UserNotFound => "UserNotFound",
            Self::SyncChangeConflict => "SyncChangeConflict",
            Self::WatchlistItemNotFound => "WatchlistItemNotFound",
            Self::SyncRecordInvalid => "SyncRecordInvalid",
        }
    }
}

/// Ошибка транспорта ureq → `ApiError` с понятным текстом.
pub fn from_transport(error: &ureq::Error, timeout_secs: u64) -> ApiError {
    let (kind, message) = match error {
        ureq::Error::Timeout(_) => (ApiErrorKind::Timeout, format!("сервер не ответил за {timeout_secs} с")),
        ureq::Error::HostNotFound => (ApiErrorKind::Network, "адрес не найден (DNS)".into()),
        ureq::Error::ConnectionFailed => (ApiErrorKind::Network, "не удалось подключиться".into()),
        ureq::Error::Io(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => (ApiErrorKind::Network, "в соединении отказано".into()),
        ureq::Error::Io(e) => (ApiErrorKind::Network, format!("ошибка соединения: {e}")),
        ureq::Error::StatusCode(code) => (ApiErrorKind::Http, format!("сервер ответил HTTP {code}")),
        ureq::Error::BodyExceedsLimit(limit) => (ApiErrorKind::InvalidResponse, format!("ответ больше {} МБ", limit / 1024 / 1024)),
        ureq::Error::Decompress(_, e) => (ApiErrorKind::InvalidResponse, format!("не удалось распаковать ответ: {e}")),
        other => (ApiErrorKind::Network, other.to_string()),
    };
    ApiError::new(kind, message)
}
