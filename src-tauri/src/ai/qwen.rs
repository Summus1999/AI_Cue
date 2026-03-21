// Qwen Provider 实现 - 阿里云千问 DashScope

use async_trait::async_trait;
use serde::Deserialize;
use tauri::AppHandle;
use crate::ai::{
    stream::{handle_error_status, parse_openai_sse_stream},
    traits::{AIError, AIProvider},
    types::{ChatMessage, ConnectionTestResult, ModelInfo, ProviderConfig},
    create_http_client, map_reqwest_error,
};

/// 非流式响应体
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

pub struct QwenProvider;

impl QwenProvider {
    pub fn new() -> Self {
        Self
    }

    /// DashScope 默认 Base URL
    fn base_url(config: &ProviderConfig) -> String {
        config.base_url.clone()
            .unwrap_or_else(|| "https://dashscope.aliyuncs.com/compatible-mode/v1".into())
    }
}

impl Default for QwenProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AIProvider for QwenProvider {
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError> {
        let url = format!("{}/chat/completions", Self::base_url(config));
        let client = create_http_client(60)?;

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": false
        });

        let response = client.post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
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

        let chat_response: ChatResponse = serde_json::from_str(&body_text)
            .map_err(|e| AIError::StreamParse(format!("解析响应失败: {} - {}", e, body_text)))?;

        chat_response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or_else(|| AIError::InvalidRequest("API 返回空结果".to_string()))
    }

    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<bool, AIError> {
        let url = format!("{}/chat/completions", Self::base_url(config));
        let client = create_http_client(120)?;

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true
        });

        let response = client.post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        handle_error_status(&response)?;

        // 复用通用 SSE 解析器（DashScope 使用 OpenAI 兼容格式）
        parse_openai_sse_stream(&app, response, "ai-stream").await
    }

    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, AIError> {
        let start = std::time::Instant::now();
        let url = format!("{}/chat/completions", Self::base_url(config));

        let body = serde_json::json!({
            "model": "qwen-turbo",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": false
        });

        let client = create_http_client(15)?;

        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        let latency = start.elapsed().as_millis() as u64;

        if resp.status().is_success() {
            Ok(ConnectionTestResult {
                success: true,
                latency_ms: latency,
                model_used: "qwen-turbo".into(),
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
                id: "qwen-turbo".into(), 
                name: "Qwen Turbo".into(),
                description: "快速响应，适合简单任务".into(), 
                supports_vision: false 
            },
            ModelInfo { 
                id: "qwen-plus".into(), 
                name: "Qwen Plus".into(),
                description: "平衡性能与质量".into(), 
                supports_vision: false 
            },
            ModelInfo { 
                id: "qwen-max".into(), 
                name: "Qwen Max".into(),
                description: "最强推理能力".into(), 
                supports_vision: false 
            },
            ModelInfo { 
                id: "qwen-coder-plus".into(), 
                name: "Qwen Coder Plus".into(),
                description: "编程优化模型".into(), 
                supports_vision: false 
            },
            ModelInfo { 
                id: "qwen-vl-max".into(), 
                name: "Qwen VL Max".into(),
                description: "视觉理解模型".into(), 
                supports_vision: true 
            },
        ]
    }

    fn id(&self) -> &'static str { "qwen" }
    
    fn display_name(&self) -> &'static str { "阿里云千问" }
}
