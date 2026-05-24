// AI Cue - Tauri 库入口

use std::sync::Arc;
use tauri::Manager;

mod ai;
mod audio;
mod commands;
mod database;
mod export;
mod logging; // 日志系统
mod nls;
mod perf; // 性能埋点
mod qwen;
pub mod rag;
mod review;
mod screenshot;
mod startup; // 启动管理
mod tts; // TTS 语音合成
mod capture_detection; // 屏幕捕获检测

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 记录后端启动开始
            let _setup_timer = perf::perf_setup_start();

            // 创建启动管理器
            let startup_manager = startup::StartupManager::new();
            app.manage(Arc::new(startup_manager.clone()));

            // ========== 第一层：强依赖初始化 ==========
            // 日志、数据库、Provider 注册表必须在首屏前完成
            let _layer1_timer = perf::perf_layer1_start();
            startup_manager.set_stage(startup::StartupStage::Layer1StrongDeps);

            // 初始化日志系统
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            let log_dir = app_data_dir.join("logs");
            let log_config = logging::LogConfig {
                log_dir,
                level: logging::LogLevel::Info,
                console_output: cfg!(debug_assertions),
                json_format: false,
            };
            let _log_guard = logging::init_logging(log_config).expect("日志系统初始化失败");
            perf::perf_logging_done();

            tracing::info!(
                app_version = env!("CARGO_PKG_VERSION"),
                "AI Cue 应用启动 - 第一层初始化中"
            );

            // 初始化数据库
            let db = database::init_database(&app_data_dir).expect("数据库初始化失败");
            let db_arc = Arc::new(db);
            app.manage(db_arc.clone());
            perf::perf_database_done();

            // 初始化 RAG 引擎
            let rag_engine = rag::RagEngine::new(db_arc);
            app.manage(Arc::new(rag_engine));
            app.manage(Arc::new(rag::KnowledgeBaseImportTaskRegistry::new()));

            // 初始化 Provider 注册表（内置 Provider）
            perf::perf_provider_registry_ready();
            let registry = ai::ProviderRegistry::new();
            app.manage(registry.clone());
            app.manage(ai::cancellation::StreamCancellationRegistry::new());

            // 第一层完成
            drop(_layer1_timer);
            perf::perf_layer1_done();
            startup_manager.set_stage(startup::StartupStage::Layer1Done);

            tracing::info!(
                stage = "layer1_done",
                "第一层强依赖初始化完成，应用可呈现首屏"
            );

            // ========== 第二层：早期异步初始化 ==========
            // 动态 Provider 加载不阻塞首屏，在后台异步完成
            let startup_mgr = startup_manager.clone();
            let registry_for_async = registry.clone();
            let app_data_for_async = app_data_dir.clone();

            // 在后台线程异步加载动态 Provider
            std::thread::spawn(move || {
                let async_timer = perf::perf_layer2_start();
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| tracing::error!("创建异步 runtime 失败: {}", e))
                    .and_then(|rt| {
                        rt.block_on(async {
                            // 同步调用，不需要 await
                            startup_mgr.set_stage(startup::StartupStage::Layer2EarlyAsync);
                            startup_mgr
                                .set_provider_load_state(startup::ProviderLoadState::Loading);

                            // 加载动态 Provider
                            let loader = ai::loader::ProviderLoader::new(&app_data_for_async);
                            match loader.load_all() {
                                Ok(descriptors) => {
                                    let total_count = descriptors.len();
                                    let mut failures = 0;
                                    for descriptor in descriptors {
                                        if let Err(e) =
                                            registry_for_async.register_dynamic(descriptor)
                                        {
                                            tracing::warn!(error = %e, "动态 Provider 注册失败");
                                            failures += 1;
                                        }
                                    }

                                    if failures > 0 {
                                        tracing::warn!(
                                            total = total_count,
                                            failures = failures,
                                            "部分动态 Provider 加载失败，切换到降级状态"
                                        );
                                        startup_mgr.set_provider_load_state(
                                            startup::ProviderLoadState::Degraded,
                                        );
                                    } else {
                                        tracing::info!(
                                            count = total_count,
                                            "动态 Provider 加载完成"
                                        );
                                        startup_mgr.set_provider_load_state(
                                            startup::ProviderLoadState::Ready,
                                        );
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        error = %e,
                                        "动态 Provider 加载失败，切换到降级状态"
                                    );
                                    startup_mgr.set_provider_load_state(
                                        startup::ProviderLoadState::Degraded,
                                    );
                                }
                            }

                            drop(async_timer);
                            perf::perf_layer2_done();
                            startup_mgr.set_stage(startup::StartupStage::Layer2Done);
                        });
                        Ok(rt)
                    });
            });

            // 记录后端启动完成（第一层完成即可，不等待第二层）
            drop(_setup_timer);

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
            commands::ai_cancel_stream,
            commands::ai_test_connection,
            commands::ai_list_providers,
            // 网络健康检查命令（新增）
            commands::check_network_health,
            commands::batch_health_check,
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
            screenshot::capture_with_preview,
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
            commands::list_review_reports,
            commands::delete_review,
            // 动态 Provider 和插件管理命令
            commands::ai_register_provider,
            commands::ai_unregister_provider,
            commands::ai_chat_stream_dynamic,
            commands::ai_test_connection_dynamic,
            // 日志命令
            commands::export_logs,
            commands::log_from_frontend,
            // RAG 命令
            commands::rag_search,
            commands::rag_embed_message,
            commands::rag_parse_document,
            commands::rag_chunk_document,
            commands::rag_get_context,
            commands::rag_retrieve_with_citations,
            commands::rag_stats,
            commands::rag_configure,
            commands::rag_delete_vectors,
            commands::rag_import_knowledge_document,
            commands::rag_reindex_knowledge_document,
            commands::rag_reindex_knowledge_base,
            commands::rag_retry_knowledge_base_documents,
            commands::rag_list_knowledge_import_tasks,
            commands::rag_get_knowledge_import_task,
            commands::rag_create_knowledge_base,
            commands::rag_list_knowledge_bases,
            commands::rag_get_knowledge_base_stats,
            commands::rag_recover_stuck_knowledge_documents,
            commands::rag_delete_knowledge_base,
            commands::rag_list_knowledge_documents,
            commands::rag_get_knowledge_document,
            commands::rag_list_knowledge_document_chunks,
            commands::rag_delete_knowledge_document,
            // 窗口控制命令
            commands::set_window_skip_taskbar,
            commands::set_window_always_on_top,
            // TTS 语音合成命令
            commands::tts_speak,
            commands::tts_stop,
            // 屏幕捕获检测 & 隐身控制命令
            commands::check_capture_status,
            commands::set_content_protection,
            commands::set_stealth_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
