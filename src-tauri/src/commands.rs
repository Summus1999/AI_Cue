// Tauri 命令 - 音频录制、语音识别、AI 对话和数据库操作

use crate::ai::{ProviderRegistry, ProviderType, types::ProviderConfig};
use crate::qwen::ChatMessage;
use tauri::{AppHandle, State};

// ==================== 音频命令 ====================

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

// ==================== 统一 AI 命令（新增）====================

/// 统一流式聊天命令
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
    model: String,
    messages: Vec<crate::ai::types::ChatMessage>,
) -> Result<(), String> {
    registry
        .chat_stream(app, &provider, &config, &model, messages)
        .await
        .map_err(|e| e.to_string())
}

/// 统一非流式聊天命令
#[tauri::command]
pub async fn ai_chat(
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
    model: String,
    messages: Vec<crate::ai::types::ChatMessage>,
) -> Result<String, String> {
    registry
        .chat(&provider, &config, &model, messages)
        .await
        .map_err(|e| e.to_string())
}

/// 连通性测试命令
#[tauri::command]
pub async fn ai_test_connection(
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
) -> Result<crate::ai::types::ConnectionTestResult, String> {
    registry
        .test_connection(&provider, &config)
        .await
        .map_err(|e| e.to_string())
}

/// 获取可用 Provider 列表
#[tauri::command]
pub fn ai_list_providers(
    registry: State<'_, ProviderRegistry>,
) -> Vec<crate::ai::types::ProviderMeta> {
    registry.list_providers()
}

// ==================== 向下兼容：保留原有千问命令（已弃用）====================

/// 千问 AI 对话（已弃用，请使用 ai_chat）
#[deprecated(since = "0.2.0", note = "请使用 ai_chat 命令")]
#[tauri::command]
pub async fn qwen_chat(
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    crate::qwen::chat(&api_key, &model, messages).await
}

/// 千问 AI 流式对话（已弃用，请使用 ai_chat_stream）
#[deprecated(since = "0.2.0", note = "请使用 ai_chat_stream 命令")]
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
// 注意：截图视觉功能仍使用千问专用逻辑
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

// ==================== 数据库命令 ====================

// 创建新会话
#[tauri::command]
pub fn create_session(db: tauri::State<'_, crate::database::Database>) -> Result<serde_json::Value, String> {
    crate::database::create_session(&db)
}

// 列出所有会话
#[tauri::command]
pub fn list_sessions(db: tauri::State<'_, crate::database::Database>) -> Result<Vec<serde_json::Value>, String> {
    crate::database::list_sessions(&db)
}

// 获取会话的所有消息
#[tauri::command]
pub fn get_session_messages(db: tauri::State<'_, crate::database::Database>, session_id: String) -> Result<Vec<serde_json::Value>, String> {
    crate::database::get_session_messages(&db, &session_id)
}

// 保存消息
#[tauri::command]
pub fn save_message(db: tauri::State<'_, crate::database::Database>, session_id: String, role: String, content: String, image: Option<String>) -> Result<serde_json::Value, String> {
    crate::database::save_message(&db, &session_id, &role, &content, image.as_deref())
}

// 更新会话标题
#[tauri::command]
pub fn update_session_title(db: tauri::State<'_, crate::database::Database>, session_id: String, title: String) -> Result<(), String> {
    crate::database::update_session_title(&db, &session_id, &title)
}

// 删除会话
#[tauri::command]
pub fn delete_session(db: tauri::State<'_, crate::database::Database>, session_id: String) -> Result<(), String> {
    crate::database::delete_session(&db, &session_id)
}

// 搜索会话
#[tauri::command]
pub fn search_sessions(db: tauri::State<'_, crate::database::Database>, keyword: String) -> Result<Vec<serde_json::Value>, String> {
    crate::database::search_sessions(&db, &keyword)
}

// 获取最近活跃的会话
#[tauri::command]
pub fn get_last_active_session(db: tauri::State<'_, crate::database::Database>) -> Result<Option<serde_json::Value>, String> {
    crate::database::get_last_active_session(&db)
}
