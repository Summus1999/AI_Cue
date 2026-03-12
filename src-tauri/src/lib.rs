// AI Cue - Tauri 库入口

mod audio;
mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::start_audio_recording,
            commands::stop_audio_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
