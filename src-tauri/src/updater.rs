//! Автообновление приложения (план — `shared/docs/app-updates.md`).
//!
//! Версию отдаёт api-hub (`GET /v1/app/update/windows-x86_64/<текущая>`: 204 — обновления нет, 200 — JSON
//! в формате `tauri-plugin-updater` плюс поле `mandatory`), сам установщик лежит в GitHub Releases.
//! Скачивание, проверку подписи и запуск NSIS делает `tauri-plugin-updater`; здесь — когда и что делать.
//!
//! Поток `updater`:
//! - при запуске и раз в 6 ч (после ошибки — через 30 мин, сразу — по `updater_check` и когда сервер
//!   снова на связи) спрашивает сервер;
//! - новую версию качает фоном в `updates\`, рядом пишет `pending.json` (ответ сервера), состояние `Ready` —
//!   в шапке плашка «Перезапустить» (`updater_restart`);
//! - не перезапустили — при следующем запуске скачанная версия ставится сразу, на экране запуска
//!   (если сервер ничего не ответил — по сохранённому ответу: подпись проверяется всё равно);
//! - обязательное обновление (`mandatory`) ставится сразу после загрузки, интерфейс тем временем закрыт
//!   экраном «Нужно обновление»;
//! - перед установкой пишет `installed.json` (версия и «Что нового»): после перезапуска интерфейс один раз
//!   показывает «Обновлено до X» (`updater_dismiss_whats_new`).
//!
//! В режиме моста для расширения (exe запущен Chrome, см. `main.rs`) сюда не попадаем: `run()` не вызывается.
//! Открытый ключ подписи — `plugins.updater.pubkey` в `tauri.conf.json`; пока он пустой, обновления выключены.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use ts_rs::TS;

use crate::api::Api;
use crate::paths::write_atomic;
use crate::server::ServerWatcher;

pub const EVENT: &str = "updater-status";
const DIR: &str = "updates";
const PENDING: &str = "pending.json";
const INSTALLED: &str = "installed.json";

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RETRY: Duration = Duration::from_secs(30 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// На весь установщик (~10 МБ) с медленной сетью.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Пауза между «Устанавливаем X» и закрытием приложения: чтобы экран успел это показать.
const INSTALL_NOTICE: Duration = Duration::from_millis(1500);
/// Путь эндпоинта; `{{target}}-{{arch}}` плагин заменит на `windows-x86_64`, версию — на текущую.
const ENDPOINT_PATH: &str = "/v1/app/update/{{target}}-{{arch}}/{{current_version}}";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum UpdatePhase {
    /// Ключ подписи не задан (`plugins.updater.pubkey`) — обновления выключены.
    Disabled,
    /// Ещё не проверяли, или адрес сервера не задан.
    Idle,
    Checking,
    UpToDate,
    Downloading,
    /// Скачано и проверено, ждёт «Перезапустить» или следующего запуска.
    Ready,
    /// Запускаем установщик, приложение сейчас закроется.
    Installing,
    Error,
}

/// «Что нового» в только что установленной версии.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WhatsNew {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateStatus {
    pub phase: UpdatePhase,
    pub current_version: String,
    /// Доступная версия (при `Downloading`, `Ready`, `Installing`; при `Error` — если ошибка в загрузке).
    pub version: Option<String>,
    /// Описание релиза с GitHub (markdown как есть).
    pub notes: Option<String>,
    /// Дата публикации, ISO.
    pub pub_date: Option<String>,
    /// Обязательное обновление: пока не установлено, интерфейс закрыт экраном «Нужно обновление».
    pub mandatory: bool,
    /// Скачано байт / всего (`null` — сервер не сказал размер).
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    /// Конец последней проверки, мс с 1970-01-01.
    pub checked_at: Option<u64>,
    /// Первая проверка после запуска завершилась (её ждёт шаг экрана запуска).
    pub settled: bool,
    pub whats_new: Option<WhatsNew>,
}

