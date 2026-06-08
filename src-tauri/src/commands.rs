// Tauri 命令 - 音频录制、语音识别、AI 对话和数据库操作

use crate::ai::{
    types::{NetworkHealthStatus, ProviderConfig, ProviderDescriptor},
    BuiltinProviderType, ProviderRegistry,
};
use crate::export::{
    ExportData, ExportInterviewContext, ExportMessage, ExportMetadata, ExportOptions, ExportResult,
};
use crate::logging::sanitize_log_value;
use crate::qwen::ChatMessage;
use chrono::Utc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::timeout;

// ==================== 批量健康检查类型 ====================

// 批量健康检查 — 输入
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckCandidate {
    pub id: String,
    pub provider_type: String,
    pub base_url: Option<String>,
    #[allow(dead_code)]
    pub api_key: Option<String>, // 保留字段用于未来认证探测，当前 HEAD 请求不发送
}

// 批量健康检查 — 单个结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateHealthStatus {
    pub id: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub error_detail: Option<String>,
}

// 批量健康检查 — 输出
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchHealthCheckResult {
    pub results: Vec<CandidateHealthStatus>,
}

// ==================== 音频命令 ====================

// 开始录音
// audio_source: "system" (loopback, 默认) | "microphone" (麦克风)
#[tauri::command]
pub fn start_audio_recording(audio_source: Option<String>) -> Result<(), String> {
    crate::audio::start_recording_with_source(audio_source.as_deref())
}

// 开始录音（带 AppHandle，用于波形可视化事件发射）
#[tauri::command]
pub fn start_audio_recording_with_events(
    app_handle: AppHandle,
    audio_source: Option<String>,
) -> Result<(), String> {
    crate::audio::start_recording_with_source_and_handle(audio_source.as_deref(), Some(app_handle))
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
    cancel_registry: State<'_, crate::ai::cancellation::StreamCancellationRegistry>,
    provider: BuiltinProviderType,
    config: ProviderConfig,
    model: String,
    messages: Vec<crate::ai::types::ChatMessage>,
    request_id: String,
) -> Result<bool, String> {
    let event_name = format!("ai-stream:{}", request_id);
    let cancel_rx = cancel_registry.register(&request_id);

    let result = registry
        .chat_stream(
            app,
            &provider,
            &config,
            &model,
            messages,
            &event_name,
            cancel_rx,
        )
        .await
        .map_err(|e| e.to_string());

    cancel_registry.remove(&request_id);
    result
}

#[tauri::command]
pub fn ai_cancel_stream(
    cancel_registry: State<'_, crate::ai::cancellation::StreamCancellationRegistry>,
    request_id: String,
) -> Result<bool, String> {
    Ok(cancel_registry.cancel(&request_id))
}

/// 统一非流式聊天命令
#[tauri::command]
pub async fn ai_chat(
    registry: State<'_, ProviderRegistry>,
    provider: BuiltinProviderType,
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
    provider: BuiltinProviderType,
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

/// 实时抽取 assistant 模式问答记忆。
/// 该命令只服务后台增强链路，失败会由前端吞掉，不阻塞主聊天。
#[tauri::command]
pub async fn memory_extract_from_assistant_turn(
    db: State<'_, Arc<crate::database::Database>>,
    registry: State<'_, ProviderRegistry>,
    request: crate::memory::AssistantTurnMemoryExtractionRequest,
) -> Result<crate::memory::AssistantTurnMemoryExtractionSummary, String> {
    crate::memory::extract_assistant_turn_memories(&db, &registry, request).await
}

/// 综合记忆维护：先执行衰减归档陈旧记忆，再检查是否达到反思阈值并生成画像记忆。
/// 建议在每次实时抽取完成后或定期调用，保持记忆池健康。
#[tauri::command]
pub async fn memory_run_maintenance(
    db: State<'_, Arc<crate::database::Database>>,
    registry: State<'_, ProviderRegistry>,
    request: crate::memory::MemoryMaintenanceRequest,
) -> Result<crate::memory::MemoryMaintenanceSummary, String> {
    crate::memory::run_memory_maintenance(&db, &registry, request).await
}

/// 网络健康检查命令
/// 检测互联网连通性和 Provider API 可达性
#[tauri::command]
pub async fn check_network_health(
    provider_type: String,
    base_url: Option<String>,
) -> Result<NetworkHealthStatus, String> {
    let start = Instant::now();

    // 1. 确定检测目标 URL
    let target_url = base_url.unwrap_or_else(|| match provider_type.as_str() {
        "qwen" => "https://dashscope.aliyuncs.com".to_string(),
        "openai_compat" => "https://api.openai.com".to_string(),
        "claude" => "https://api.anthropic.com".to_string(),
        _ => "https://www.google.com".to_string(),
    });

    // 2. 创建 HTTP 客户端
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // 3. HEAD 请求检测 Provider 可达性（不带 API Key，仅检测网络层）
    let internet_check = timeout(Duration::from_secs(5), client.head(&target_url).send()).await;

    let latency = start.elapsed().as_millis().min(u64::MAX as u128) as u64;
    let now = Utc::now().to_rfc3339();

    match internet_check {
        Ok(Ok(response)) => {
            // 精确的状态码判断逻辑
            // 注意：能收到任何 HTTP 响应都说明网络和服务都是通的
            let provider_reachable = match response.status().as_u16() {
                200..=299 => true,  // 2xx 成功
                300..=399 => true,  // 3xx 重定向（服务可达）
                400 | 404 => true,  // 400/404 说明服务可达，只是根路径无资源
                401 | 403 => true,  // 认证失败但服务可达
                429 => true,        // 频率限制但服务可达
                500..=599 => false, // 服务端错误，服务有问题
                _ => true,          // 其他状态码也说明服务可达
            };
            Ok(NetworkHealthStatus {
                internet_connected: true,
                provider_reachable,
                latency_ms: Some(latency),
                last_check: now,
                error_detail: if !provider_reachable {
                    Some(format!("HTTP {}", response.status()))
                } else {
                    None
                },
            })
        }
        Ok(Err(e)) => {
            // 网络错误
            Ok(NetworkHealthStatus {
                internet_connected: false,
                provider_reachable: false,
                latency_ms: None,
                last_check: now,
                error_detail: Some(e.to_string()),
            })
        }
        Err(_) => {
            // 超时
            Ok(NetworkHealthStatus {
                internet_connected: false,
                provider_reachable: false,
                latency_ms: None,
                last_check: now,
                error_detail: Some("连接超时".to_string()),
            })
        }
    }
}

/// 批量探测多个 Provider 的网络可达性和延迟
/// 并行发起 HEAD 请求，每个候选独立超时
#[tauri::command]
pub async fn batch_health_check(
    candidates: Vec<HealthCheckCandidate>,
    timeout_ms: u64,
) -> Result<BatchHealthCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    // 并行探测所有候选
    let futures: Vec<_> = candidates
        .into_iter()
        .map(|c| {
            let client = client.clone();
            let timeout_dur = Duration::from_millis(timeout_ms);
            async move {
                let start = Instant::now();
                let target_url = c.base_url.unwrap_or_else(|| {
                    match c.provider_type.as_str() {
                        "qwen" => "https://dashscope.aliyuncs.com".to_string(),
                        "openai_compat" => "https://api.openai.com".to_string(),
                        "claude" => "https://api.anthropic.com".to_string(),
                        _ => "https://www.google.com".to_string(),
                    }
                });

                let result = timeout(timeout_dur, client.head(&target_url).send()).await;
                let latency = start.elapsed().as_millis().min(u64::MAX as u128) as u64;

                match result {
                    Ok(Ok(response)) => {
                        let status = response.status().as_u16();
                        // 200-499 视为可达（与 check_network_health 逻辑一致）
                        let reachable = !(500..=599).contains(&status);
                        CandidateHealthStatus {
                            id: c.id,
                            reachable,
                            latency_ms: Some(latency),
                            error_detail: if reachable {
                                None
                            } else {
                                Some(format!("HTTP {}", status))
                            },
                        }
                    }
                    _ => CandidateHealthStatus {
                        id: c.id,
                        reachable: false,
                        latency_ms: None,
                        error_detail: Some("连接超时或网络不可达".to_string()),
                    },
                }
            }
        })
        .collect();

    let results = futures_util::future::join_all(futures).await;

    Ok(BatchHealthCheckResult { results })
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
    cancel_registry: State<'_, crate::ai::cancellation::StreamCancellationRegistry>,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    request_id: String,
) -> Result<(), String> {
    let event_name = format!("qwen-stream:{}", request_id);
    let cancel_rx = cancel_registry.register(&request_id);

    let result =
        crate::qwen::chat_stream(app, &api_key, &model, messages, &event_name, cancel_rx).await;
    cancel_registry.remove(&request_id);
    result
}

