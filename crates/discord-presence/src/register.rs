//! Регистрация команды запуска для Discord (текущий пользователь, без прав администратора).
//!
//! Ключ `HKCU\Software\Classes\discord-<client_id>` — то же, что пишет `RegisterCommand` в SDK Discord.
//! По нему Discord запускает приложение, когда получатель нажимает «Присоединиться», а приложение
//! не запущено. После запуска приложение подключается к IPC, и Discord доставляет `ACTIVITY_JOIN`.

use std::io;

pub fn key_path(client_id: &str) -> String {
    format!(r"Software\Classes\discord-{client_id}")
}

/// Записать ключ. `command` — полная командная строка, например `"C:\…\poe-manager.exe"`.
#[cfg(windows)]
pub fn register_launch(client_id: &str, command: &str, icon: &str) -> io::Result<()> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (root, _) = hkcu.create_subkey(key_path(client_id))?;
    root.set_value("", &format!("URL:Run game {client_id} protocol"))?;
    root.set_value("URL Protocol", &"")?;
    let (default_icon, _) = root.create_subkey("DefaultIcon")?;
    default_icon.set_value("", &icon)?;
    let (open, _) = root.create_subkey(r"shell\open\command")?;
    open.set_value("", &command)?;
    Ok(())
}

/// Удалить ключ целиком. Отсутствие ключа — не ошибка.
#[cfg(windows)]
pub fn unregister_launch(client_id: &str) -> io::Result<()> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(key_path(client_id)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Командная строка, на которую сейчас указывает ключ (для диагностики).
#[cfg(windows)]
pub fn registered_command(client_id: &str) -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!(r"{}\shell\open\command", key_path(client_id))).ok()?.get_value("").ok()
}

#[cfg(not(windows))]
pub fn register_launch(_client_id: &str, _command: &str, _icon: &str) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "регистрация реализована только для Windows"))
}

#[cfg(not(windows))]
pub fn unregister_launch(_client_id: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn registered_command(_client_id: &str) -> Option<String> {
    None
}
