mod updater;

/// 没有指定发布仓库时，去哪里找新版本。CI 打包时会用 NYAEVENTLIST_UPDATE_REPOSITORY 覆盖成当前仓库。
const DEFAULT_UPDATE_REPOSITORY: &str = "stevennight/NyaEventList";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    name: String,
    version: String,
    commit: String,
    build_date: String,
    update_repository: String,
}

/// 发布构建由 CI 注入 NYAEVENTLIST_VERSION（形如 1.2.3）；本地构建没有这个变量，版本记为 `<Cargo 版本>-dev`，
/// 更新模块看到带后缀的版本就不会去检查/安装更新，免得开发版被正式版覆盖。
fn application_version() -> &'static str {
    option_env!("NYAEVENTLIST_VERSION").unwrap_or(concat!(env!("CARGO_PKG_VERSION"), "-dev"))
}

fn build_info() -> BuildInfo {
    BuildInfo {
        name: "NyaEventList".to_string(),
        version: application_version().to_string(),
        commit: option_env!("NYAEVENTLIST_COMMIT").unwrap_or_default().to_string(),
        build_date: option_env!("NYAEVENTLIST_BUILD_DATE").unwrap_or_default().to_string(),
        update_repository: option_env!("NYAEVENTLIST_UPDATE_REPOSITORY")
            .unwrap_or(DEFAULT_UPDATE_REPOSITORY)
            .to_string(),
    }
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    build_info()
}

#[tauri::command]
async fn check_for_updates() -> Result<updater::UpdateCheckResult, String> {
    let info = build_info();
    updater::check_for_updates(&info.version, &info.update_repository).await
}

#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let info = build_info();
    updater::download_and_install_update(&app, &info.version, &info.update_repository, &version).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_build_info, check_for_updates, download_and_install_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