// 千问视觉 API 流式对话（截图识别，固定使用 qwen-vl-max）
// 注意：截图视觉功能仍使用千问专用逻辑
#[tauri::command]
pub async fn qwen_chat_stream_vision(
    app: AppHandle,
    cancel_registry: State<'_, crate::ai::cancellation::StreamCancellationRegistry>,
    api_key: String,
    image_base64: String,
    prompt: String,
    repo_urls: Vec<String>,
    local_doc_path: Option<String>,
    request_id: String,
) -> Result<(), String> {
    let event_name = format!("qwen-stream:{}", request_id);
    let cancel_rx = cancel_registry.register(&request_id);

    let result = crate::qwen::chat_stream_vision(
        app,
        &api_key,
        &image_base64,
        &prompt,
        repo_urls,
        local_doc_path,
        &event_name,
        cancel_rx,
    )
    .await;

    cancel_registry.remove(&request_id);
    result
}

// ==================== 数据库命令 ====================

// 创建新会话
#[tauri::command]
pub fn create_session(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    metadata: Option<crate::database::SessionMetadata>,
) -> Result<serde_json::Value, String> {
    crate::database::create_session(&db, metadata)
}

// 列出所有会话（支持按 prompt_mode 筛选）
#[tauri::command]
pub fn list_sessions(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    prompt_mode: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::database::list_sessions(&db, prompt_mode.as_deref())
}

// 获取会话的所有消息
#[tauri::command]
pub fn get_session_messages(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    crate::database::get_session_messages(&db, &session_id)
}

// 保存消息
#[tauri::command]
pub fn save_message(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    session_id: String,
    role: String,
    content: String,
    image: Option<String>,
) -> Result<serde_json::Value, String> {
    crate::database::save_message(&db, &session_id, &role, &content, image.as_deref())
}

// 更新会话标题
#[tauri::command]
pub fn update_session_title(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    crate::database::update_session_title(&db, &session_id, &title)
}

// 删除会话
#[tauri::command]
pub fn delete_session(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    session_id: String,
) -> Result<(), String> {
    crate::database::delete_session(&db, &session_id)
}

// 搜索会话（支持按 prompt_mode 筛选）
#[tauri::command]
pub fn search_sessions(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    keyword: String,
    prompt_mode: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::database::search_sessions(&db, &keyword, prompt_mode.as_deref())
}

// 获取最近活跃的会话（支持按 prompt_mode 筛选）
#[tauri::command]
pub fn get_last_active_session(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    prompt_mode: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    crate::database::get_last_active_session(&db, prompt_mode.as_deref())
}

// 结束面试（写入 completed_at 时间戳）
#[tauri::command]
pub fn end_interview(
    db: tauri::State<'_, Arc<crate::database::Database>>,
    session_id: String,
) -> Result<i64, String> {
    let completed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    crate::database::update_completed_at(&db, &session_id, completed_at)?;
    Ok(completed_at)
}

// ==================== 导出命令（新增）====================

