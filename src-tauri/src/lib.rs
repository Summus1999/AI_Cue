// AI Cue - Tauri 库入口

use tauri::Manager;

mod ai;
mod audio;
mod commands;
mod database;
mod export;
mod logging;  // 日志系统
mod nls;
mod qwen;
mod review;
mod screenshot;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 初始化日志系统
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            let log_dir = app_data_dir.join("logs");
            let log_config = logging::LogConfig {
                log_dir,
                level: logging::LogLevel::Info,
                console_output: cfg!(debug_assertions),
                json_format: false,
            };
            let _log_guard = logging::init_logging(log_config)
                .expect("日志系统初始化失败");

            tracing::info!(
                app_version = env!("CARGO_PKG_VERSION"),
                "AI Cue 应用启动"
            );

            // 初始化数据库
            let db = database::init_database(&app_data_dir)
                .expect("数据库初始化失败");
            app.manage(db);

            // 初始化 Provider 注册表
            let registry = ai::ProviderRegistry::new();

            // 加载配置文件中的动态 Provider
            let loader = ai::loader::ProviderLoader::new(&app_data_dir);
            if let Ok(descriptors) = loader.load_all() {
                for descriptor in descriptors {
                    if let Err(e) = registry.register_dynamic(descriptor) {
                        tracing::warn!(error = %e, "动态 Provider 注册失败");
                    }
                }
            }

            app.manage(registry);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 音频命令
            commands::start_audio_recording,
            commands::start_audio_recording_with_events,
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
            commands::end_interview,
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
            // 复盘命令（新增）
            commands::start_review,
            commands::get_review_report,
            commands::get_review_trend,
            commands::delete_review,
            // 动态 Provider 和插件管理命令
            commands::ai_register_provider,
            commands::ai_unregister_provider,
            commands::ai_chat_stream_dynamic,
            commands::ai_test_connection_dynamic,
            // 日志命令
            commands::export_logs,
            commands::log_from_frontend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
