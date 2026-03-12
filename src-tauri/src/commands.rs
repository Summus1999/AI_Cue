// Tauri 命令 - 音频录制

// 开始录音
#[tauri::command]
pub fn start_audio_recording() -> Result<(), String> {
    crate::audio::start_recording()
}

// 停止录音并返回 WAV 数据
#[tauri::command]
pub fn stop_audio_recording() -> Result<Vec<u8>, String> {
    crate::audio::stop_recording()
}