/// 导出会话
#[tauri::command]
pub async fn export_session(
    db: State<'_, Arc<crate::database::Database>>,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    // 获取会话数据
    let sessions = crate::database::list_sessions(&db, None)?;
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
            timestamp: m.get("created_at").and_then(|t| t.as_i64()).unwrap_or(0),
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
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
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

    let edge_path = edge_paths
        .iter()
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

// ==================== 复盘命令（新增）====================

/// 启动复盘 - 编排评分和分析流程
#[tauri::command]
pub async fn start_review(
    app: AppHandle,
    db: State<'_, Arc<crate::database::Database>>,
    providers: State<'_, crate::ai::ProviderRegistry>,
    session_id: String,
    provider: String,
    config: crate::ai::types::ProviderConfig,
    model: String,
) -> Result<(), String> {
    use crate::review::types::{ReviewPhase, ReviewProgress};
    use tauri::Emitter;

    // 1. 更新 review_status 为 "in_progress"
    crate::database::update_review_status(&db, &session_id, "in_progress")?;

    // 2. 获取 interview_context
    let interview_context = get_interview_context(&db, &session_id)?;

    // 3. 调用 scorer::score_session_messages() 获取评分
    let message_scores = match crate::review::scorer::score_session_messages(
        &app,
        &db,
        &providers,
        &session_id,
        &provider,
        &config,
        &model,
        interview_context.as_deref(),
    )
    .await
    {
        Ok(scores) => scores,
        Err(e) => {
            // 重置状态并推送失败事件
            let _ = reset_review_status(&db, &session_id);
            let _ = app.emit(
                "review-progress",
                ReviewProgress {
                    phase: ReviewPhase::Failed,
                    current: 0,
                    total: 0,
                    message: format!("评分失败: {}", e),
                },
            );
            return Err(e);
        }
    };

    // 4. 准备 messages 列表（配对 question + answer）给 analyzer
    let messages_json = crate::database::get_session_messages(&db, &session_id)?;
    let qa_messages = extract_qa_messages(&messages_json);

    // 5. 调用 analyzer::analyze_session() 获取洞察
    let _insights = match crate::review::analyzer::analyze_session(
        &app,
        &db,
        &providers,
        &session_id,
        &provider,
        &config,
        &model,
        &message_scores,
        &qa_messages,
    )
    .await
    {
        Ok(insights) => insights,
        Err(e) => {
            // 重置状态并推送失败事件
            let _ = reset_review_status(&db, &session_id);
            let _ = app.emit(
                "review-progress",
                ReviewProgress {
                    phase: ReviewPhase::Failed,
                    current: 0,
                    total: 0,
                    message: format!("分析失败: {}", e),
                },
            );
            return Err(e);
        }
    };

    // 6. 计算总体评分（所有 message_scores 的 overall_score 平均值）
    let overall_score = if message_scores.is_empty() {
        0.0
    } else {
        let sum: f64 = message_scores.iter().map(|s| s.overall_score).sum();
        (sum / message_scores.len() as f64 * 100.0).round() / 100.0
    };

    // 7. 获取当前时间戳
    let completed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // 8. 更新 sessions 表：overall_score, review_status="completed", completed_at
    crate::database::update_overall_score(&db, &session_id, overall_score)?;
    crate::database::update_completed_at(&db, &session_id, completed_at)?;
    crate::database::update_review_status(&db, &session_id, "completed")?;

    // 9. 推送完成进度事件
    let _ = app.emit(
        "review-progress",
        ReviewProgress {
            phase: ReviewPhase::Completed,
            current: 1,
            total: 1,
            message: format!("复盘完成，综合评分: {:.1}", overall_score),
        },
    );

    Ok(())
}

/// 获取复盘报告
#[tauri::command]
pub async fn get_review_report(
    db: State<'_, Arc<crate::database::Database>>,
    session_id: String,
) -> Result<crate::review::types::ReviewReport, String> {
    crate::review::report::build_review_report(&db, &session_id)
}

/// 获取趋势对比数据
#[tauri::command]
pub async fn get_review_trend(
    db: State<'_, Arc<crate::database::Database>>,
) -> Result<crate::review::types::TrendData, String> {
    crate::review::trend::calculate_trend(&db)
}

/// 删除复盘数据
#[tauri::command]
pub async fn delete_review(
    db: State<'_, Arc<crate::database::Database>>,
    session_id: String,
) -> Result<(), String> {
    // 1. 删除 message_scores
    crate::database::delete_message_scores(&db, &session_id)?;

    // 2. 删除 session_insights
    crate::database::delete_session_insights(&db, &session_id)?;

    // 3. 重置 sessions 的 review_status 和 overall_score 为 NULL
    reset_review_status(&db, &session_id)?;

    Ok(())
}

/// 获取所有已完成复盘的会话列表
///
/// 用于复盘报告的历史列表展示。复用数据库层已有的 get_reviewed_sessions 查询，
/// 返回会话标题、评分、完成时间等摘要信息，前端按完成时间倒序展示。
#[tauri::command]
pub async fn list_review_reports(
    db: State<'_, Arc<crate::database::Database>>,
) -> Result<Vec<crate::database::ReviewedSession>, String> {
    crate::database::get_reviewed_sessions(&db)
}

/// 辅助函数：获取会话的 interview_context
fn get_interview_context(
    db: &crate::database::Database,
    session_id: &str,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT interview_context FROM sessions WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query(rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let ctx: Option<String> = row.get(0).map_err(|e| e.to_string())?;
        Ok(ctx)
    } else {
        Err(format!("会话不存在: {}", session_id))
    }
}

/// 辅助函数：重置复盘状态
fn reset_review_status(db: &crate::database::Database, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE sessions SET review_status = NULL, overall_score = NULL, completed_at = NULL WHERE id = ?1",
        rusqlite::params![session_id]
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// 辅助函数：从消息列表中提取 Q&A 对（用于 analyzer）
/// 返回 (message_id, question, answer) 元组列表
/// message_id 是 user 消息的 ID（评分对象）
/// question 是 assistant 消息（面试官提问）
/// answer 是 user 消息（应聘者回答）
fn extract_qa_messages(messages: &[serde_json::Value]) -> Vec<(String, String, String)> {
    let mut pairs = Vec::new();
    let mut i = 0;

    while i < messages.len() {
        let msg = &messages[i];
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");

        if role == "assistant" {
            // 找到 assistant 消息（面试官提问）
            let question = msg
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // 查找后续的 user 消息（应聘者回答）
            if i + 1 < messages.len() {
                let next_msg = &messages[i + 1];
                let next_role = next_msg.get("role").and_then(|v| v.as_str()).unwrap_or("");

                if next_role == "user" {
                    // message_id 是 user 消息的 ID（评分对象）
                    let message_id = next_msg
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let answer = next_msg
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    pairs.push((message_id, question, answer));
                    i += 2;
                    continue;
                }
            }
        }
        i += 1;
    }

    pairs
}

// ==================== 动态 Provider 和插件管理命令 ====================

/// 注册动态 Provider
#[tauri::command]
pub fn ai_register_provider(
    registry: State<'_, ProviderRegistry>,
    descriptor: ProviderDescriptor,
) -> Result<(), String> {
    registry.register_dynamic(descriptor)
}

/// 注销动态 Provider
#[tauri::command]
pub fn ai_unregister_provider(
    registry: State<'_, ProviderRegistry>,
    provider_id: String,
) -> Result<(), String> {
    registry.unregister_dynamic(&provider_id)
}

/// 动态 Provider 聊天（流式）
#[tauri::command]
pub async fn ai_chat_stream_dynamic(
    app: AppHandle,
    registry: State<'_, ProviderRegistry>,
    cancel_registry: State<'_, crate::ai::cancellation::StreamCancellationRegistry>,
    provider_id: String,
    config: ProviderConfig,
    model: String,
    messages: Vec<crate::ai::types::ChatMessage>,
    request_id: String,
) -> Result<bool, String> {
    let event_name = format!("ai-stream:{}", request_id);
    let cancel_rx = cancel_registry.register(&request_id);

    let result = registry
        .chat_stream_dynamic(
            app,
            &provider_id,
            &config,
            &model,
            messages,
            &event_name,
            cancel_rx,
        )
        .await
        .map_err(|e| e.to_string());

    cancel_registry.remove(&request_id);
    result
}

/// 动态 Provider 连通性测试
#[tauri::command]
pub async fn ai_test_connection_dynamic(
    registry: State<'_, ProviderRegistry>,
    provider_id: String,
    config: ProviderConfig,
) -> Result<crate::ai::types::ConnectionTestResult, String> {
    registry
        .test_connection_dynamic(&provider_id, &config)
        .await
        .map_err(|e| e.to_string())
}

// ==================== 日志命令 ====================

/// 日志导出结果
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExportResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub error: Option<String>,
}

/// 导出日志
#[tauri::command]
pub async fn export_logs(
    app: AppHandle,
    format: String, // "text" | "json"
    include_frontend: bool,
    frontend_logs: Option<String>,
) -> Result<LogExportResult, String> {
    use std::io::Write;

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("获取日志目录失败: {}", e))?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let extension = if format == "json" { "json" } else { "txt" };
    let export_path = log_dir.join(format!("ai-cue-export-{}.{}", timestamp, extension));

    // 读取后端日志
    let mut backend_logs = String::new();

    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "log").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    backend_logs.push_str(&format!("\n=== {} ===\n", path.display()));
                    backend_logs.push_str(&content);
                }
            }
        }
    }

    // 合并前端日志
    let combined = if include_frontend {
        if let Some(fe_logs) = frontend_logs {
            format!(
                "=== Frontend Logs ===\n{}\n\n=== Backend Logs ===\n{}",
                fe_logs, backend_logs
            )
        } else {
            backend_logs
        }
    } else {
        backend_logs
    };

    // 写入导出文件
    let mut file =
        std::fs::File::create(&export_path).map_err(|e| format!("创建日志文件失败: {}", e))?;

    file.write_all(combined.as_bytes())
        .map_err(|e| format!("写入日志文件失败: {}", e))?;

    let metadata =
        std::fs::metadata(&export_path).map_err(|e| format!("获取文件信息失败: {}", e))?;

    Ok(LogExportResult {
        success: true,
        file_path: Some(export_path.to_string_lossy().to_string()),
        file_size: Some(metadata.len()),
        error: None,
    })
}

