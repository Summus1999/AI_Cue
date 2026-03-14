// AI Cue - Tauri 库入口

mod audio;
mod commands;
mod nls;
mod qwen;
mod screenshot;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::start_audio_recording,
            commands::stop_audio_recording,
            commands::nls_recognize_speech,
            commands::qwen_chat,
            commands::qwen_chat_stream,
            commands::qwen_chat_stream_vision,
            screenshot::capture_full_screen,
            screenshot::crop_screenshot,
            screenshot::cancel_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
