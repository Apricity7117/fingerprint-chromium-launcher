pub mod chromium;
pub mod commands;
pub mod config;
pub mod fingerprint;
pub mod fsutil;
pub mod models;
pub mod preferences;
pub mod process;
pub mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            log::info!("应用数据目录: {}", data_dir.display());
            app.manage(commands::AppState::new(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::get_chromium_info,
            commands::list_profiles,
            commands::create_profile,
            commands::update_profile,
            commands::duplicate_profile,
            commands::delete_profiles,
            commands::recommend_fingerprint,
            commands::preview_command,
            commands::launch_profile,
            commands::stop_profile,
            commands::get_running_status,
            commands::import_legacy_data,
        ])
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}