/// 从前端接收日志
#[tauri::command]
pub fn log_from_frontend(level: String, module: String, message: String, data: Option<String>) {
    let sanitized_message = sanitize_log_value(&message);
    let sanitized_data = data.as_ref().map(|d| sanitize_log_value(d));

    match level.as_str() {
        "error" => tracing::error!(
            frontend = true,
            module = %module,
            data = %sanitized_data.as_deref().unwrap_or(""),
            "{}",
            sanitized_message
        ),
        "warn" => tracing::warn!(
            frontend = true,
            module = %module,
            data = %sanitized_data.as_deref().unwrap_or(""),
            "{}",
            sanitized_message
        ),
        "info" => tracing::info!(
            frontend = true,
            module = %module,
            data = %sanitized_data.as_deref().unwrap_or(""),
            "{}",
            sanitized_message
        ),
        "debug" => tracing::debug!(
            frontend = true,
            module = %module,
            data = %sanitized_data.as_deref().unwrap_or(""),
            "{}",
            sanitized_message
        ),
        _ => tracing::trace!(
            frontend = true,
            module = %module,
            data = %sanitized_data.as_deref().unwrap_or(""),
            "{}",
            sanitized_message
        ),
    }
}

// ==================== RAG 命令 ====================

use crate::rag::{
    chunk_document, create_default_ocr_engine, parse_document_with_ocr, ChunkConfig,
    CompletedKnowledgeBaseImport, CompletedKnowledgeBaseReindex, ContextConfig, DocumentChunk,
    EmbeddingProviderConfig, KnowledgeBaseImportProgress, KnowledgeBaseImportProgressCallback,
    KnowledgeBaseImportRequest, KnowledgeBaseImportTaskRegistry, KnowledgeBaseImportTaskSnapshot,
    ParseOptions, ParsedDocument, RagContextBundle, RagEngine, ReindexKnowledgeBaseRequest,
    ReindexKnowledgeDocumentRequest, RetryKnowledgeBaseDocumentsRequest,
};

const RAG_KNOWLEDGE_IMPORT_PROGRESS_EVENT: &str = "rag-import-progress";

fn normalize_rag_import_request_id(request_id: Option<&str>) -> String {
    request_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "kb-import-{}-{}",
                Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4()
            )
        })
}

fn create_rag_import_progress_callback_with_emitter<F>(
    task_registry: Arc<KnowledgeBaseImportTaskRegistry>,
    emit_progress: F,
) -> KnowledgeBaseImportProgressCallback
where
    F: Fn(&KnowledgeBaseImportProgress) + Send + Sync + 'static,
{
    Arc::new(move |progress: KnowledgeBaseImportProgress| {
        task_registry.upsert(progress.clone());
        emit_progress(&progress);
    })
}

