// 通用 SSE 流式解析器

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use crate::ai::traits::AIError;
use crate::ai::types::{OpenAIStreamChunk, StreamEvent};

/// 最大缓冲区大小 (1MB)
const MAX_BUFFER_SIZE: usize = 1024 * 1024;

/// 通用 OpenAI 兼容 SSE 流式解析
///
/// 适用于所有返回 `data: {"choices":[{"delta":{"content":"..."}}]}` 格式的 Provider
/// （DashScope / OpenAI / DeepSeek / Ollama / vLLM 等）
///
/// 返回：是否正常完成（true = 收到 [DONE] 或正常结束标记）
pub async fn parse_openai_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    event_name: &str,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<bool, AIError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut received_done = false;
    let mut finish_reason = String::new();

    if *cancel_rx.borrow() {
        emit_user_abort(app, event_name);
        return Ok(false);
    }

    loop {
        let next_chunk = tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    emit_user_abort(app, event_name);
                    return Ok(false);
                }
                continue;
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = next_chunk else {
            break;
        };

        let chunk = chunk.map_err(|e| AIError::StreamParse(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
    
        // 检查缓冲区大小，防止无限增长
        if buffer.len() > MAX_BUFFER_SIZE {
            return Err(AIError::StreamParse(format!(
                "缓冲区溢出: 超过最大限制 {}MB",
                MAX_BUFFER_SIZE / 1024 / 1024
            )));
        }
    
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
    
            if line.is_empty() { continue; }
    
            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str.trim() == "[DONE]" {
                    received_done = true;
                    let _ = app.emit(event_name, StreamEvent {
                        content: String::new(),
                        done: true,
                        is_complete: Some(true),
                        finish_reason: Some("stop".to_string()),
                    });
                    return Ok(true);
                }

                if let Ok(chunk) = serde_json::from_str::<OpenAIStreamChunk>(json_str) {
                    // 检查 finish_reason
                    if let Some(choice) = chunk.choices.first() {
                        if *cancel_rx.borrow() {
                            emit_user_abort(app, event_name);
                            return Ok(false);
                        }
                        if let Some(reason) = &choice.finish_reason {
                            finish_reason = reason.clone();
                        }
                        if let Some(content) = choice.delta.content.as_ref() {
                            let _ = app.emit(event_name, StreamEvent {
                                content: content.clone(),
                                done: false,
                                is_complete: None,
                                finish_reason: None,
                            });
                        }
                    }
                }
            }
        }
    }

    // 流结束但未收到 [DONE]
    // 如果有 finish_reason 且不是 "length"，认为是正常完成
    let is_complete = !finish_reason.is_empty() && finish_reason != "length";
    let _ = app.emit(event_name, StreamEvent {
        content: String::new(),
        done: true,
        is_complete: Some(is_complete),
        finish_reason: Some(if finish_reason.is_empty() { "interrupted".to_string() } else { finish_reason }),
    });

    Ok(is_complete)
}

/// Claude SSE 流式解析（Anthropic 使用不同的 SSE 事件格式）
///
/// Claude 格式：
///   event: content_block_delta
///   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
///   
///   event: message_stop
///   data: {"type":"message_stop"}
pub async fn parse_claude_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    event_name: &str,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<bool, AIError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event_type = String::new();

    if *cancel_rx.borrow() {
        emit_user_abort(app, event_name);
        return Ok(false);
    }

    loop {
        let next_chunk = tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    emit_user_abort(app, event_name);
                    return Ok(false);
                }
                continue;
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = next_chunk else {
            break;
        };

        let chunk = chunk.map_err(|e| AIError::StreamParse(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // 检查缓冲区大小，防止无限增长
        if buffer.len() > MAX_BUFFER_SIZE {
            return Err(AIError::StreamParse(format!(
                "缓冲区溢出: 超过最大限制 {}MB",
                MAX_BUFFER_SIZE / 1024 / 1024
            )));
        }

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                current_event_type.clear();
                continue;
            }

            // 解析 event 行
            if let Some(event_type) = line.strip_prefix("event: ") {
                current_event_type = event_type.trim().to_string();
                continue;
            }

            // 解析 data 行
            if let Some(json_str) = line.strip_prefix("data: ") {
                // 消息结束
                if current_event_type == "message_stop" {
                    let _ = app.emit(event_name, StreamEvent {
                        content: String::new(),
                        done: true,
                        is_complete: Some(true),
                        finish_reason: Some("stop".to_string()),
                    });
                    return Ok(true);
                }

                // 内容块增量
                if current_event_type == "content_block_delta" {
                    if let Ok(event) = serde_json::from_str::<crate::ai::types::ClaudeStreamEvent>(json_str) {
                        if *cancel_rx.borrow() {
                            emit_user_abort(app, event_name);
                            return Ok(false);
                        }
                        if let Some(delta) = event.delta {
                            if let Some(text) = delta.text {
                                let _ = app.emit(event_name, StreamEvent {
                                    content: text,
                                    done: false,
                                    is_complete: None,
                                    finish_reason: None,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 流正常结束
    let _ = app.emit(event_name, StreamEvent {
        content: String::new(),
        done: true,
        is_complete: Some(true),
        finish_reason: Some("stop".to_string()),
    });
    Ok(true)
}

/// HTTP 错误状态处理辅助函数
pub fn handle_error_status(response: &reqwest::Response) -> Result<(), AIError> {
    let status = response.status();
    
    if status.is_success() {
        return Ok(());
    }
    
    Err(match status.as_u16() {
        401 | 403 => AIError::Auth(format!("认证失败 ({})", status)),
        429 => AIError::RateLimit("请求频率超限，请稍后重试".to_string()),
        _ => AIError::Api(status.as_u16(), format!("HTTP {}", status)),
    })
}

fn emit_user_abort(app: &AppHandle, event_name: &str) {
    let _ = app.emit(event_name, StreamEvent {
        content: String::new(),
        done: true,
        is_complete: Some(false),
        finish_reason: Some("user_abort".to_string()),
    });
}
