// OpenAI 兼容 Provider 实现
// 支持 GPT-4o、DeepSeek、Ollama、vLLM 等所有 OpenAI 兼容接口

use async_trait::async_trait;
use serde::Deserialize;
use tauri::AppHandle;
use tokio::sync::watch;
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

#[derive(Clone)]
pub struct OpenAICompatProvider;

impl OpenAICompatProvider {
    pub fn new() -> Self {
        Self
    }

    fn base_url(config: &ProviderConfig) -> String {
        config.base_url.clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".into())
    }
}

impl Default for OpenAICompatProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AIProvider for OpenAICompatProvider {
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError> {
        let base_url = Self::base_url(config);
        let url = format!("{}/chat/completions", base_url);
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
        event_name: &str,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<bool, AIError> {
        let base_url = Self::base_url(config);
        let url = format!("{}/chat/completions", base_url);
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

        // 复用通用 SSE 解析器
        parse_openai_sse_stream(&app, response, event_name, cancel_rx).await
    }

    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, AIError> {
        let start = std::time::Instant::now();
        let base_url = Self::base_url(config);
        let url = format!("{}/chat/completions", base_url);

        // 尝试使用 gpt-4o-mini 或第一个可用模型进行测试
        let test_model = "gpt-4o-mini";

        let body = serde_json::json!({
            "model": test_model,
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
                id: "gpt-4o".into(), 
                name: "GPT-4o".into(),
                description: "OpenAI 多模态旗舰模型".into(), 
                supports_vision: true 
            },
            ModelInfo { 
                id: "gpt-4o-mini".into(), 
                name: "GPT-4o Mini".into(),
                description: "轻量级，性价比高".into(), 
                supports_vision: true 
            },
            ModelInfo { 
                id: "deepseek-chat".into(), 
                name: "DeepSeek Chat".into(),
                description: "DeepSeek 对话模型".into(), 
                supports_vision: false 
            },
            ModelInfo { 
                id: "deepseek-reasoner".into(), 
                name: "DeepSeek R1".into(),
                description: "DeepSeek 推理模型".into(), 
                supports_vision: false 
            },
        ]
    }

    fn id(&self) -> &'static str { "openai_compat" }
    
    fn display_name(&self) -> &'static str { "OpenAI 兼容" }
}