fn create_rag_import_progress_callback<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    task_registry: Arc<KnowledgeBaseImportTaskRegistry>,
) -> KnowledgeBaseImportProgressCallback {
    let app = app.clone();
    create_rag_import_progress_callback_with_emitter(
        task_registry,
        move |progress: &KnowledgeBaseImportProgress| {
            let _ = app.emit(RAG_KNOWLEDGE_IMPORT_PROGRESS_EVENT, progress);
        },
    )
}

async fn execute_rag_import_knowledge_document(
    engine: &Arc<RagEngine>,
    progress_callback: KnowledgeBaseImportProgressCallback,
    request: KnowledgeBaseImportRequest,
) -> Result<CompletedKnowledgeBaseImport, String> {
    let mut request = request;
    request.progress_event_id = Some(normalize_rag_import_request_id(
        request.progress_event_id.as_deref(),
    ));

    engine
        .import_knowledge_document_with_progress(&request, Some(progress_callback))
        .await
}

async fn execute_rag_reindex_knowledge_document(
    engine: &Arc<RagEngine>,
    progress_callback: KnowledgeBaseImportProgressCallback,
    request: ReindexKnowledgeDocumentRequest,
) -> Result<CompletedKnowledgeBaseImport, String> {
    let mut request = request;
    request.progress_event_id = Some(normalize_rag_import_request_id(
        request.progress_event_id.as_deref(),
    ));

    engine
        .reindex_knowledge_document_with_progress(&request, Some(progress_callback))
        .await
}

fn execute_rag_recover_stuck_knowledge_documents(
    db: &crate::database::Database,
) -> Result<Vec<crate::database::KnowledgeDocumentRecord>, String> {
    crate::database::recover_stuck_knowledge_documents(db)
}

/// 向量检索
#[tauri::command]
pub async fn rag_search(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    query: String,
    limit: Option<usize>,
    session_id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(10);
    let results = engine
        .search(&query, limit, session_id.as_deref(), None)
        .await?;

    Ok(results
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "knowledge_base_id": r.knowledge_base_id,
                "chunk_id": r.chunk_id,
                "embedding_id": r.embedding_id,
                "message_id": r.message_id,
                "document_id": r.document_id,
                "title": r.title,
                "chunk_text": r.chunk_text,
                "snippet": r.snippet,
                "page_number": r.page_number,
                "heading_path": r.heading_path,
                "score": r.score,
                "source": format!("{:?}", r.source),
                "source_kind": format!("{:?}", r.source_kind),
            })
        })
        .collect())
}

/// 手动触发消息向量化
#[tauri::command]
pub async fn rag_embed_message(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    message_id: String,
    content: String,
) -> Result<bool, String> {
    engine.embed_message(&message_id, &content).await?;
    Ok(true)
}

/// 解析文档为结构化块
#[tauri::command]
pub async fn rag_parse_document(
    path: String,
    options: Option<ParseOptions>,
) -> Result<ParsedDocument, String> {
    parse_document_with_ocr(&path, options, Some(create_default_ocr_engine())).await
}

/// 解析并分块文档
#[tauri::command]
pub async fn rag_chunk_document(
    path: String,
    options: Option<ParseOptions>,
    config: Option<ChunkConfig>,
) -> Result<Vec<DocumentChunk>, String> {
    let document =
        parse_document_with_ocr(&path, options, Some(create_default_ocr_engine())).await?;
    let chunk_config = config.unwrap_or_else(ChunkConfig::document_default);
    Ok(chunk_document(&document, &chunk_config))
}

/// 获取 RAG 增强上下文
#[tauri::command]
pub async fn rag_get_context(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    query: String,
    max_tokens: Option<usize>,
) -> Result<String, String> {
    let config = ContextConfig {
        max_tokens: max_tokens.unwrap_or(2000),
        ..Default::default()
    };
    engine.build_context(&query, &config).await
}

/// 获取“prompt context + citations”组合结果
#[tauri::command]
pub async fn rag_retrieve_with_citations(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    query: String,
    max_tokens: Option<usize>,
    max_results: Option<usize>,
    session_id: Option<String>,
    source_kinds: Option<Vec<crate::rag::SearchSourceKind>>,
) -> Result<RagContextBundle, String> {
    let config = ContextConfig {
        max_tokens: max_tokens.unwrap_or(2000),
        max_results: max_results.unwrap_or(5),
        include_source: true,
    };

    engine
        .retrieve_context_bundle(
            &query,
            &config,
            session_id.as_deref(),
            source_kinds.as_deref(),
        )
        .await
}

/// 获取向量化统计
#[tauri::command]
pub fn rag_stats(
    engine: State<'_, std::sync::Arc<RagEngine>>,
) -> Result<serde_json::Value, String> {
    let stats = engine.get_stats()?;
    Ok(serde_json::json!({
        "total_embeddings": stats.total,
        "total_messages": stats.messages,
        "storage_bytes": stats.storage_size,
        "model_id": stats.model_id
    }))
}

/// 配置 RAG Embedding Provider
#[tauri::command]
pub fn rag_configure(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    config: EmbeddingProviderConfig,
) -> Result<bool, String> {
    let provider = format!("{:?}", config.provider);
    let requested_model = config
        .model
        .clone()
        .unwrap_or_else(|| "<default>".to_string());

    engine.configure_embedding_provider(config)?;

    tracing::info!(
        provider = %provider,
        requested_model = %requested_model,
        active_model = %engine.current_embedding_model_id()?.unwrap_or_else(|| "<none>".to_string()),
        "RAG embedding provider configured"
    );

    Ok(true)
}

/// 删除消息的向量
#[tauri::command]
pub fn rag_delete_vectors(
    engine: State<'_, std::sync::Arc<RagEngine>>,
    message_id: String,
) -> Result<(), String> {
    engine.delete_vectors(&message_id)
}

/// 导入知识库文档并执行 embedding 入库
#[tauri::command]
pub async fn rag_import_knowledge_document(
    app: AppHandle,
    engine: State<'_, std::sync::Arc<RagEngine>>,
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    request: KnowledgeBaseImportRequest,
) -> Result<CompletedKnowledgeBaseImport, String> {
    execute_rag_import_knowledge_document(
        engine.inner(),
        create_rag_import_progress_callback(&app, task_registry.inner().clone()),
        request,
    )
    .await
}

