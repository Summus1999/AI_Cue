// 可配置 Provider - 基于描述符驱动的通用 Provider 实现

use async_trait::async_trait;
use tauri::AppHandle;
use tokio::sync::watch;

use super::traits::AIProvider;
use super::types::{
    AuthType, ChatMessage, ConnectionTestResult, ModelInfo, ProviderConfig, ProviderDescriptor,
    SseFormat,
};
use super::{create_http_client, map_reqwest_error, stream};

/// 可配置 Provider - 基于描述符驱动的通用实现
#[derive(Clone)]
pub struct ConfigurableProvider {
    descriptor: ProviderDescriptor,
}

impl ConfigurableProvider {
    pub fn new(descriptor: ProviderDescriptor) -> Self {
        Self { descriptor }
    }

    /// 获取描述符
    pub fn descriptor(&self) -> &ProviderDescriptor {
        &self.descriptor
    }

    /// 构建请求 URL
    fn build_url(&self, config: &ProviderConfig, endpoint: &str) -> String {
        let base = config
            .base_url
            .as_deref()
            .unwrap_or(&self.descriptor.base_url);
        format!("{}{}", base.trim_end_matches('/'), endpoint)
    }

    /// 构建认证 Header
    fn build_auth(&self, api_key: &str) -> Option<(String, String)> {
        match self.descriptor.auth_type {
            AuthType::Bearer => {
                let prefix = self.descriptor.auth_prefix.as_deref().unwrap_or("Bearer ");
                Some((
                    "Authorization".to_string(),
                    format!("{}{}", prefix, api_key),
                ))
            }
            AuthType::ApiKeyHeader => {
                let header = self
                    .descriptor
                    .auth_header
                    .as_deref()
                    .unwrap_or("X-API-Key");
                Some((header.to_string(), api_key.to_string()))
            }
            AuthType::ApiKeyQuery => {
                // 对于 query 方式，返回 None 并在构建 URL 时处理
                None
            }
            AuthType::None => None,
        }
    }

    /// 添加认证到 URL（用于 ApiKeyQuery）
    fn add_auth_to_url(&self, url: &str, api_key: &str) -> String {
        if matches!(self.descriptor.auth_type, AuthType::ApiKeyQuery) {
            format!("{}?{}={}", url, "api_key", api_key)
        } else {
            url.to_string()
        }
    }

    /// 构建请求体
    fn build_request_body(
        &self,
        model: &str,
        messages: &[ChatMessage],
        stream: bool,
    ) -> Result<serde_json::Value, super::traits::AIError> {
        let transform = self.descriptor.request_transform.as_ref();

        let model_field = transform
            .and_then(|t| t.model_field.as_deref())
            .unwrap_or("model");
        let messages_field = transform
            .and_then(|t| t.messages_field.as_deref())
            .unwrap_or("messages");
        let stream_field = transform
            .and_then(|t| t.stream_field.as_deref())
            .unwrap_or("stream");

        let mut body = serde_json::json!({
            "model_field": model,
            "messages_field": messages,
            "stream_field": stream,
        });

        // 重命名字段（因为 json! 宏使用的是字面量 key）
        let body_obj = body.as_object_mut().ok_or_else(|| {
            super::traits::AIError::Config("请求体构建异常：不是 JSON 对象".into())
        })?;

        let model_value = body_obj.remove("model_field").ok_or_else(|| {
            super::traits::AIError::Config("请求体构建异常：model_field 缺失".into())
        })?;
        let messages_value = body_obj.remove("messages_field").ok_or_else(|| {
            super::traits::AIError::Config("请求体构建异常：messages_field 缺失".into())
        })?;
        let stream_value = body_obj.remove("stream_field").ok_or_else(|| {
            super::traits::AIError::Config("请求体构建异常：stream_field 缺失".into())
        })?;

        body_obj.insert(model_field.to_string(), model_value);
        body_obj.insert(messages_field.to_string(), messages_value);
        body_obj.insert(stream_field.to_string(), stream_value);

        // 合并 extra_body
        if let Some(extra) = transform.and_then(|t| t.extra_body.as_ref()) {
            if let Some(extra_obj) = extra.as_object() {
                for (k, v) in extra_obj {
                    body_obj.insert(k.clone(), v.clone());
                }
            }
        }

        Ok(body)
    }

    /// 从 JSON 响应中按点号路径提取内容
    /// 支持 "choices.0.message.content" 格式，数字段表示数组索引
    fn extract_content(json: &serde_json::Value, content_path: Option<&str>) -> String {
        let path = content_path.unwrap_or("choices.0.message.content");
        let mut current = json;

        for segment in path.split('.') {
            current = if let Ok(index) = segment.parse::<usize>() {
                &current[index]
            } else {
                &current[segment]
            };
        }

        current.as_str().unwrap_or("").to_string()
    }
}

