//! Иконки предметов для интерфейса: свой протокол `pmicon`, адрес — sha256 иконки
//! (`convertFileSrc(sha, "pmicon")` → `http://pmicon.localhost/<sha>` на Windows).
//!
//! Есть в `icons\<sha>.webp` — отдаём с диска. Нет — качаем по манифесту текущего набора
//! (`<icons.baseUrl><sha>.webp`), проверяем sha256 содержимого (имя файла и есть его хэш),
//! кладём в кэш и отдаём. Иконка не меняется никогда — кэшируется навсегда.
//! Без сети и без кэша — 404, интерфейс рисует заглушку.

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder};

use crate::api::Api;
use crate::dataset::{sha256_hex, DatasetService};
use crate::paths::{write_atomic, AppPaths};

pub const SCHEME: &str = "pmicon";
const TIMEOUT: Duration = Duration::from_secs(20);

/// Обработчик протокола: работа с диском и сетью — в пуле блокирующих задач.
pub fn handle(ctx: UriSchemeContext<'_, tauri::Wry>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().to_string();
    tauri::async_runtime::spawn_blocking(move || responder.respond(serve(&app, &path)));
}

fn serve(app: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let sha = path.trim_start_matches('/').trim_end_matches(".webp");
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return status(StatusCode::BAD_REQUEST);
    }
    let paths = app.state::<AppPaths>();
    let dir = paths.root().join("icons");
    let file = dir.join(format!("{sha}.webp"));
    if let Ok(bytes) = fs::read(&file) {
        return image(bytes);
    }

    let Some(icons) = app.state::<DatasetService>().icons() else {
        return status(StatusCode::NOT_FOUND);
    };
    let url = format!("{}{sha}.{}", icons.base_url, icons.extension);
    let api = app.state::<Arc<Api>>().inner().clone();
    match api.download(&url, TIMEOUT) {
        Ok(bytes) if sha256_hex(&bytes) == sha => {
            let _ = fs::create_dir_all(&dir).and_then(|_| write_atomic(&file, &bytes));
            image(bytes)
        }
        Ok(_) => status(StatusCode::BAD_GATEWAY),
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

fn image(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "image/webp")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(bytes)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}
