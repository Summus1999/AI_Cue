// AI Cue - Tauri 库入口

mod audio;
mod commands;
mod nls;
mod qwen;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::start_audio_recording,
            commands::stop_audio_recording,
            commands::nls_recognize_speech,
            commands::qwen_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
