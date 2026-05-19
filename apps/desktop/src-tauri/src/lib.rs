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
        // BE-12 sprint-4.3b：WebDAV 凭据（用户名/应用密码）经 plugin-store 落到 OS 用户目录，
        // 不写浏览器 localStorage；store 文件由 capabilities/default.json 的 store:default 收口。
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
