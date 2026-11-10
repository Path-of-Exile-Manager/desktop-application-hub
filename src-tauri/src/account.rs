//! Аккаунт (`shared/docs/accounts.md`, Ф7 плана интеграции): вход через Discord в системном
//! браузере с опросом попытки, токены, выход, профиль и устройства.
//!
//! - refresh-токен — только в диспетчере учётных данных Windows (`keyring`), ни в одном файле;
//! - access-токен — только в памяти ядра, интерфейс токенов не видит;
//! - профиль — в `account.json`, чтобы показывать его без сети.
//!
//! Refresh-токен одноразовый: обмен строго по одному (`refresh_lock`), иначе параллельный обмен
//! проиграет с `-600006` и устройство окажется вышедшим. Поток `account-refresh` обновляет
//! access заранее, за минуту до срока, — заодно узнаёт, что устройство отозвали с другого клиента.

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use ts_rs::TS;

use crate::api::{Api, ApiCode, ApiError, ApiErrorKind, Call, Reply};
use crate::paths::{write_atomic, AppPaths};

pub const EVENT: &str = "account-status";

const KEYRING_SERVICE: &str = "poe-manager";
const KEYRING_USER: &str = "refresh-token";
const CACHE_FILE: &str = "account.json";
/// Обновлять access за столько до его срока.
const REFRESH_AHEAD: Duration = Duration::from_secs(60);
/// Повтор обновления после сетевой ошибки.
const RETRY: Duration = Duration::from_secs(60);
/// Попытка входа живёт 10 минут; если срок не разобрался — столько же.
const LOGIN_TTL: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountUser {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AccountState {
    SignedOut,
    /// Открыта страница входа, ждём подтверждения в Discord.
    SigningIn,
    SignedIn,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountStatus {
    pub state: AccountState,
    /// Профиль; у вошедшего может быть `null`, пока его не получили с сервера.
    pub user: Option<AccountUser>,
    /// Ссылка входа — если браузер не открылся сам.
    pub sign_in_url: Option<String>,
    /// До какого момента (ISO) действует попытка входа.
    pub login_expires_at: Option<String>,
    /// Вошёл, но сервер сейчас недоступен — профиль из кэша.
    pub offline: bool,
    /// Ошибка входа или причина выхода — для человека.
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountProfile {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountDevice {
    pub id: String,
    /// `DESKTOP`, `EXTENSION`, `ADMIN_PANEL`.
    pub kind: String,
    pub name: String,
    pub last_seen_at: String,
    pub signed_in_until: String,
    /// Это устройство.
    pub current: bool,
}

/// Ответ сервера с токенами (`AuthSessionOutputElement`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    access_token: String,
    access_token_expires_at: String,
    refresh_token: String,
    refresh_token_expires_at: String,
    user: AccountUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartLogin {
    login_id: String,
    poll_secret: String,
    sign_in_url: String,
    expires_at: String,
    poll_interval_seconds: u64,
}

#[derive(Deserialize)]
struct PollLogin {
    status: String,
    session: Option<Session>,
}

/// Что лежит в `account.json`: без токенов.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cache {
    user: Option<AccountUser>,
    refresh_token_expires_at: Option<String>,
}

struct Inner {
    status: AccountStatus,
    /// Access-токен и срок (мс с эпохи).
    access: Option<(String, u64)>,
    /// Номер попытки входа: «Отмена» и новая попытка останавливают опрос прежней.
    login_generation: u64,
}

pub struct AccountService {
    inner: Mutex<Inner>,
    refresh_lock: Mutex<()>,
    cache_path: PathBuf,
    wake: Sender<()>,
}

impl AccountService {
    pub fn status(&self) -> AccountStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// Обновить токен сейчас (связь с сервером появилась).
    pub fn wake(&self) {
        let _ = self.wake.send(());
    }

    fn save_cache(&self, user: Option<&AccountUser>, refresh_expires_at: Option<&str>) {
        let cache = Cache { user: user.cloned(), refresh_token_expires_at: refresh_expires_at.map(str::to_string) };
        if let Ok(bytes) = serde_json::to_vec_pretty(&cache) {
            let _ = write_atomic(&self.cache_path, &bytes);
        }
    }
}

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

fn stored_refresh_token() -> Option<String> {
    keyring_entry()?.get_password().ok().filter(|t| !t.is_empty())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// ISO-время сервера в UTC (`2026-11-10T18:00:00.000Z`) → мс с эпохи.
pub(crate) fn parse_iso_ms(text: &str) -> Option<u64> {
    let b = text.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> { text.get(from..from + len)?.parse().ok() };
    if b.len() < 20 || b[4] != b'-' || b[10] != b'T' {
        return None;
    }
    let (y, m, d) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (hh, mm, ss) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    let ms = if b.get(19) == Some(&b'.') { text.get(20..23).and_then(|t| t.parse::<i64>().ok()).unwrap_or(0) } else { 0 };
    // Дни от 1970-01-01 по григорианскому календарю (алгоритм days_from_civil).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = ((days * 24 + hh) * 60 + mm) * 60 + ss;
    u64::try_from(total * 1000 + ms).ok()
}

pub fn start(app: &AppHandle, paths: &AppPaths) {
    let cache_path = paths.file(CACHE_FILE);
    let cache: Option<Cache> = std::fs::read(&cache_path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let has_token = stored_refresh_token().is_some();
    let status = AccountStatus {
        state: if has_token { AccountState::SignedIn } else { AccountState::SignedOut },
        user: if has_token { cache.and_then(|c| c.user) } else { None },
        sign_in_url: None,
        login_expires_at: None,
        // Пока не обменяли токен на сервере, считаем профиль показанным из кэша.
        offline: has_token,
        message: None,
    };
    if !has_token {
        let _ = std::fs::remove_file(&cache_path);
    }
    let (wake, wake_rx) = mpsc::channel();
    app.manage(AccountService {
        inner: Mutex::new(Inner { status, access: None, login_generation: 0 }),
        refresh_lock: Mutex::new(()),
        cache_path,
        wake,
    });

    let app = app.clone();
    thread::Builder::new()
        .name("account-refresh".into())
        .spawn(move || loop {
            let wait = {
                let service = app.state::<AccountService>();
                let inner = service.inner.lock().unwrap();
                if inner.status.state != AccountState::SignedIn {
                    None
                } else {
                    let due = inner.access.as_ref().map(|(_, exp)| exp.saturating_sub(REFRESH_AHEAD.as_millis() as u64)).unwrap_or(0);
                    Some(Duration::from_millis(due.saturating_sub(now_ms())))
                }
            };
            let woke = match wait {
                // Не вошли — спать, пока не разбудят (вход, связь).
                None => wake_rx.recv().map(|_| ()).map_err(|_| RecvTimeoutError::Disconnected),
                Some(d) if d.is_zero() => Ok(()),
                Some(d) => wake_rx.recv_timeout(d),
            };
            match woke {
                Err(RecvTimeoutError::Disconnected) => return,
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            }
            let needs = {
                let service = app.state::<AccountService>();
                let inner = service.inner.lock().unwrap();
                inner.status.state == AccountState::SignedIn
                    && inner.access.as_ref().is_none_or(|(_, exp)| *exp <= now_ms() + REFRESH_AHEAD.as_millis() as u64)
            };
            if needs && matches!(refresh(&app, None), Err(RefreshError::Network)) {
                // Нет связи: попробовать позже или когда сервер вернётся (`wake`).
                if let Err(RecvTimeoutError::Disconnected) = wake_rx.recv_timeout(RETRY) {
                    return;
                }
            }
        })
        .expect("spawn account refresh");
}

fn publish(app: &AppHandle) {
    let status = app.state::<AccountService>().status();
    let _ = app.emit(EVENT, status);
}

fn api(app: &AppHandle) -> Arc<Api> {
    app.state::<Arc<Api>>().inner().clone()
}

/// Сессия получена (вход или обмен токена): refresh — в keyring, access — в память, профиль — в кэш.
fn store_session(app: &AppHandle, session: Session) -> Result<String, String> {
    keyring_entry()
        .ok_or("хранилище учётных данных Windows недоступно")?
        .set_password(&session.refresh_token)
        .map_err(|e| format!("не удалось сохранить вход в хранилище учётных данных: {e}"))?;
    let service = app.state::<AccountService>();
    let expires = parse_iso_ms(&session.access_token_expires_at).unwrap_or_else(|| now_ms() + 14 * 60 * 1000);
    let signed_in_now = {
        let mut inner = service.inner.lock().unwrap();
        let was = inner.status.state == AccountState::SignedIn && inner.status.user.is_some();
        inner.access = Some((session.access_token.clone(), expires));
        inner.status = AccountStatus {
            state: AccountState::SignedIn,
            user: Some(session.user.clone()),
            sign_in_url: None,
            login_expires_at: None,
            offline: false,
            message: None,
        };
        !was
    };
    service.save_cache(Some(&session.user), Some(&session.refresh_token_expires_at));
    service.wake();
    publish(app);
    // Вход (или первый обмен после запуска) — синхронизировать данные сразу.
    if signed_in_now
        && let Some(sync) = app.try_state::<crate::sync::SyncService>() {
            sync.wake_now();
        }
    Ok(session.access_token)
}

/// Выйти локально: стереть токены и профиль; `message` — почему (видно в настройках).
fn sign_out_local(app: &AppHandle, message: Option<String>) {
    if let Some(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    let service = app.state::<AccountService>();
    {
        let mut inner = service.inner.lock().unwrap();
        inner.access = None;
        inner.login_generation += 1;
        inner.status = AccountStatus { state: AccountState::SignedOut, user: None, sign_in_url: None, login_expires_at: None, offline: false, message };
    }
    let _ = std::fs::remove_file(&service.cache_path);
    publish(app);
    if let Some(sync) = app.try_state::<crate::sync::SyncService>() {
        sync.wake_now();
    }
}

enum RefreshError {
    /// Не вошли или вход больше не действует (уже вышли локально).
    SignedOut(String),
    /// Нет связи — сессия цела, попробовать позже.
    Network,
}

/// Обмен refresh-токена, строго по одному. `stale` — access, который сервер только что отверг.
fn refresh(app: &AppHandle, stale: Option<&str>) -> Result<String, RefreshError> {
    let service = app.state::<AccountService>();
    let _turn = service.refresh_lock.lock().unwrap();
    // Пока ждали очереди, другой поток мог уже обменять токен.
    if let Some((token, exp)) = service.inner.lock().unwrap().access.clone()
        && Some(token.as_str()) != stale && exp > now_ms() + REFRESH_AHEAD.as_millis() as u64 {
            return Ok(token);
        }
    let Some(refresh_token) = stored_refresh_token() else {
        return Err(RefreshError::SignedOut("войдите в аккаунт".into()));
    };
    match api(app).send::<Session>(Call::post("/v1/auth/refresh", json!({ "refreshToken": refresh_token }))) {
        Ok(Reply::Fresh { value, .. }) => store_session(app, value).map_err(RefreshError::SignedOut),
        Ok(Reply::NotModified { .. }) => Err(RefreshError::Network),
        Err(e) if e.kind == ApiErrorKind::Api => {
            let message = if e.has(ApiCode::RefreshTokenReused) {
                "Вход отменён: токен использован повторно. Войдите снова.".to_string()
            } else if e.has(ApiCode::UserBlocked) {
                "Аккаунт заблокирован.".to_string()
            } else if e.has(ApiCode::UserNotFound) {
                "Аккаунт удалён.".to_string()
            } else {
                "Сеанс завершён (устройство отозвано или вход истёк). Войдите снова.".to_string()
            };
            sign_out_local(app, Some(message.clone()));
            Err(RefreshError::SignedOut(message))
        }
        Err(_) => {
            {
                let mut inner = service.inner.lock().unwrap();
                if inner.status.state == AccountState::SignedIn {
                    inner.status.offline = true;
                }
            }
            publish(app);
            Err(RefreshError::Network)
        }
    }
}

/// Access-токен для запроса: действующий или только что обменянный.
fn access_token(app: &AppHandle) -> Result<String, String> {
    let current = app.state::<AccountService>().inner.lock().unwrap().access.clone();
    match current {
        Some((token, exp)) if exp > now_ms() + REFRESH_AHEAD.as_millis() as u64 => Ok(token),
        _ => refresh(app, None).map_err(|e| match e {
            RefreshError::SignedOut(message) => message,
            RefreshError::Network => "нет связи с сервером".into(),
        }),
    }
}

/// Почему запрос с входом не удался.
pub(crate) enum SignedInError {
    /// Нет входа, вход больше не действует или нет связи для обмена токена — словами.
    Auth(String),
    /// Ответ сервера: коды в `errors`.
    Api(ApiError),
}

impl SignedInError {
    pub(crate) fn message(&self) -> String {
        match self {
            Self::Auth(message) => message.clone(),
            Self::Api(e) => describe(e),
        }
    }
}

/// Запрос к маршруту, где нужен вход: с access-токеном, а на 401 `-600008` — обмен и один повтор.
pub(crate) fn send_signed_in_raw<T: DeserializeOwned>(app: &AppHandle, call: impl Fn() -> Call) -> Result<T, SignedInError> {
    let token = access_token(app).map_err(SignedInError::Auth)?;
    let api = api(app);
    let reply = match api.send::<T>(call().bearer(&token)) {
        Err(e) if e.has(ApiCode::AccessTokenRequired) => {
            let token = refresh(app, Some(&token)).map_err(|e| {
                SignedInError::Auth(match e {
                    RefreshError::SignedOut(message) => message,
                    RefreshError::Network => "нет связи с сервером".into(),
                })
            })?;
            api.send::<T>(call().bearer(&token))
        }
        other => other,
    };
    match reply {
        Ok(Reply::Fresh { value, .. }) => Ok(value),
        Ok(Reply::NotModified { .. }) => Err(SignedInError::Auth("сервер ответил 304 без запроса".into())),
        Err(e) => Err(SignedInError::Api(e)),
    }
}

fn send_signed_in<T: DeserializeOwned>(app: &AppHandle, call: impl Fn() -> Call) -> Result<T, String> {
    send_signed_in_raw(app, call).map_err(|e| e.message())
}

/// Ошибка входа — словами.
fn describe(e: &ApiError) -> String {
    let known = [
        (ApiCode::SignInNotConfigured, "Вход не настроен на сервере."),
        (ApiCode::LoginNotFound, "Попытка входа не найдена — начните вход заново."),
        (ApiCode::LoginExpired, "Время на вход истекло — начните заново."),
        (ApiCode::LoginAlreadyCollected, "Этот вход уже завершён — начните заново."),
        (ApiCode::UserBlocked, "Аккаунт заблокирован."),
        (ApiCode::IdentityProviderFailed, "Discord не ответил — попробуйте ещё раз."),
        (ApiCode::DeviceNotFound, "Такого устройства уже нет."),
    ];
    known.iter().find(|(code, _)| e.has(*code)).map(|(_, text)| text.to_string()).unwrap_or_else(|| e.message.clone())
}

fn device_name() -> String {
    match std::env::var("COMPUTERNAME") {
        Ok(name) if !name.is_empty() => format!("poe-manager · {name}"),
        _ => "poe-manager".into(),
    }
}

/// Опрос попытки входа в своём потоке, пока не придут токены, не истечёт срок или не отменят.
fn poll_login(app: AppHandle, generation: u64, login: StartLogin) {
    let deadline = match parse_iso_ms(&login.expires_at) {
        Some(at) => Instant::now() + Duration::from_millis(at.saturating_sub(now_ms())),
        None => Instant::now() + LOGIN_TTL,
    };
    let interval = Duration::from_secs(login.poll_interval_seconds.clamp(1, 10));
    let api = api(&app);
    let current = |app: &AppHandle| app.state::<AccountService>().inner.lock().unwrap().login_generation == generation;
    let fail = |app: &AppHandle, message: String| {
        let service = app.state::<AccountService>();
        let mut inner = service.inner.lock().unwrap();
        if inner.login_generation == generation {
            inner.status = AccountStatus { state: AccountState::SignedOut, user: None, sign_in_url: None, login_expires_at: None, offline: false, message: Some(message) };
            drop(inner);
            publish(app);
        }
    };
    loop {
        thread::sleep(interval);
        if !current(&app) {
            return;
        }
        if Instant::now() > deadline {
            return fail(&app, "Время на вход истекло — начните заново.".into());
        }
        let call = Call::get(format!("/v1/auth/logins/{}", login.login_id)).header("X-Poll-Secret", login.poll_secret.clone());
        match api.send::<PollLogin>(call) {
            Ok(Reply::Fresh { value, .. }) if value.status == "signed-in" => {
                if let Some(session) = value.session {
                    if !current(&app) {
                        return;
                    }
                    if let Err(message) = store_session(&app, session) {
                        fail(&app, message);
                    }
                    return;
                }
            }
            Ok(_) => {}
            // Связь пропала или лимит — продолжать до срока попытки.
            Err(e) if matches!(e.kind, ApiErrorKind::Network | ApiErrorKind::Timeout | ApiErrorKind::RateLimited | ApiErrorKind::Unconfigured) => {}
            Err(e) => return fail(&app, describe(&e)),
        }
    }
}

#[tauri::command]
pub fn account_status(service: State<AccountService>) -> AccountStatus {
    service.status()
}

/// Начать вход: попытка на сервере → страница входа в браузере → опрос.
#[tauri::command]
pub async fn account_login_start(app: AppHandle) -> Result<AccountStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api = api(&app);
        let body = json!({ "deviceId": api.device_id(), "deviceKind": "DESKTOP", "deviceName": device_name() });
        let login = match api.send::<StartLogin>(Call::post("/v1/auth/logins", body)) {
            Ok(Reply::Fresh { value, .. }) => value,
            Ok(Reply::NotModified { .. }) => return Err("сервер ответил 304 без запроса".to_string()),
            Err(e) => return Err(describe(&e)),
        };
        let service = app.state::<AccountService>();
        let generation = {
            let mut inner = service.inner.lock().unwrap();
            inner.login_generation += 1;
            inner.status = AccountStatus {
                state: AccountState::SigningIn,
                user: None,
                sign_in_url: Some(login.sign_in_url.clone()),
                login_expires_at: Some(login.expires_at.clone()),
                offline: false,
                message: None,
            };
            inner.login_generation
        };
        publish(&app);
        if let Err(e) = app.opener().open_url(&login.sign_in_url, None::<&str>) {
            eprintln!("[account] браузер не открылся: {e}");
        }
        let poller = app.clone();
        thread::Builder::new().name("account-login".into()).spawn(move || poll_login(poller, generation, login)).map_err(|e| e.to_string())?;
        Ok(service.status())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Отменить вход: опрос прекращается, попытка на сервере истечёт сама.
#[tauri::command]
pub fn account_login_cancel(app: AppHandle, service: State<AccountService>) -> AccountStatus {
    {
        let mut inner = service.inner.lock().unwrap();
        if inner.status.state == AccountState::SigningIn {
            inner.login_generation += 1;
            inner.status = AccountStatus { state: AccountState::SignedOut, user: None, sign_in_url: None, login_expires_at: None, offline: false, message: None };
        }
    }
    publish(&app);
    service.status()
}

/// Выйти: сервер отзывает refresh-токен (отвечает успехом всегда), локально всё стирается.
#[tauri::command]
pub async fn account_logout(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(token) = stored_refresh_token() {
            let _ = api(&app).send::<IgnoredAny>(Call::post("/v1/auth/logout", json!({ "refreshToken": token })));
        }
        sign_out_local(&app, None);
    })
    .await
    .map_err(|e| e.to_string())
}

/// Профиль с сервера; обновляет и кэш для показа без сети.
#[tauri::command]
pub async fn account_profile(app: AppHandle) -> Result<AccountProfile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile: AccountProfile = send_signed_in(&app, || Call::get("/v1/me"))?;
        let user = AccountUser { id: profile.id.clone(), display_name: profile.display_name.clone(), avatar_url: profile.avatar_url.clone() };
        let service = app.state::<AccountService>();
        let changed = {
            let mut inner = service.inner.lock().unwrap();
            let changed = inner.status.user.as_ref() != Some(&user);
            inner.status.user = Some(user.clone());
            changed
        };
        if changed {
            let refresh_expires = std::fs::read(&service.cache_path).ok().and_then(|b| serde_json::from_slice::<Cache>(&b).ok()).and_then(|c| c.refresh_token_expires_at);
            service.save_cache(Some(&user), refresh_expires.as_deref());
            publish(&app);
        }
        Ok(profile)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn account_devices(app: AppHandle) -> Result<Vec<AccountDevice>, String> {
    tauri::async_runtime::spawn_blocking(move || send_signed_in(&app, || Call::get("/v1/me/devices"))).await.map_err(|e| e.to_string())?
}

/// Выйти на устройстве; своё — значит выйти здесь.
#[tauri::command]
pub async fn account_revoke_device(app: AppHandle, device_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = format!("/v1/me/devices/{device_id}");
        let _: IgnoredAny = send_signed_in(&app, || Call::delete(path.clone()))?;
        if device_id == api(&app).device_id().to_string() {
            sign_out_local(&app, Some("Вы вышли на этом устройстве.".into()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Export {
    exported_at: String,
}

/// Выгрузка всех данных аккаунта в «Загрузки»; файл показывается в проводнике. Возвращает путь.
#[tauri::command]
pub async fn account_export(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data: serde_json::Value = send_signed_in(&app, || Call::get("/v1/me/export"))?;
        let stamp = serde_json::from_value::<Export>(data.clone()).map(|e| e.exported_at.chars().take(19).collect::<String>().replace(':', "-")).unwrap_or_else(|_| now_ms().to_string());
        let dir = app.path().download_dir().map_err(|e| format!("папка «Загрузки» не найдена: {e}"))?;
        let path = dir.join(format!("poe-manager-export-{stamp}.json"));
        let bytes = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
        write_atomic(&path, &bytes).map_err(|e| format!("файл не записан: {e}"))?;
        let _ = app.opener().reveal_item_in_dir(&path);
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Удалить аккаунт на сервере (сразу и навсегда) и выйти здесь.
#[tauri::command]
pub async fn account_delete(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: IgnoredAny = send_signed_in(&app, || Call::delete("/v1/me"))?;
        sign_out_local(&app, Some("Аккаунт удалён.".into()));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