/// 重建单个知识库文档索引
#[tauri::command]
pub async fn rag_reindex_knowledge_document(
    app: AppHandle,
    engine: State<'_, std::sync::Arc<RagEngine>>,
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    request: ReindexKnowledgeDocumentRequest,
) -> Result<CompletedKnowledgeBaseImport, String> {
    execute_rag_reindex_knowledge_document(
        engine.inner(),
        create_rag_import_progress_callback(&app, task_registry.inner().clone()),
        request,
    )
    .await
}

/// 重建整个知识库中的所有文档索引
#[tauri::command]
pub async fn rag_reindex_knowledge_base(
    app: AppHandle,
    engine: State<'_, std::sync::Arc<RagEngine>>,
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    request: ReindexKnowledgeBaseRequest,
) -> Result<CompletedKnowledgeBaseReindex, String> {
    let mut request = request;
    request.progress_event_id = Some(normalize_rag_import_request_id(
        request.progress_event_id.as_deref(),
    ));

    engine
        .reindex_knowledge_base_with_progress(
            &request,
            Some(create_rag_import_progress_callback(
                &app,
                task_registry.inner().clone(),
            )),
        )
        .await
}

/// 扫描并重试当前知识库中 pending / failed 文档
#[tauri::command]
pub async fn rag_retry_knowledge_base_documents(
    app: AppHandle,
    engine: State<'_, std::sync::Arc<RagEngine>>,
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    request: RetryKnowledgeBaseDocumentsRequest,
) -> Result<CompletedKnowledgeBaseReindex, String> {
    let mut request = request;
    request.progress_event_id = Some(normalize_rag_import_request_id(
        request.progress_event_id.as_deref(),
    ));

    engine
        .retry_knowledge_base_documents_with_progress(
            &request,
            Some(create_rag_import_progress_callback(
                &app,
                task_registry.inner().clone(),
            )),
        )
        .await
}

/// 列出知识库导入/重建索引任务快照
#[tauri::command]
pub fn rag_list_knowledge_import_tasks(
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    knowledge_base_id: Option<String>,
    document_id: Option<String>,
    include_finished: Option<bool>,
) -> Result<Vec<KnowledgeBaseImportTaskSnapshot>, String> {
    Ok(task_registry.list(
        knowledge_base_id.as_deref(),
        document_id.as_deref(),
        include_finished.unwrap_or(true),
    ))
}

/// 获取单个知识库导入/重建索引任务快照
#[tauri::command]
pub fn rag_get_knowledge_import_task(
    task_registry: State<'_, Arc<KnowledgeBaseImportTaskRegistry>>,
    request_id: String,
) -> Result<Option<KnowledgeBaseImportTaskSnapshot>, String> {
    Ok(task_registry.get(&request_id))
}

/// 创建知识库
#[tauri::command]
pub fn rag_create_knowledge_base(
    db: State<'_, Arc<crate::database::Database>>,
    input: crate::database::CreateKnowledgeBaseInput,
) -> Result<crate::database::KnowledgeBaseRecord, String> {
    crate::database::create_knowledge_base(&db, input)
}

/// 列出知识库
#[tauri::command]
pub fn rag_list_knowledge_bases(
    db: State<'_, Arc<crate::database::Database>>,
) -> Result<Vec<crate::database::KnowledgeBaseRecord>, String> {
    crate::database::list_knowledge_bases(&db)
}

/// 获取单个知识库的聚合统计
#[tauri::command]
pub fn rag_get_knowledge_base_stats(
    db: State<'_, Arc<crate::database::Database>>,
    knowledge_base_id: String,
) -> Result<Option<crate::database::KnowledgeBaseStatsRecord>, String> {
    crate::database::get_knowledge_base_stats(&db, &knowledge_base_id)
}

/// 恢复应用重启前卡在 indexing 的知识库文档
#[tauri::command]
pub fn rag_recover_stuck_knowledge_documents(
    db: State<'_, Arc<crate::database::Database>>,
) -> Result<Vec<crate::database::KnowledgeDocumentRecord>, String> {
    execute_rag_recover_stuck_knowledge_documents(&db)
}

/// 删除知识库
#[tauri::command]
pub fn rag_delete_knowledge_base(
    db: State<'_, Arc<crate::database::Database>>,
    knowledge_base_id: String,
) -> Result<(), String> {
    crate::database::delete_knowledge_base(&db, &knowledge_base_id)
}

/// 列出知识库中的文档
#[tauri::command]
pub fn rag_list_knowledge_documents(
    db: State<'_, Arc<crate::database::Database>>,
    knowledge_base_id: String,
) -> Result<Vec<crate::database::KnowledgeDocumentRecord>, String> {
    crate::database::list_knowledge_documents(&db, &knowledge_base_id)
}

/// 获取单个知识库文档
#[tauri::command]
pub fn rag_get_knowledge_document(
    db: State<'_, Arc<crate::database::Database>>,
    document_id: String,
) -> Result<Option<crate::database::KnowledgeDocumentRecord>, String> {
    crate::database::get_knowledge_document(&db, &document_id)
}

/// 列出单个知识库文档的分块明细
#[tauri::command]
pub fn rag_list_knowledge_document_chunks(
    db: State<'_, Arc<crate::database::Database>>,
    document_id: String,
) -> Result<Vec<crate::database::KnowledgeChunkRecord>, String> {
    crate::database::list_knowledge_document_chunks(&db, &document_id)
}

/// 删除知识库文档
#[tauri::command]
pub fn rag_delete_knowledge_document(
    db: State<'_, Arc<crate::database::Database>>,
    document_id: String,
) -> Result<(), String> {
    crate::database::delete_knowledge_document(&db, &document_id)
}

/// 设置窗口是否显示在任务栏
///
/// 隐身模式控制：开启后窗口从任务栏隐藏，用于面试现场防检测。
/// 关闭后窗口正常显示在任务栏，用户可最小化/恢复。
///
/// Tauri 2 原生支持运行时切换 skipTaskbar，无需重建窗口。
#[tauri::command]
pub async fn set_window_skip_taskbar(
    window: tauri::Window,
    skip: bool,
) -> Result<(), String> {
    window.set_skip_taskbar(skip).map_err(|e| e.to_string())
}

