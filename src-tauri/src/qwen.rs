// 千问 API 调用模块 - 使用 DashScope OpenAI 兼容接口

use serde::{Deserialize, Serialize};

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

/// OpenAI 兼容的响应体
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

    let client = reqwest::Client::new();

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };

    let response = client
        .post(BASE_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 错误 ({}): {}", status, body));
    }

    let chat_response: ChatResponse =
        serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {} - {}", e, body))?;

    chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "API 返回空结果".to_string())
}