/// Скачанный установщик, ждущий установки: `updates\pending.json`.
#[derive(Debug, Deserialize, Serialize)]
struct Pending {
    version: String,
    /// Имя файла установщика в `updates\`.
    file: String,
    /// Ответ сервера целиком: по нему обновление восстанавливается без сети (`restore_update`).
    raw_json: serde_json::Value,
}

enum Wake {
    Check,
}

pub struct UpdaterService {
    status: Mutex<UpdateStatus>,
    wake: Mutex<Sender<Wake>>,
    /// Готовое к установке: обновление и путь к проверенному установщику.
    ready: Mutex<Option<(Update, PathBuf)>>,
    dir: PathBuf,
}

impl UpdaterService {
    pub fn status(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }

    /// Проверить сейчас (кнопка в Настройках, связь с сервером восстановилась).
    pub fn wake(&self) {
        let _ = self.wake.lock().unwrap().send(Wake::Check);
    }

    fn update(&self, app: &AppHandle, f: impl FnOnce(&mut UpdateStatus)) {
        let snapshot = {
            let mut status = self.status.lock().unwrap();
            f(&mut status);
            status.clone()
        };
        let _ = app.emit(EVENT, snapshot);
    }
}

pub fn start(app: &AppHandle, app_root: &Path) {
    let dir = app_root.join(DIR);
    let current_version = app.package_info().version.to_string();
    let enabled = !pubkey(app).is_empty();
    let whats_new = take_whats_new(&dir, &current_version);
    let status = UpdateStatus {
        phase: if enabled { UpdatePhase::Idle } else { UpdatePhase::Disabled },
        current_version,
        version: None,
        notes: None,
        pub_date: None,
        mandatory: false,
        downloaded: 0,
        total: None,
        error: None,
        checked_at: None,
        settled: !enabled,
        whats_new,
    };
    let (tx, rx) = mpsc::channel();
    app.manage(UpdaterService { status: Mutex::new(status), wake: Mutex::new(tx), ready: Mutex::new(None), dir });
    if !enabled {
        return;
    }
    let app = app.clone();
    thread::Builder::new().name("updater".into()).spawn(move || run(app, rx)).expect("spawn updater");
}

