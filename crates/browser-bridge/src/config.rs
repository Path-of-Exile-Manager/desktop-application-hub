//! Постоянные имена и идентификаторы.

use std::path::PathBuf;

/// Имя хоста Native Messaging: его передаёт расширение в `chrome.runtime.connectNative`.
pub const HOST_NAME: &str = "com.poemanager.bridge";

/// Идентификатор приложения Tauri (`tauri.conf.json`): папка данных — `%LOCALAPPDATA%\<он>`.
pub const APP_IDENTIFIER: &str = "com.poemanager.desktop";

/// ID разработческой сборки расширения: его фиксирует поле `key` в manifest.json расширения
/// (`extension/scripts/build.mjs`). ID из Chrome Web Store добавляется переменной сборки
/// `POE_MANAGER_EXTENSION_IDS` (через запятую), когда расширение опубликуют.
pub const DEV_EXTENSION_ID: &str = "abnbkbopbfhbfbinmeihjniikcamacol";

/// ID расширений, которым разрешено подключаться.
pub fn extension_ids() -> Vec<String> {
    let mut ids = vec![DEV_EXTENSION_ID.to_string()];
    if let Some(extra) = option_env!("POE_MANAGER_EXTENSION_IDS") {
        ids.extend(extra.split(',').map(str::trim).filter(|s| is_extension_id(s)).map(String::from));
    }
    ids.dedup();
    ids
}

/// Origin расширения так, как его пишет Chrome: `chrome-extension://<id>/`.
pub fn origin_for(id: &str) -> String {
    format!("chrome-extension://{id}/")
}

pub fn allowed_origins() -> Vec<String> {
    extension_ids().iter().map(|id| origin_for(id)).collect()
}

/// ID расширения: 32 буквы a–p.
pub fn is_extension_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// Chrome сам не пустит чужое расширение (allowed_origins в манифесте хоста), это вторая проверка.
pub fn origin_allowed(origin: &str) -> bool {
    let normalized = if origin.ends_with('/') { origin.to_string() } else { format!("{origin}/") };
    allowed_origins().contains(&normalized)
}

/// `%LOCALAPPDATA%\com.poemanager.desktop` — та же папка, что у Tauri `app_local_data_dir`.
pub fn local_data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join(APP_IDENTIFIER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_id_is_valid_and_allowed() {
        assert!(is_extension_id(DEV_EXTENSION_ID));
        assert!(origin_allowed("chrome-extension://abnbkbopbfhbfbinmeihjniikcamacol/"));
        assert!(origin_allowed("chrome-extension://abnbkbopbfhbfbinmeihjniikcamacol"));
        assert!(!origin_allowed("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
        assert!(!is_extension_id("ABNBKBOPBFHBFBINMEIHJNIIKCAMACOL"));
    }
}
