//! Сборки Path of Building (вкладка «Билды»): разбор кода экспорта крейтом `pob-parser` и загрузка
//! кода по ссылке pobb.in / Pastebin / poe.ninja.
//!
//! Ссылки загружает само приложение, не api-hub (решение 3.11 в shared/docs/pob-trader.md): это
//! разовые запросы пользователя, а через один сервер все шли бы с одного IP, который Pastebin и
//! Cloudflare перед pobb.in режут. Ограничения: только белый список адресов (`pob_parser::parse_link`),
//! только HTTPS, без переходов, 15 с, ответ до 2 МБ, и ответ должен оказаться кодом PoE1.

use std::time::Duration;

use pob_parser::{PobBuild, PobLink, PobSite};
use serde::Serialize;
use ts_rs::TS;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const FETCH_LIMIT: u64 = 2 * 1024 * 1024;

/// Код PoB, скачанный по ссылке, и разобранная сборка.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobFetched {
    pub code: String,
    pub link: PobLink,
    pub build: PobBuild,
}

/// Код экспорта PoB → сборка. Ошибка — словами для пользователя: «это не код…», «сборка для PoE2».
/// В отдельном потоке: гайд с десятком этапов — это сотни КБ XML.
#[tauri::command]
pub async fn pob_decode(code: String) -> Result<PobBuild, String> {
    tauri::async_runtime::spawn_blocking(move || pob_parser::parse_code(&code).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Ссылка pobb.in / Pastebin / poe.ninja → код и сборка.
#[tauri::command]
pub async fn pob_fetch(url: String) -> Result<PobFetched, String> {
    tauri::async_runtime::spawn_blocking(move || fetch(&url)).await.map_err(|e| e.to_string())?
}

/// Открыть страницу сборки на её сайте в браузере. Только адреса из белого списка (`parse_link`):
/// запись билда пришла с другого устройства, произвольный адрес не открываем.
#[tauri::command]
pub fn pob_open_page(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let link = pob_parser::parse_link(&url).map_err(|e| e.to_string())?;
    app.opener().open_url(&link.url, None::<&str>).map_err(|e| e.to_string())
}

fn fetch(input: &str) -> Result<PobFetched, String> {
    let link = pob_parser::parse_link(input).map_err(|e| e.to_string())?;
    let site = link.site.label();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(FETCH_TIMEOUT))
        .user_agent(format!("poe-manager-desktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let mut response = agent.get(&link.raw_url).call().map_err(|e| transport_error(site, link.site, &e))?;
    let status = response.status().as_u16();
    match status {
        200..=299 => {}
        404 | 410 => return Err(format!("на {site} нет такой сборки — проверьте ссылку")),
        300..=399 => return Err(format!("{site} перенаправляет на другой адрес — откройте ссылку в браузере и скопируйте код")),
        429 => return Err(format!("{site} просит подождать — попробуйте через минуту")),
        _ => return Err(format!("{site} ответил HTTP {status}")),
    }
    let body = response.body_mut().with_config().limit(FETCH_LIMIT).read_to_vec().map_err(|e| transport_error(site, link.site, &e))?;
    let code: String = String::from_utf8_lossy(&body).split_whitespace().collect();
    let build = pob_parser::parse_code(&code).map_err(|e| format!("по ссылке {site} не код сборки: {e}"))?;
    Ok(PobFetched { code, link, build })
}

fn transport_error(site: &str, kind: PobSite, error: &ureq::Error) -> String {
    match error {
        ureq::Error::Timeout(_) => format!("{site} не ответил за {} с", FETCH_TIMEOUT.as_secs()),
        ureq::Error::BodyExceedsLimit(_) => format!("ответ {site} больше {} МБ — это не код сборки", FETCH_LIMIT / 1024 / 1024),
        // Pastebin закрыт в части сетей (в том числе у разработчика): соединение сбрасывается.
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Io(_) if kind == PobSite::Pastebin => {
            format!("{site} недоступен — в некоторых сетях он заблокирован; откройте ссылку в браузере и скопируйте код")
        }
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Io(_) => format!("{site} недоступен — проверьте подключение"),
        other => format!("{site}: {other}"),
    }
}