#[async_trait]
impl AIProvider for ConfigurableProvider {
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, super::traits::AIError> {
        let transform = self.descriptor.request_transform.as_ref();
        let endpoint = transform
            .and_then(|t| t.chat_endpoint.as_deref())
            .unwrap_or("/chat/completions");

        let url = self.build_url(config, endpoint);
        let url = self.add_auth_to_url(&url, &config.api_key);
        let body = self.build_request_body(model, &messages, false)?;

        let client = create_http_client(60)?;

        let mut request = client.post(&url).json(&body);

        // 添加认证 Header
        if let Some((header, value)) = self.build_auth(&config.api_key) {
            request = request.header(&header, &value);
        }

        // 添加额外 Headers
        if let Some(extra_headers) = transform.and_then(|t| t.extra_headers.as_ref()) {
            for (k, v) in extra_headers {
                request = request.header(k, v);
            }
        }

        tracing::debug!(
            provider_id = %self.descriptor.id,
            url = %url,
            model = %model,
            "发送聊天请求"
        );

        let response = request.send().await.map_err(map_reqwest_error)?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(match status.as_u16() {
                401 | 403 => super::traits::AIError::Auth(text),
                429 => super::traits::AIError::RateLimit(text),
                _ => super::traits::AIError::Api(status.as_u16(), text),
            });
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| super::traits::AIError::StreamParse(e.to_string()))?;

        // 使用 response_transform.content_path 配置提取内容，默认为 OpenAI 格式
        let content_path = self
            .descriptor
            .response_transform
            .as_ref()
            .and_then(|t| t.content_path.as_deref());
        let content = Self::extract_content(&json, content_path);

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
    ) -> Result<bool, super::traits::AIError> {
        let transform = self.descriptor.request_transform.as_ref();
        let endpoint = transform
            .and_then(|t| t.chat_endpoint.as_deref())
            .unwrap_or("/chat/completions");

        let url = self.build_url(config, endpoint);
        let url = self.add_auth_to_url(&url, &config.api_key);
        let body = self.build_request_body(model, &messages, true)?;

        let client = create_http_client(120)?;

        let mut request = client.post(&url).json(&body);

        // 添加认证 Header
        if let Some((header, value)) = self.build_auth(&config.api_key) {
            request = request.header(&header, &value);
        }

        if let Some(extra_headers) = transform.and_then(|t| t.extra_headers.as_ref()) {
            for (k, v) in extra_headers {
                request = request.header(k, v);
            }
        }

        tracing::debug!(
            provider_id = %self.descriptor.id,
            url = %url,
            model = %model,
            "发送流式聊天请求"
        );

        let response = request.send().await.map_err(map_reqwest_error)?;
        stream::handle_error_status(&response)?;

        // 根据 SSE 格式选择解析器
        match self.descriptor.sse_format {
            SseFormat::Claude => {
                stream::parse_claude_sse_stream(&app, response, event_name, cancel_rx).await
            }
            _ => stream::parse_openai_sse_stream(&app, response, event_name, cancel_rx).await,
        }
    }

    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, super::traits::AIError> {
        let health = self.descriptor.health_check.as_ref();
        let endpoint = health
            .and_then(|h| h.endpoint.as_deref())
            .unwrap_or("/models");

        let url = self.build_url(config, endpoint);
        let url = self.add_auth_to_url(&url, &config.api_key);

        let start = std::time::Instant::now();
        let client = create_http_client(10)?;

        let mut request = client.get(&url);

        // 添加认证 Header（可选，health check 可能不需要）
        if let Some((header, value)) = self.build_auth(&config.api_key) {
            request = request.header(&header, &value);
        }

        let response = request.send().await.map_err(map_reqwest_error)?;
        let latency = start.elapsed().as_millis() as u64;
        let status = response.status();

        let expected = health
            .and_then(|h| h.expected_status.as_ref())
            .map(|s| s.as_slice())
            .unwrap_or(&[200, 401, 403]);

        let success = expected.contains(&status.as_u16());

        Ok(ConnectionTestResult {
            success,
            latency_ms: latency,
            model_used: self
                .descriptor
                .models
                .first()
                .map(|m| m.id.clone())
                .unwrap_or_default(),
            message: if success {
                format!("连接成功，延迟 {}ms", latency)
            } else {
                format!("HTTP {}", status)
            },
        })
    }

    fn default_models(&self) -> Vec<ModelInfo> {
        self.descriptor
            .models
            .iter()
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: m.name.clone(),
                description: m.description.clone().unwrap_or_default(),
                supports_vision: m.supports_vision,
            })
            .collect()
    }

    fn id(&self) -> &'static str {
        // 使用 Box::leak 将动态字符串转为 'static（内存泄漏可控）
        Box::leak(self.descriptor.id.clone().into_boxed_str())
    }

    fn display_name(&self) -> &'static str {
        Box::leak(self.descriptor.name.clone().into_boxed_str())
    }
}
