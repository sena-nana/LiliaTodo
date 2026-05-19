// Tauri 命令说明见 https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！这条问候来自 Rust。", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // BE-12 sprint-4.3a：WebDAV 真实请求经此插件绕过浏览器进程 CORS；
        // 域名白名单在 capabilities/default.json 的 http:default scope 中收口。
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
