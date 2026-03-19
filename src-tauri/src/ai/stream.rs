// 通用 SSE 流式解析器

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use crate::ai::traits::AIError;
use crate::ai::types::{OpenAIStreamChunk, StreamEvent};

/// 通用 OpenAI 兼容 SSE 流式解析
///
/// 适用于所有返回 `data: {"choices":[{"delta":{"content":"..."}}]}` 格式的 Provider
/// （DashScope / OpenAI / DeepSeek / Ollama / vLLM 等）
pub async fn parse_openai_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    event_name: &str,
) -> Result<(), AIError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AIError::StreamParse(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() { continue; }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str.trim() == "[DONE]" {
                    let _ = app.emit(event_name, StreamEvent {
                        content: String::new(),
                        done: true,
                    });
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<OpenAIStreamChunk>(json_str) {
                    if let Some(content) = chunk.choices.first()
                        .and_then(|c| c.delta.content.as_ref())
                    {
                        let _ = app.emit(event_name, StreamEvent {
                            content: content.clone(),
                            done: false,
                        });
                    }
                }
            }
        }
    }

    // 流正常结束但未收到 [DONE]（兼容某些 Provider）
    let _ = app.emit(event_name, StreamEvent {
        content: String::new(),
        done: true,
    });
    Ok(())
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
) -> Result<(), AIError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event_type = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AIError::StreamParse(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

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
                    });
                    return Ok(());
                }

                // 内容块增量
                if current_event_type == "content_block_delta" {
                    if let Ok(event) = serde_json::from_str::<crate::ai::types::ClaudeStreamEvent>(json_str) {
                        if let Some(delta) = event.delta {
                            if let Some(text) = delta.text {
                                let _ = app.emit(event_name, StreamEvent {
                                    content: text,
                                    done: false,
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
    });
    Ok(())
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
