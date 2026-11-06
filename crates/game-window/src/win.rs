//! Реализация на WinAPI (крейт `windows` от Microsoft).

use std::ffi::c_void;
use std::mem::size_of;

use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetClientRect, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_STYLE, WS_CAPTION,
};
use windows::core::{BOOL, PWSTR};

use crate::{detect_mode, kind_from_title, pick, GameStatus, GameWindow, ModeInput, Rect, WINDOW_CLASS};

/// Найти окно игры и описать его состояние. Дёшево (десятки микросекунд), можно вызывать часто.
pub fn detect() -> GameStatus {
    let mut hwnds: Vec<HWND> = Vec::new();
    // SAFETY: колбэк получает указатель на наш Vec и использует его только во время EnumWindows.
    unsafe {
        let _ = EnumWindows(Some(collect_game_windows), LPARAM(&mut hwnds as *mut Vec<HWND> as isize));
    }
    let windows = hwnds.into_iter().filter_map(describe).collect();
    pick(windows, process_elevated(unsafe { GetCurrentProcess() }).unwrap_or(false))
}

unsafe extern "system" fn collect_game_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
    if unsafe { IsWindowVisible(hwnd) }.as_bool() && class_name(hwnd) == WINDOW_CLASS {
        out.push(hwnd);
    }
    BOOL(1) // продолжать перебор
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn describe(hwnd: HWND) -> Option<GameWindow> {
    let title = window_title(hwnd);
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };

    let mut window = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut window) }.ok()?;
    let window = Rect::from_ltrb(window.left, window.top, window.right, window.bottom);

    let mut client = RECT::default();
    unsafe { GetClientRect(hwnd, &mut client) }.ok()?;
    let mut origin = POINT { x: 0, y: 0 };
    let _ = unsafe { ClientToScreen(hwnd, &mut origin) };
    let client = Rect { x: origin.x, y: origin.y, width: client.right - client.left, height: client.bottom - client.top };

    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;
    let focused = unsafe { GetForegroundWindow() } == hwnd;
    // «Эксклюзивный полноэкранный D3D» Windows сообщает только про окно на переднем плане.
    let exclusive_fullscreen =
        focused && matches!(unsafe { SHQueryUserNotificationState() }, Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN);

    let mode = detect_mode(ModeInput {
        minimized: unsafe { IsIconic(hwnd) }.as_bool(),
        has_caption: style & WS_CAPTION.0 == WS_CAPTION.0,
        window,
        monitor: monitor_rect(hwnd),
        exclusive_fullscreen,
    });

    let (exe, elevated) = match ProcessHandle::open(pid) {
        Some(p) => (exe_name(p.0), process_elevated(p.0)),
        // Не открывается даже на чтение — почти всегда это процесс администратора.
        None => (None, None),
    };

    Some(GameWindow { hwnd: hwnd.0 as isize, kind: kind_from_title(&title), pid, title, exe, mode, client, focused, elevated })
}

fn monitor_rect(hwnd: HWND) -> Rect {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        let r = info.rcMonitor;
        Rect::from_ltrb(r.left, r.top, r.right, r.bottom)
    } else {
        Rect::default()
    }
}

/// Дескриптор процесса, который закрывается сам.
struct ProcessHandle(HANDLE);

impl ProcessHandle {
    fn open(pid: u32) -> Option<Self> {
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok().map(ProcessHandle)
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

fn exe_name(process: HANDLE) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.ok()?;
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    path.rsplit('\\').next().map(str::to_owned)
}

/// Запущен ли процесс с правами администратора. `None` — нет доступа к токену процесса.
fn process_elevated(process: HANDLE) -> Option<bool> {
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
    let token = ProcessHandle(token);
    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned = 0u32;
    let ok = unsafe {
        GetTokenInformation(
            token.0,
            TokenElevation,
            Some(&mut elevation as *mut TOKEN_ELEVATION as *mut c_void),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    };
    ok.ok().map(|_| elevation.TokenIsElevated != 0)
}

/// Поддельное окно игры — для тестов и ручной проверки без запущенного PoE.
pub mod fake {
    use std::sync::mpsc;
    use std::thread;

    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, IsWindow, PostMessageW, RegisterClassW,
        TranslateMessage, MSG, WINDOW_EX_STYLE, WM_CLOSE, WNDCLASSW, WS_EX_NOACTIVATE, WS_OVERLAPPEDWINDOW, WS_POPUP,
        WS_VISIBLE,
    };
    use windows::core::{w, HSTRING, PCWSTR};

    /// Окно, которое живёт в своём потоке с циклом сообщений. Закрывается при `drop`.
    pub struct FakeWindow {
        pub hwnd: isize,
        thread: Option<thread::JoinHandle<()>>,
    }

    pub struct FakeOptions<'a> {
        pub title: &'a str,
        /// `true` — окно без рамки (WS_POPUP), `false` — обычное окно с заголовком.
        pub borderless: bool,
        pub x: i32,
        pub y: i32,
        pub width: i32,
        pub height: i32,
        /// Не забирать фокус (для автотестов).
        pub no_activate: bool,
    }

    unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    pub fn spawn(opts: FakeOptions) -> windows::core::Result<FakeWindow> {
        let title = HSTRING::from(opts.title);
        let (borderless, x, y, w_, h_, no_activate) = (opts.borderless, opts.x, opts.y, opts.width, opts.height, opts.no_activate);
        let (tx, rx) = mpsc::channel();
        let thread = thread::spawn(move || unsafe {
            let instance = GetModuleHandleW(None).expect("GetModuleHandleW");
            let class = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: instance.into(),
                lpszClassName: w!("POEWindowClass"),
                ..Default::default()
            };
            RegisterClassW(&class); // повторная регистрация в том же процессе вернёт 0 — это нормально
            let style = if borderless { WS_POPUP | WS_VISIBLE } else { WS_OVERLAPPEDWINDOW | WS_VISIBLE };
            let ex = if no_activate { WS_EX_NOACTIVATE } else { WINDOW_EX_STYLE(0) };
            let created = CreateWindowExW(ex, w!("POEWindowClass"), PCWSTR(title.as_ptr()), style, x, y, w_, h_, None, None, Some(instance.into()), None);
            let hwnd = match created {
                Ok(h) => h,
                Err(e) => {
                    let _ = tx.send(Err(e));
                    return;
                }
            };
            let _ = tx.send(Ok(hwnd.0 as isize));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
                if !IsWindow(Some(hwnd)).as_bool() {
                    break;
                }
            }
        });
        let hwnd = rx.recv().expect("fake window thread")?;
        Ok(FakeWindow { hwnd, thread: Some(thread) })
    }

    impl Drop for FakeWindow {
        fn drop(&mut self) {
            let _ = unsafe { PostMessageW(Some(HWND(self.hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }
}
