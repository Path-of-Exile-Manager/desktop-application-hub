//! Сборки Path of Building (вкладка «Билды»): разбор кода экспорта крейтом `pob-parser`.

use pob_parser::PobBuild;

/// Код экспорта PoB → сборка. Ошибка — словами для пользователя: «это не код…», «сборка для PoE2».
/// В отдельном потоке: гайд с десятком этапов — это сотни КБ XML.
#[tauri::command]
pub async fn pob_decode(code: String) -> Result<PobBuild, String> {
    tauri::async_runtime::spawn_blocking(move || pob_parser::parse_code(&code).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
