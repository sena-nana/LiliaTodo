use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const WIDGET_WINDOW_LABEL: &str = "widget";
const WIDGET_WINDOW_TITLE: &str = "LiliaTodo 小组件";
const WIDGET_WINDOW_URL: &str = "/widget";
const WIDGET_WINDOW_WIDTH: f64 = 360.0;
const WIDGET_WINDOW_HEIGHT: f64 = 560.0;

pub(crate) fn show_widget_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = match app.get_webview_window(WIDGET_WINDOW_LABEL) {
        Some(window) => window,
        None => create_widget_window(app)?,
    };
    apply_widget_window_constraints(&window);
    window.show()?;
    Ok(window)
}

fn create_widget_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app,
        WIDGET_WINDOW_LABEL,
        WebviewUrl::App(WIDGET_WINDOW_URL.into()),
    )
    .title(WIDGET_WINDOW_TITLE)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .inner_size(WIDGET_WINDOW_WIDTH, WIDGET_WINDOW_HEIGHT)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()?;
    Ok(window)
}

fn apply_widget_window_constraints(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_resizable(false);
    let _ = window.set_focusable(false);
    if let Err(error) = apply_widget_platform_style(window) {
        eprintln!("[widget-window] {error}");
    }
}

#[cfg(target_os = "windows")]
fn apply_widget_platform_style(window: &WebviewWindow) -> Result<(), String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        },
    };

    let handle = window
        .window_handle()
        .map_err(|error| format!("读取小组件窗口句柄失败: {error}"))?;
    let RawWindowHandle::Win32(raw_handle) = handle.as_raw() else {
        return Ok(());
    };
    let hwnd = raw_handle.hwnd.get() as HWND;
    let previous_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let next_style = widget_ex_style(previous_style);
    if next_style != previous_style {
        unsafe {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        }
    }

    let refreshed = unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if refreshed == 0 {
        let error = std::io::Error::last_os_error();
        return Err(format!("刷新小组件 Win32 样式失败: {error}"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply_widget_platform_style(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn widget_ex_style(ex_style: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    (ex_style | WS_EX_TOOLWINDOW as isize | WS_EX_NOACTIVATE as isize) & !(WS_EX_APPWINDOW as isize)
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "windows")]
    fn win32_样式桥接会隐藏任务切换入口并禁止激活() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        let style = super::widget_ex_style(WS_EX_APPWINDOW as isize);

        assert_eq!(style & WS_EX_TOOLWINDOW as isize, WS_EX_TOOLWINDOW as isize);
        assert_eq!(style & WS_EX_NOACTIVATE as isize, WS_EX_NOACTIVATE as isize);
        assert_eq!(style & WS_EX_APPWINDOW as isize, 0);
    }
}
