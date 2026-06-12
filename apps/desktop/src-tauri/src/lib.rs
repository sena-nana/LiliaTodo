use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::Color,
    AppHandle, Manager, Theme, WebviewWindow, WindowEvent, Wry,
};

const MAIN_WINDOW_LABEL: &str = "main";
const MENU_ID_WIDGET: &str = "show_widget";
const MENU_ID_QUIT: &str = "quit";
const SHOW_WIDGET_TEXT: &str = "显示小组件";
const CLOSE_WIDGET_TEXT: &str = "关闭小组件";

// 与前端 CSS 变量 --bg 保持一致：light=#ffffff、dark=#181818。
// 把窗口背景刷子调成这两个色，可以避免 Windows 在拉伸时露出默认白底。
const BG_LIGHT: Color = Color(0xFF, 0xFF, 0xFF, 0xFF);
const BG_DARK: Color = Color(0x18, 0x18, 0x18, 0xFF);

mod agent_codex_runner;
mod agent_runtime_state;
mod notification_scheduler;
mod widget_window;
mod window_state;

#[derive(Debug, PartialEq, Eq)]
enum WidgetTrayCommand {
    Show,
    Hide,
}

#[derive(Clone)]
struct TrayMenuState {
    widget_item: MenuItem<Wry>,
}

fn background_for(theme: Theme) -> Color {
    match theme {
        Theme::Dark => BG_DARK,
        _ => BG_LIGHT,
    }
}

fn apply_background(window: &WebviewWindow, theme: Theme) {
    let _ = window.set_background_color(Some(background_for(theme)));
}

fn widget_menu_text(is_widget_visible: bool) -> &'static str {
    if is_widget_visible {
        CLOSE_WIDGET_TEXT
    } else {
        SHOW_WIDGET_TEXT
    }
}

fn widget_tray_command(is_widget_visible: bool) -> WidgetTrayCommand {
    if is_widget_visible {
        WidgetTrayCommand::Hide
    } else {
        WidgetTrayCommand::Show
    }
}

fn sync_widget_menu_text(menu_state: &TrayMenuState, is_widget_visible: bool) {
    let _ = menu_state
        .widget_item
        .set_text(widget_menu_text(is_widget_visible));
}

fn sync_widget_menu_from_app(app: &AppHandle, is_widget_visible: bool) {
    let menu_state = app.state::<TrayMenuState>();
    sync_widget_menu_text(&menu_state, is_widget_visible);
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！这条问候来自 Rust。", name)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let widget_item = MenuItemBuilder::with_id(MENU_ID_WIDGET, SHOW_WIDGET_TEXT).build(app)?;
    let quit_item = MenuItemBuilder::with_id(MENU_ID_QUIT, "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&widget_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let menu_state = TrayMenuState {
        widget_item: widget_item.clone(),
    };
    app.manage(menu_state.clone());
    TrayIconBuilder::with_id("liliatodo-tray")
        .tooltip("LiliaTodo")
        .icon(app.default_window_icon().cloned().expect("窗口图标缺失"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_ID_WIDGET => {
                let widget = app.get_webview_window(widget_window::WIDGET_WINDOW_LABEL);
                let is_visible = widget
                    .as_ref()
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(false);
                match widget_tray_command(is_visible) {
                    WidgetTrayCommand::Hide => {
                        if let Some(window) = widget {
                            let _ = window.hide();
                        }
                        sync_widget_menu_text(&menu_state, false);
                    }
                    WidgetTrayCommand::Show => {
                        let _ = widget_window::show_widget_window(app);
                        sync_widget_menu_text(&menu_state, true);
                    }
                }
            }
            MENU_ID_QUIT => app.exit(0),
            _ => {}
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 小组件可见时托盘菜单显示关闭小组件() {
        assert_eq!(widget_menu_text(true), "关闭小组件");
    }

    #[test]
    fn 小组件不可见时托盘菜单显示显示小组件() {
        assert_eq!(widget_menu_text(false), "显示小组件");
    }

    #[test]
    fn 小组件可见时点击托盘项会请求隐藏小组件() {
        assert_eq!(widget_tray_command(true), WidgetTrayCommand::Hide);
    }

    #[test]
    fn 小组件不可见时点击托盘项会请求显示小组件() {
        assert_eq!(widget_tray_command(false), WidgetTrayCommand::Show);
    }

    #[test]
    fn 小组件配置默认不创建且不可抢焦点() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let widget_window = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"].as_str() == Some("widget"))
            .unwrap();

        assert_eq!(widget_window["create"].as_bool(), Some(false));
        assert_eq!(widget_window["visible"].as_bool(), Some(false));
        assert_eq!(widget_window["skipTaskbar"].as_bool(), Some(true));
        assert_eq!(widget_window["focus"].as_bool(), Some(false));
        assert_eq!(widget_window["focusable"].as_bool(), Some(false));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL
                && matches!(
                    event,
                    WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                )
            {
                if let Some(webview_window) = window.get_webview_window(MAIN_WINDOW_LABEL) {
                    window_state::persist_main_window_state(&window.app_handle(), &webview_window);
                }
            }
            if window.label() == widget_window::WIDGET_WINDOW_LABEL {
                match event {
                    WindowEvent::Destroyed => {
                        sync_widget_menu_from_app(window.app_handle(), false);
                    }
                    WindowEvent::Focused(true) => {
                        sync_widget_menu_from_app(window.app_handle(), true);
                    }
                    _ => {}
                }
            }
        })
        .setup(|app| {
            agent_runtime_state::init(app.handle());
            notification_scheduler::start(app.handle().clone());
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                if let Some(state) = window_state::load_main_window_state(app.handle()) {
                    window_state::restore_main_window_state(&window, state);
                }
                let initial_theme = window.theme().unwrap_or(Theme::Light);
                apply_background(&window, initial_theme);
                let follow = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::ThemeChanged(theme) = event {
                        apply_background(&follow, *theme);
                    }
                });
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            agent_runtime_state::agent_runtime_get_status,
            agent_runtime_state::agent_runtime_list_events,
            agent_runtime_state::agent_runtime_start,
            agent_runtime_state::agent_runtime_stop,
            agent_codex_runner::agent_runtime_trigger_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