/// `plugins.updater.pubkey` из `tauri.conf.json`.
fn pubkey(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// `installed.json` от предыдущего запуска: «Что нового», если это и есть текущая версия.
fn take_whats_new(dir: &Path, current_version: &str) -> Option<WhatsNew> {
    let path = dir.join(INSTALLED);
    let installed = fs::read(&path).ok().and_then(|b| serde_json::from_slice::<WhatsNew>(&b).ok());
    match installed {
        Some(w) if w.version == current_version => Some(w),
        Some(_) | None => {
            // Установка не прошла или уже показали — файл больше не нужен.
            let _ = fs::remove_file(&path);
            None
        }
    }
}

fn run(app: AppHandle, wake: Receiver<Wake>) {
    let service = app.state::<UpdaterService>();
    let mut first = true;
    loop {
        let failed = tauri::async_runtime::block_on(cycle(&app, &service, first));
        if first {
            first = false;
            service.update(&app, |s| s.settled = true);
        }
        match wake.recv_timeout(if failed { RETRY } else { CHECK_INTERVAL }) {
            Ok(Wake::Check) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Одна проверка. `startup` — первая после запуска: скачанное в прошлый раз ставится сразу.
/// Возвращает `true`, если проверка не удалась (следующая — раньше обычного).
async fn cycle(app: &AppHandle, service: &UpdaterService, startup: bool) -> bool {
    let Some(server) = app.state::<ServerWatcher>().current_url() else {
        service.update(app, |s| s.phase = UpdatePhase::Idle);
        return false; // адреса нет — разбудит смена адреса и восстановление связи
    };
    let device_id = app.state::<Arc<Api>>().device_id().to_string();
    let updater = format!("{server}{ENDPOINT_PATH}")
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())
        .and_then(|endpoint| {
            app.updater_builder()
                .timeout(CHECK_TIMEOUT)
                .header("X-Device-Id", device_id)
                .and_then(|b| b.endpoints(vec![endpoint]))
                .and_then(|b| b.build())
                .map_err(|e| e.to_string())
        });
    let updater = match updater {
        Ok(updater) => updater,
        Err(e) => {
            service.update(app, |s| set_error(s, format!("настройка обновлений: {e}")));
            return true;
        }
    };

    // Уже скачанное и проверенное ждёт кнопки — повторная проверка не должна мигать в интерфейсе.
    let busy = matches!(service.status().phase, UpdatePhase::Ready | UpdatePhase::Downloading | UpdatePhase::Installing);
    if !busy {
        service.update(app, |s| {
            s.phase = UpdatePhase::Checking;
            s.error = None;
        });
    }

    let pending = read_pending(&service.dir);
    match updater.check().await {
        Err(e) => {
            // Нет связи. При запуске всё равно ставим скачанное в прошлый раз: подпись проверится по сохранённому ответу.
            if startup && let Some(pending) = pending {
                match updater.restore_update(pending.raw_json.clone()) {
                    Ok(Some(update)) if update.version == pending.version => {
                        let file = service.dir.join(&pending.file);
                        install(app, service, &update, &file);
                    }
                    _ => clear_pending(&service.dir),
                }
            }
            if !busy {
                service.update(app, |s| set_error(s, e.to_string()));
            }
            service.update(app, |s| s.checked_at = Some(now_ms()));
            true
        }
        Ok(None) => {
            // Актуально, или релиз придержали в админке — скачанное больше не нужно.
            clear_pending(&service.dir);
            *service.ready.lock().unwrap() = None;
            service.update(app, |s| {
                s.phase = UpdatePhase::UpToDate;
                s.version = None;
                s.notes = None;
                s.pub_date = None;
                s.mandatory = false;
                s.error = None;
                s.checked_at = Some(now_ms());
            });
            false
        }
        Ok(Some(update)) => {
            let mandatory = update.raw_json.get("mandatory").and_then(|m| m.as_bool()).unwrap_or(false);
            let pub_date = update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_string);
            service.update(app, |s| {
                s.version = Some(update.version.clone());
                s.notes = update.body.clone();
                s.pub_date = pub_date;
                s.mandatory = mandatory;
                s.checked_at = Some(now_ms());
            });

            // Эта версия уже скачана: в прошлый раз или раньше в этом запуске.
            if let Some(pending) = pending.filter(|p| p.version == update.version) {
                let file = service.dir.join(&pending.file);
                if fs::read(&file).ok().is_some_and(|bytes| update.verify(&bytes).is_ok()) {
                    if startup || mandatory {
                        install(app, service, &update, &file);
                        return true; // сюда возвращаемся, только если установщик не запустился
                    }
                    ready(app, service, update, file);
                    return false;
                }
            }

            clear_pending(&service.dir);
            *service.ready.lock().unwrap() = None;
            match download(app, service, update.clone()).await {
                Ok(file) => {
                    if mandatory {
                        install(app, service, &update, &file);
                        return true;
                    }
                    ready(app, service, update, file);
                    false
                }
                Err(e) => {
                    service.update(app, |s| set_error(s, e));
                    true
                }
            }
        }
    }
}

/// Качает установщик (подпись плагин проверяет сам) и сохраняет его рядом с `pending.json`.
async fn download(app: &AppHandle, service: &UpdaterService, mut update: Update) -> Result<PathBuf, String> {
    service.update(app, |s| {
        s.phase = UpdatePhase::Downloading;
        s.downloaded = 0;
        s.total = None;
        s.error = None;
    });
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let mut downloaded: u64 = 0;
    let mut reported: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                // Событие на каждый кусок (~16 КБ) — лишнее; раз в ~256 КБ хватает для полосы прогресса.
                if downloaded - reported >= 256 * 1024 || total == Some(downloaded) {
                    reported = downloaded;
                    service.update(app, |s| {
                        s.downloaded = downloaded;
                        s.total = total;
                    });
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("загрузка {}: {e}", update.version))?;

    fs::create_dir_all(&service.dir).map_err(|e| format!("папка обновлений: {e}"))?;
    let name = file_name(&update);
    let file = service.dir.join(&name);
    write_atomic(&file, &bytes).map_err(|e| format!("сохранить установщик: {e}"))?;
    let pending = Pending { version: update.version.clone(), file: name, raw_json: update.raw_json.clone() };
    let json = serde_json::to_vec_pretty(&pending).map_err(|e| e.to_string())?;
    write_atomic(&service.dir.join(PENDING), &json).map_err(|e| format!("сохранить pending.json: {e}"))?;
    Ok(file)
}

/// Имя файла из ссылки (`poe-manager_0.2.0_x64-setup.exe`), без неё — по версии.
fn file_name(update: &Update) -> String {
    update
        .download_url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .filter(|n| n.ends_with(".exe") && !n.contains(['\\', '/', ':']))
        .map(str::to_string)
        .unwrap_or_else(|| format!("poe-manager_{}_x64-setup.exe", update.version))
}

fn ready(app: &AppHandle, service: &UpdaterService, update: Update, file: PathBuf) {
    *service.ready.lock().unwrap() = Some((update, file));
    service.update(app, |s| {
        s.phase = UpdatePhase::Ready;
        s.error = None;
    });
}

/// Запускает установщик: при успехе приложение закрывается здесь же (`std::process::exit` в плагине),
/// NSIS ставит новую версию и запускает её. Возврат — только при ошибке.
fn install(app: &AppHandle, service: &UpdaterService, update: &Update, file: &Path) {
    service.update(app, |s| {
        s.phase = UpdatePhase::Installing;
        s.version = Some(update.version.clone());
        s.error = None;
    });
    thread::sleep(INSTALL_NOTICE);

    let result = fs::read(file).map_err(|e| format!("установщик не найден: {e}")).and_then(|bytes| {
        let notes = WhatsNew { version: update.version.clone(), notes: update.body.clone() };
        if let Ok(json) = serde_json::to_vec_pretty(&notes) {
            let _ = write_atomic(&service.dir.join(INSTALLED), &json);
        }
        update.install(bytes).map_err(|e| format!("установка {}: {e}", update.version))
    });
    if let Err(e) = result {
        // Файл битый или подпись не сходится — скачаем заново при следующей проверке.
        let _ = fs::remove_file(service.dir.join(INSTALLED));
        clear_pending(&service.dir);
        *service.ready.lock().unwrap() = None;
        service.update(app, |s| set_error(s, e));
    }
}

fn read_pending(dir: &Path) -> Option<Pending> {
    fs::read(dir.join(PENDING)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Удаляет `pending.json` и все скачанные установщики.
fn clear_pending(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == PENDING || name.ends_with(".exe") || name.ends_with(".tmp") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn set_error(status: &mut UpdateStatus, error: String) {
    status.phase = UpdatePhase::Error;
    status.error = Some(error);
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `invoke("updater_status")`.
#[tauri::command]
pub fn updater_status(service: State<UpdaterService>) -> UpdateStatus {
    service.status()
}

/// Проверить обновления сейчас.
#[tauri::command]
pub fn updater_check(service: State<UpdaterService>) {
    service.wake();
}

/// Кнопка «Перезапустить»: поставить скачанное обновление. Успех не возвращается — приложение закрывается.
#[tauri::command]
pub async fn updater_restart(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<UpdaterService>();
        let Some((update, file)) = service.ready.lock().unwrap().clone() else {
            return Err("обновление ещё не скачано".to_string());
        };
        install(&app, &service, &update, &file);
        Err(service.status().error.unwrap_or_else(|| "установщик не запустился".into()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// «Что нового» показали — больше не показывать.
#[tauri::command]
pub fn updater_dismiss_whats_new(app: AppHandle, service: State<UpdaterService>) {
    let _ = fs::remove_file(service.dir.join(INSTALLED));
    service.update(&app, |s| s.whats_new = None);
}
