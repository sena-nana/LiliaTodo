use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::Color,
    AppHandle, Manager, Theme, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const MENU_ID_QUIT: &str = "quit";

// 与前端 CSS 变量 --bg 保持一致：light=#f7f7f8、dark=#1c1c1e。
// 把窗口背景刷子调成这两个色，可以避免 Windows 在拉伸时露出默认白底。
const BG_LIGHT: Color = Color(0xF7, 0xF7, 0xF8, 0xFF);
const BG_DARK: Color = Color(0x1C, 0x1C, 0x1E, 0xFF);

fn background_for(theme: Theme) -> Color {
    match theme {
        Theme::Dark => BG_DARK,
        _ => BG_LIGHT,
    }
}

fn apply_background(window: &WebviewWindow, theme: Theme) {
    let _ = window.set_background_color(Some(background_for(theme)));
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！这条问候来自 Rust。", name)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let quit_item = MenuItemBuilder::with_id(MENU_ID_QUIT, "退出").build(app)?;
    let menu = MenuBuilder::new(app).item(&quit_item).build()?;

    TrayIconBuilder::with_id("momo-tray")
        .tooltip("Momo")
        .icon(app.default_window_icon().cloned().expect("窗口图标缺失"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == MENU_ID_QUIT {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let initial_theme = window.theme().unwrap_or(Theme::Light);
                apply_background(&window, initial_theme);
                let follow = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::ThemeChanged(theme) = event {
                        apply_background(&follow, *theme);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