/// 设置窗口是否置顶
///
/// 隐身模式下窗口始终置顶，确保不被其他窗口遮挡，方便面试时快速查看。
/// 普通模式下不置顶，行为与常规桌面应用一致。
#[tauri::command]
pub async fn set_window_always_on_top(
    window: tauri::Window,
    always_on_top: bool,
) -> Result<(), String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

// ==================== TTS 语音合成命令 ====================

/// 使用 Windows SAPI 进行文本转语音朗读
///
/// 使用系统内置语音引擎，离线运行无需网络。
/// 异步朗读模式，函数立即返回不阻塞。
#[tauri::command]
pub async fn tts_speak(
    text: String,
    rate: Option<i32>,
    volume: Option<u16>,
) -> Result<(), String> {
    crate::tts::speak_sapi(text, rate.unwrap_or(2), volume.unwrap_or(100))
}

/// 停止当前 TTS 朗读
#[tauri::command]
pub async fn tts_stop() -> Result<(), String> {
    crate::tts::stop_sapi()
}

// ==================== 屏幕捕获检测 & 隐身控制命令 ====================

/// 检测当前是否有已知的会议/录屏软件正在运行
#[tauri::command]
pub async fn check_capture_status() -> Result<Vec<String>, String> {
    Ok(crate::capture_detection::detect_capture_processes())
}

/// 运行时切换窗口 contentProtected（防屏幕捕获）
#[tauri::command]
pub async fn set_content_protection(
    window: tauri::Window,
    enabled: bool,
) -> Result<(), String> {
    let title = window.title().unwrap_or_else(|_| "AI Cue - AI Interview Assistant".to_string());
    crate::capture_detection::set_content_protected(&title, enabled)
}

