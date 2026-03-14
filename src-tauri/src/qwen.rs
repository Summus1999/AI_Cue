// 千问 API 调用模块 - 使用 DashScope OpenAI 兼容接口

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 聊天消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// OpenAI 兼容的请求体
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

/// OpenAI 兼容的响应体（非流式）
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

/// 流式响应的 chunk 结构
#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
}

/// 流式事件 payload
#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub content: String,
    pub done: bool,
}

/// 调用千问 API 进行对话
/// 
/// # 参数
/// - `api_key`: DashScope API Key
/// - `model`: 模型名称 (qwen-turbo, qwen-plus, qwen-max, qwen-coder-plus)
/// - `messages`: 对话消息列表
/// 
/// # 返回
/// AI 回复的内容
pub async fn chat(
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    const BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

    // 创建带超时设置的客户端
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))  // 60秒超时
        .connect_timeout(Duration::from_secs(10))  // 连接10秒超时
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };

    println!("[千问API] 发送请求到模型: {}", model);

    let response = client
        .post(BASE_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            println!("[千问API] 请求失败: {}", e);
            if e.is_timeout() {
                "请求超时，请检查网络连接".to_string()
            } else if e.is_connect() {
                "无法连接服务器，请检查网络".to_string()
            } else {
                format!("请求失败: {}", e)
            }
        })?;

    let status = response.status();
    println!("[千问API] 响应状态: {}", status);

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        println!("[千问API] 错误响应: {}", body);
        return Err(format!("API 错误 ({}): {}", status, body));
    }

    let chat_response: ChatResponse =
        serde_json::from_str(&body).map_err(|e| {
            println!("[千问API] 解析失败: {} - {}", e, body);
            format!("解析响应失败: {} - {}", e, body)
        })?;

    let content = chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "API 返回空结果".to_string())?;

    println!("[千问API] 成功获取回复，长度: {} 字符", content.len());
    Ok(content)
}

/// 流式调用千问 API 进行对话
/// 通过 Tauri Event 发送每个 chunk 到前端
pub async fn chat_stream(
    app: AppHandle,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    const BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
    };

    println!("[千问API] 发送流式请求到模型: {}", model);

    let response = client
        .post(BASE_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            println!("[千问API] 流式请求失败: {}", e);
            if e.is_timeout() {
                "请求超时，请检查网络连接".to_string()
            } else if e.is_connect() {
                "无法连接服务器，请检查网络".to_string()
            } else {
                format!("请求失败: {}", e)
            }
        })?;

    let status = response.status();
    println!("[千问API] 流式响应状态: {}", status);

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        println!("[千问API] 流式错误响应: {}", body);
        return Err(format!("API 错误 ({}): {}", status, body));
    }

    // 处理 SSE 流式响应
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // 处理 buffer 中的完整行
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            // SSE 格式: data: {...}
            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str == "[DONE]" {
                    // 流式结束
                    let _ = app.emit("qwen-stream", StreamEvent {
                        content: String::new(),
                        done: true,
                    });
                    println!("[千问API] 流式响应完成");
                    return Ok(());
                }

                // 解析 JSON chunk
                if let Ok(chunk_data) = serde_json::from_str::<StreamChunk>(json_str) {
                    if let Some(choice) = chunk_data.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            let _ = app.emit("qwen-stream", StreamEvent {
                                content: content.clone(),
                                done: false,
                            });
                        }
                    }
                }
            }
        }
    }

    // 确保发送结束信号
    let _ = app.emit("qwen-stream", StreamEvent {
        content: String::new(),
        done: true,
    });

    Ok(())
}
