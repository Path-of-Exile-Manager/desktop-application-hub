//! Именованный канал между мостом и приложением.
//!
//! - Имя содержит пользователя: у каждого пользователя Windows свой канал.
//! - Доступ (DACL) — только текущему пользователю и SYSTEM. По умолчанию Windows даёт чтение
//!   «Everyone», поэтому дескриптор безопасности задаём явно.
//! - Первый экземпляр создаётся с FILE_FLAG_FIRST_PIPE_INSTANCE: если имя уже занято
//!   (второй экземпляр приложения или чужой процесс), сервер не запускается.
//! - Удалённые клиенты отклоняются (tokio делает это по умолчанию).

#[cfg(not(windows))]
use std::io;

/// `\\.\pipe\poe-manager-bridge-<пользователь>`.
pub fn default_pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
    let safe: String = user.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    format!(r"\\.\pipe\poe-manager-bridge-{safe}")
}

/// ERROR_PIPE_BUSY: все экземпляры канала заняты, сервер вот-вот создаст следующий.
pub const ERROR_PIPE_BUSY: i32 = 231;

#[cfg(windows)]
pub use windows_impl::{create_server, open_client};

#[cfg(windows)]
mod windows_impl {
    use std::ffi::c_void;
    use std::io;

    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows::Win32::Security::{GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::{PCWSTR, PWSTR};

    fn win(e: windows::core::Error) -> io::Error {
        io::Error::from_raw_os_error(e.code().0 & 0xFFFF)
    }

    /// SID текущего пользователя строкой: `S-1-5-21-…`.
    fn current_user_sid() -> io::Result<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(win)?;
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
            // u64 — чтобы буфер был выровнен под TOKEN_USER.
            let mut buf = vec![0u64; (len as usize).div_ceil(8)];
            let result = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr().cast::<c_void>()), len, &mut len);
            let _ = CloseHandle(token);
            result.map_err(win)?;
            let user = &*(buf.as_ptr().cast::<TOKEN_USER>());
            let mut sid = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut sid).map_err(win)?;
            let text = sid.to_string().map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e));
            let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
            text
        }
    }

    /// Создать экземпляр сервера канала с доступом только для текущего пользователя и SYSTEM.
    pub fn create_server(name: &str, first_instance: bool) -> io::Result<NamedPipeServer> {
        let sddl = format!("D:P(A;;GA;;;SY)(A;;GA;;;{})", current_user_sid()?);
        let wide: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(wide.as_ptr()), SDDL_REVISION_1, &mut descriptor, None).map_err(win)?;
            let mut attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor.0,
                bInheritHandle: false.into(),
            };
            let server = ServerOptions::new()
                .first_pipe_instance(first_instance)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(name, (&mut attributes as *mut SECURITY_ATTRIBUTES).cast::<c_void>());
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
            server
        }
    }

    pub fn open_client(name: &str) -> io::Result<NamedPipeClient> {
        ClientOptions::new().open(name)
    }
}

#[cfg(not(windows))]
pub fn create_server(_name: &str, _first_instance: bool) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "именованные каналы есть только в Windows"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn pipe_name_is_safe() {
        let name = super::default_pipe_name();
        assert!(name.starts_with(r"\\.\pipe\poe-manager-bridge-"));
        assert!(!name[r"\\.\pipe\".len()..].contains('\\'));
    }
}
