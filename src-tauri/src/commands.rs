// Tauri 命令 - 音频录制、语音识别和 AI 对话

use crate::qwen::ChatMessage;
use tauri::AppHandle;

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

// NLS 语音识别（通过 Rust 后端调用，绕过 CORS）
#[tauri::command]
pub async fn nls_recognize_speech(
    audio_data: Vec<u8>,
    access_key_id: String,
    access_key_secret: String,
    app_key: String,
    region: String,
) -> Result<String, String> {
    crate::nls::recognize_speech(
        audio_data,
        &access_key_id,
        &access_key_secret,
        &app_key,
        &region,
    )
    .await
}

// 千问 AI 对话（通过 Rust 后端调用 DashScope API）
#[tauri::command]
pub async fn qwen_chat(
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    crate::qwen::chat(&api_key, &model, messages).await
}

// 千问 AI 流式对话（通过 Tauri Event 发送 chunk）
#[tauri::command]
pub async fn qwen_chat_stream(
    app: AppHandle,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    crate::qwen::chat_stream(app, &api_key, &model, messages).await
}

// 千问视觉 API 流式对话（截图识别，固定使用 qwen-vl-max）
#[tauri::command]
pub async fn qwen_chat_stream_vision(
    app: AppHandle,
    api_key: String,
    image_base64: String,
    prompt: String,
    repo_urls: Vec<String>,
    local_doc_path: Option<String>,
) -> Result<(), String> {
    crate::qwen::chat_stream_vision(
        app,
        &api_key,
        &image_base64,
        &prompt,
        repo_urls,
        local_doc_path,
    )
    .await
}
