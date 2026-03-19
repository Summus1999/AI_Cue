// AI Cue - Tauri 库入口

use tauri::Manager;

mod audio;
mod commands;
mod database;
mod nls;
mod qwen;
mod screenshot;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 初始化数据库
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            let db = database::init_database(&app_data_dir)
                .expect("数据库初始化失败");
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_audio_recording,
            commands::stop_audio_recording,
            commands::nls_recognize_speech,
            commands::qwen_chat,
            commands::qwen_chat_stream,
            commands::qwen_chat_stream_vision,
            commands::create_session,
            commands::list_sessions,
            commands::get_session_messages,
            commands::save_message,
            commands::update_session_title,
            commands::delete_session,
            commands::search_sessions,
            commands::get_last_active_session,
            screenshot::capture_full_screen,
            screenshot::crop_screenshot,
            screenshot::cancel_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