/// 一键启用/禁用完整隐身模式
/// 同时控制 skipTaskbar + alwaysOnTop，确保窗口在屏幕共享时不被发现
#[tauri::command]
pub async fn set_stealth_mode(
    window: tauri::Window,
    enabled: bool,
) -> Result<(), String> {
    window.set_skip_taskbar(enabled).map_err(|e| e.to_string())?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    // contentProtected 在 tauri.conf.json 中默认开启，这里也动态设置
    let title = window.title().unwrap_or_else(|_| "AI Cue - AI Interview Assistant".to_string());
    crate::capture_detection::set_content_protected(&title, enabled).ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    struct StaticEmbeddingProvider {
        model_id: String,
        embedding: Vec<f32>,
    }

    impl StaticEmbeddingProvider {
        fn new(model_id: &str, embedding: Vec<f32>) -> Self {
            Self {
                model_id: model_id.to_string(),
                embedding,
            }
        }
    }

    #[async_trait]
    impl crate::rag::EmbeddingProvider for StaticEmbeddingProvider {
        async fn embed(&self, _text: &str) -> Result<Vec<f32>, crate::rag::EmbedError> {
            Ok(self.embedding.clone())
        }

        async fn embed_batch(
            &self,
            texts: &[String],
        ) -> Result<Vec<Vec<f32>>, crate::rag::EmbedError> {
            Ok(texts.iter().map(|_| self.embedding.clone()).collect())
        }

        fn model_id(&self) -> &str {
            &self.model_id
        }

        fn dimension(&self) -> usize {
            self.embedding.len()
        }
    }

    struct CommandTestContext {
        db: Arc<crate::database::Database>,
        engine: Arc<crate::rag::RagEngine>,
        task_registry: Arc<crate::rag::KnowledgeBaseImportTaskRegistry>,
    }

    fn create_test_command_context() -> CommandTestContext {
        let temp_dir = std::env::temp_dir().join(format!(
            "rag_command_integration_test_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let db = Arc::new(crate::database::init_database(&temp_dir).unwrap());
        let engine = Arc::new(crate::rag::RagEngine::new(db.clone()));
        let task_registry = Arc::new(crate::rag::KnowledgeBaseImportTaskRegistry::new());

        CommandTestContext {
            db,
            engine,
            task_registry,
        }
    }

    fn create_test_knowledge_base(db: &Arc<crate::database::Database>) -> String {
        crate::database::create_knowledge_base(
            db,
            crate::database::CreateKnowledgeBaseInput {
                name: "Command Test KB".to_string(),
                description: Some("command integration".to_string()),
            },
        )
        .unwrap()
        .id
    }

    fn create_test_file(name: &str, content: &str) -> String {
        let temp_dir =
            std::env::temp_dir().join(format!("rag_command_source_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join(name);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn create_test_progress_callback(
        task_registry: Arc<crate::rag::KnowledgeBaseImportTaskRegistry>,
    ) -> (
        KnowledgeBaseImportProgressCallback,
        Arc<Mutex<Vec<KnowledgeBaseImportProgress>>>,
    ) {
        let emitted_progress = Arc::new(Mutex::new(Vec::new()));
        let emitted_progress_for_callback = emitted_progress.clone();
        let callback = create_rag_import_progress_callback_with_emitter(
            task_registry,
            move |progress: &KnowledgeBaseImportProgress| {
                emitted_progress_for_callback
                    .lock()
                    .unwrap()
                    .push(progress.clone());
            },
        );

        (callback, emitted_progress)
    }

    #[tokio::test]
    async fn rag_import_knowledge_document_command_indexes_document_and_tracks_task_snapshot() {
        let context = create_test_command_context();
        let knowledge_base_id = create_test_knowledge_base(&context.db);
        let path = create_test_file(
            "command-import.md",
            "# Rust\n\nCommand-level import should index this document.\n",
        );
        let (progress_callback, emitted_progress) =
            create_test_progress_callback(context.task_registry.clone());

        context
            .engine
            .set_embedding_provider(Arc::new(StaticEmbeddingProvider::new(
                "command-import-model",
                vec![0.1, 0.2, 0.3],
            )))
            .unwrap();

        let imported = execute_rag_import_knowledge_document(
            &context.engine,
            progress_callback,
            crate::rag::KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: Some("   ".to_string()),
            },
        )
        .await
        .unwrap();

        assert_eq!(
            imported.document.index_state,
            crate::database::KnowledgeDocumentIndexState::Ready
        );
        assert!(!imported.persisted_chunks.is_empty());
        assert_eq!(
            imported.document.embedding_count,
            imported.persisted_embeddings.len()
        );
        assert!(imported
            .persisted_embeddings
            .iter()
            .all(|embedding| embedding.model_id == "command-import-model"));

        let tasks = context.task_registry.list(
            Some(&imported.document.knowledge_base_id),
            Some(&imported.document.id),
            true,
        );
        assert_eq!(tasks.len(), 1);
        let task = &tasks[0];
        assert!(task.request_id.starts_with("kb-import-"));
        assert_eq!(
            task.status,
            crate::rag::KnowledgeBaseImportProgressStatus::Completed
        );
        assert_eq!(
            task.document_id.as_deref(),
            Some(imported.document.id.as_str())
        );
        assert_eq!(task.stage, crate::rag::KnowledgeBaseImportStage::Finalize);

        let emitted_progress = emitted_progress.lock().unwrap();
        assert!(!emitted_progress.is_empty());
        assert!(emitted_progress
            .iter()
            .all(|progress| { progress.request_id.as_deref() == Some(task.request_id.as_str()) }));
        assert_eq!(
            emitted_progress.last().map(|progress| progress.status),
            Some(crate::rag::KnowledgeBaseImportProgressStatus::Completed)
        );
        assert_eq!(
            crate::database::get_knowledge_document(&context.db, &imported.document.id)
                .unwrap()
                .unwrap()
                .index_state,
            crate::database::KnowledgeDocumentIndexState::Ready
        );
    }

    #[tokio::test]
    async fn rag_reindex_knowledge_document_command_reuses_document_id_and_updates_task_snapshot() {
        let context = create_test_command_context();
        let knowledge_base_id = create_test_knowledge_base(&context.db);
        let path = create_test_file("command-reindex.md", "# Rust\n\nInitial content.\n");

        context
            .engine
            .set_embedding_provider(Arc::new(StaticEmbeddingProvider::new(
                "command-reindex-model-v1",
                vec![1.0, 0.0],
            )))
            .unwrap();

        let (import_progress_callback, _) =
            create_test_progress_callback(context.task_registry.clone());
        let imported = execute_rag_import_knowledge_document(
            &context.engine,
            import_progress_callback,
            crate::rag::KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: Some("cmd-import-before-reindex".to_string()),
            },
        )
        .await
        .unwrap();

        std::fs::write(
            &imported.document.source_path,
            "# Rust\n\nInitial content.\n\n## Reindexed\n\nUpdated through command reindex.\n",
        )
        .unwrap();

        context
            .engine
            .set_embedding_provider(Arc::new(StaticEmbeddingProvider::new(
                "command-reindex-model-v2",
                vec![0.0, 1.0, 0.0],
            )))
            .unwrap();

        let (reindex_progress_callback, emitted_progress) =
            create_test_progress_callback(context.task_registry.clone());
        let reindexed = execute_rag_reindex_knowledge_document(
            &context.engine,
            reindex_progress_callback,
            crate::rag::ReindexKnowledgeDocumentRequest {
                document_id: imported.document.id.clone(),
                parse_options: None,
                chunk_config: Some(crate::rag::ChunkConfig {
                    max_chunk_size: 70,
                    overlap_size: 0,
                    min_chunk_size: 18,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: Some("cmd-reindex".to_string()),
            },
        )
        .await
        .unwrap();

        assert_eq!(reindexed.document.id, imported.document.id);
        assert_ne!(
            reindexed.document.content_hash,
            imported.document.content_hash
        );
        assert_eq!(
            reindexed.document.index_state,
            crate::database::KnowledgeDocumentIndexState::Ready
        );
        assert!(reindexed
            .persisted_embeddings
            .iter()
            .all(|embedding| embedding.model_id == "command-reindex-model-v2"));

        let task = context.task_registry.get("cmd-reindex").unwrap();
        assert_eq!(
            task.status,
            crate::rag::KnowledgeBaseImportProgressStatus::Completed
        );
        assert_eq!(
            task.document_id.as_deref(),
            Some(reindexed.document.id.as_str())
        );
        assert_eq!(
            task.operation,
            crate::rag::KnowledgeBaseImportOperation::Reindex
        );

        let emitted_progress = emitted_progress.lock().unwrap();
        assert!(!emitted_progress.is_empty());
        assert!(emitted_progress
            .iter()
            .all(|progress| { progress.request_id.as_deref() == Some("cmd-reindex") }));
        assert_eq!(
            emitted_progress.last().map(|progress| progress.operation),
            Some(crate::rag::KnowledgeBaseImportOperation::Reindex)
        );

        let stored_documents = crate::database::list_knowledge_documents(
            &context.db,
            &reindexed.document.knowledge_base_id,
        )
        .unwrap();
        assert_eq!(stored_documents.len(), 1);
        assert_eq!(stored_documents[0].id, reindexed.document.id);
    }

    #[test]
    fn rag_recover_stuck_knowledge_documents_command_marks_indexing_documents_failed() {
        let context = create_test_command_context();
        let knowledge_base_id = create_test_knowledge_base(&context.db);
        let indexing_document = crate::database::create_knowledge_document(
            &context.db,
            crate::database::CreateKnowledgeDocumentInput {
                knowledge_base_id,
                title: "stuck".to_string(),
                file_name: "stuck.md".to_string(),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: "C:\\docs\\stuck.md".to_string(),
                source_byte_size: 512,
                source_modified_at: 1_710_000_000_000,
                content_hash: "sha1:stuck".to_string(),
                fingerprint: "fp:C:\\docs\\stuck.md:512:1710000000000:stuck".to_string(),
                index_state: Some(crate::database::KnowledgeDocumentIndexState::Indexing),
                last_error: None,
            },
        )
        .unwrap();

        let recovered = execute_rag_recover_stuck_knowledge_documents(&context.db).unwrap();

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, indexing_document.id);
        assert_eq!(
            recovered[0].index_state,
            crate::database::KnowledgeDocumentIndexState::Failed
        );
        assert!(recovered[0]
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("应用重启后恢复"));

        let persisted = crate::database::get_knowledge_document(&context.db, &indexing_document.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted.index_state,
            crate::database::KnowledgeDocumentIndexState::Failed
        );
        assert!(persisted
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("应用重启后恢复"));
    }
}
