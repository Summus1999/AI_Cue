// AI Cue - Tauri 库入口

use tauri::Manager;

mod ai;
mod audio;
mod commands;
mod database;
mod export;
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
            
            // 初始化 Provider 注册表
            app.manage(ai::ProviderRegistry::new());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 音频命令
            commands::start_audio_recording,
            commands::stop_audio_recording,
            commands::nls_recognize_speech,
            // 统一 AI 命令（新增）
            commands::ai_chat,
            commands::ai_chat_stream,
            commands::ai_test_connection,
            commands::ai_list_providers,
            // 网络健康检查命令（新增）
            commands::check_network_health,
            // 向下兼容：保留原有千问命令
            commands::qwen_chat,
            commands::qwen_chat_stream,
            commands::qwen_chat_stream_vision,
            // 数据库命令
            commands::create_session,
            commands::list_sessions,
            commands::get_session_messages,
            commands::save_message,
            commands::update_session_title,
            commands::delete_session,
            commands::search_sessions,
            commands::get_last_active_session,
            // 截图命令
            screenshot::capture_full_screen,
            screenshot::crop_screenshot,
            screenshot::cancel_screenshot,
            // 导出命令（新增）
            commands::export_session,
            commands::write_text_file,
            commands::write_binary_file,
            commands::show_in_folder,
            commands::open_file_with_default_app,
            commands::delete_file,
            commands::convert_html_to_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
