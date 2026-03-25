// Claude Provider 实现 - Anthropic Claude API

use async_trait::async_trait;
use serde::Deserialize;
use tauri::AppHandle;
use tokio::sync::watch;
use crate::ai::{
    stream::{handle_error_status, parse_claude_sse_stream},
    traits::{AIError, AIProvider},
    types::{ChatMessage, ConnectionTestResult, ModelInfo, ProviderConfig},
    create_http_client, map_reqwest_error,
};

/// 非流式响应体
#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

#[derive(Clone)]
pub struct ClaudeProvider;

impl ClaudeProvider {
    pub fn new() -> Self {
        Self
    }

    fn base_url(config: &ProviderConfig) -> String {
        config.base_url.clone()
            .unwrap_or_else(|| "https://api.anthropic.com".into())
    }

    /// 将通用消息格式转换为 Claude 格式
    /// Claude 要求 system message 单独放在请求体的 system 字段
    fn convert_messages(messages: Vec<ChatMessage>) -> (Option<String>, Vec<ClaudeMessage>) {
        let mut system_msg = None;
        let mut claude_messages = Vec::new();

        for msg in messages {
            match msg.role.as_str() {
                "system" => {
                    if system_msg.is_none() {
                        system_msg = Some(msg.content);
                    }
                }
                _ => {
                    claude_messages.push(ClaudeMessage {
                        role: msg.role,
                        content: msg.content,
                    });
                }
            }
        }

        (system_msg, claude_messages)
    }
}

impl Default for ClaudeProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

use serde::Serialize;

#[async_trait]
impl AIProvider for ClaudeProvider {
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError> {
        let base_url = Self::base_url(config);
        let url = format!("{}/v1/messages", base_url);
        let client = create_http_client(60)?;

        let (system_msg, claude_messages) = Self::convert_messages(messages);

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": 8192,
            "messages": claude_messages,
        });

        if let Some(sys) = system_msg {
            body["system"] = serde_json::Value::String(sys);
        }

        let response = client.post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        handle_error_status(&response)?;

        let status = response.status();
        let body_text = response.text().await
            .map_err(|e| AIError::Network(e.to_string()))?;

        if !status.is_success() {
            return Err(AIError::Api(status.as_u16(), body_text));
        }

        let claude_response: ClaudeResponse = serde_json::from_str(&body_text)
            .map_err(|e| AIError::StreamParse(format!("解析响应失败: {} - {}", e, body_text)))?;

        // 提取文本内容
        let content = claude_response
            .content
            .into_iter()
            .filter_map(|block| {
                if block.content_type == "text" {
                    block.text
                } else {
                    None
                }
            })
            .collect::<Vec<String>>()
            .join("");

        if content.is_empty() {
            return Err(AIError::InvalidRequest("API 返回空结果".to_string()));
        }

        Ok(content)
    }

    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
        event_name: &str,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<bool, AIError> {
        let base_url = Self::base_url(config);
        let url = format!("{}/v1/messages", base_url);
        let client = create_http_client(120)?;

        let (system_msg, claude_messages) = Self::convert_messages(messages);

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": 8192,
            "messages": claude_messages,
            "stream": true
        });

        if let Some(sys) = system_msg {
            body["system"] = serde_json::Value::String(sys);
        }

        let response = client.post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        handle_error_status(&response)?;

        // 使用 Claude 专用 SSE 解析器
        parse_claude_sse_stream(&app, response, event_name, cancel_rx).await
    }

    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, AIError> {
        let start = std::time::Instant::now();
        let base_url = Self::base_url(config);
        let url = format!("{}/v1/messages", base_url);

        let test_model = "claude-sonnet-4-20250514";

        let body = serde_json::json!({
            "model": test_model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        });

        let client = create_http_client(15)?;

        let resp = client.post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        let latency = start.elapsed().as_millis() as u64;

        if resp.status().is_success() {
            Ok(ConnectionTestResult {
                success: true,
                latency_ms: latency,
                model_used: test_model.into(),
                message: format!("连接成功，延迟 {}ms", latency),
            })
        } else {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(AIError::Api(status, body))
        }
    }

    fn default_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo { 
                id: "claude-sonnet-4-20250514".into(), 
                name: "Claude Sonnet 4".into(),
                description: "平衡性能与质量".into(), 
                supports_vision: true 
            },
            ModelInfo { 
                id: "claude-opus-4-20250514".into(), 
                name: "Claude Opus 4".into(),
                description: "最强推理能力".into(), 
                supports_vision: true 
            },
            ModelInfo { 
                id: "claude-haiku-3-5-20241022".into(), 
                name: "Claude 3.5 Haiku".into(),
                description: "快速响应".into(), 
                supports_vision: false 
            },
        ]
    }

    fn id(&self) -> &'static str { "claude" }
    
    fn display_name(&self) -> &'static str { "Anthropic Claude" }
}
