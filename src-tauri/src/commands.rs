// Tauri 命令 - 音频录制、语音识别、AI 对话和数据库操作

use crate::ai::{ProviderRegistry, ProviderType, types::ProviderConfig};
use crate::export::{ExportData, ExportInterviewContext, ExportMessage, ExportMetadata, ExportOptions, ExportResult};
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
pub fn create_session(
    db: tauri::State<'_, crate::database::Database>,
    metadata: Option<crate::database::SessionMetadata>
) -> Result<serde_json::Value, String> {
    crate::database::create_session(&db, metadata)
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

// ==================== 导出命令（新增）====================

/// 导出会话
#[tauri::command]
pub async fn export_session(
    db: State<'_, crate::database::Database>,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    // 获取会话数据
    let sessions = crate::database::list_sessions(&db)?;
    let session = sessions
        .into_iter()
        .find(|s| s.get("id").and_then(|id| id.as_str()) == Some(&options.session_id))
        .ok_or_else(|| "会话不存在".to_string())?;

    // 获取消息列表
    let messages = crate::database::get_session_messages(&db, &options.session_id)?;

    // 过滤选中的消息
    let filtered_messages: Vec<serde_json::Value> = match &options.selected_message_ids {
        Some(ids) => messages
            .into_iter()
            .filter(|m| {
                m.get("id")
                    .and_then(|id| id.as_str())
                    .map(|id| ids.contains(&id.to_string()))
                    .unwrap_or(false)
            })
            .collect(),
        None => messages,
    };

    // 构建导出元数据
    let interview_context = session
        .get("interview_context")
        .and_then(|v| serde_json::from_value::<ExportInterviewContext>(v.clone()).ok());

    let metadata = ExportMetadata {
        session_id: options.session_id.clone(),
        session_title: session
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("未命名会话")
            .to_string(),
        exported_at: chrono::Utc::now().timestamp_millis(),
        export_format: options.format.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: session
            .get("created_at")
            .and_then(|t| t.as_i64())
            .unwrap_or(0),
        updated_at: session
            .get("updated_at")
            .and_then(|t| t.as_i64())
            .unwrap_or(0),
        message_count: filtered_messages.len(),
        provider: session
            .get("provider")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string()),
        model: session
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string()),
        prompt_template_id: session
            .get("prompt_template_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string()),
        prompt_template_name: session
            .get("prompt_template_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string()),
        prompt_content: session
            .get("prompt_content")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string()),
        interview_context,
    };

    // 构建导出消息列表
    let export_messages: Vec<ExportMessage> = filtered_messages
        .into_iter()
        .map(|m| ExportMessage {
            id: m
                .get("id")
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string(),
            role: m
                .get("role")
                .and_then(|r| r.as_str())
                .unwrap_or("user")
                .to_string(),
            content: m
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string(),
            timestamp: m
                .get("created_at")
                .and_then(|t| t.as_i64())
                .unwrap_or(0),
            has_image: m.get("image").is_some(),
            image_data: m
                .get("image")
                .and_then(|img| img.as_str())
                .map(|s| s.to_string()),
        })
        .collect();

    let export_data = ExportData {
        metadata,
        messages: export_messages,
    };

    // 根据格式导出
    let content = match options.format.as_str() {
        "markdown" => crate::export::export_to_markdown(&export_data, &options),
        "json" => crate::export::export_to_json(&export_data, &options),
        "pdf" => crate::export::export_to_pdf_html(&export_data, &options),
        _ => return Err("不支持的导出格式".to_string()),
    };

    Ok(ExportResult {
        success: true,
        file_path: None,
        file_size: Some(content.len() as u64),
        error: None,
        content: Some(content),
    })
}

/// 写入文本文件
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    // 安全检查：确保路径在允许的范围内
    validate_path(&path)?;

    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 写入二进制文件
#[tauri::command]
pub async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    validate_path(&path)?;

    // 确保父目录存在
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    std::fs::write(&path, data).map_err(|e| format!("写入文件失败: {}", e))
}

/// 在文件管理器中显示文件
#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(
                std::path::Path::new(&path)
                    .parent()
                    .unwrap_or(std::path::Path::new(".")),
            )
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    Ok(())
}

/// 用系统默认程序打开文件
#[tauri::command]
pub async fn open_file_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }

    Ok(())
}

/// 删除文件
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    validate_path(&path)?;
    std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))
}

/// 将 HTML 转换为 PDF（利用 Edge 浏览器的 headless 模式）
#[tauri::command]
pub async fn convert_html_to_pdf(html_path: String, pdf_path: String) -> Result<(), String> {
    use std::process::Command;
    
    // 尝试找到 Edge 浏览器路径
    let edge_paths = vec![
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    
    let edge_path = edge_paths.iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or_else(|| "未找到 Microsoft Edge 浏览器，无法生成 PDF".to_string())?;
    
    // 将 Windows 路径转为 file:// URL
    let html_url = format!("file:///{}", html_path.replace('\\', "/"));
    
    let output = Command::new(edge_path)
        .args([
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--run-all-compositor-stages-before-draw",
            "--no-pdf-header-footer",
            &format!("--print-to-pdf={}", pdf_path),
            &html_url,
        ])
        .output()
        .map_err(|e| format!("启动 Edge 浏览器失败: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PDF 转换失败: {}", stderr));
    }
    
    // 验证 PDF 文件是否生成成功
    if !std::path::Path::new(&pdf_path).exists() {
        return Err("PDF 文件生成失败，请检查 Edge 浏览器是否正常".to_string());
    }
    
    Ok(())
}

/// 路径安全校验
fn validate_path(path: &str) -> Result<(), String> {
    let path = std::path::Path::new(path);

    // 检查是否包含危险字符
    if path.to_string_lossy().contains("..") {
        return Err("路径不能包含 '..'".to_string());
    }

    // 检查是否是绝对路径
    if !path.is_absolute() {
        return Err("必须使用绝对路径".to_string());
    }

    Ok(())
}
