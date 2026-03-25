// AI Provider 共享类型定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Provider 运行时配置（从前端传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: Option<String>, // 自定义 Base URL（私有化部署）
    pub extra: Option<serde_json::Value>, // Provider 专属扩展字段
}

/// 认证类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    ApiKeyHeader,
    ApiKeyQuery,
    None,
}

/// SSE 流式响应格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SseFormat {
    Openai,
    Claude,
    Custom,
}

/// 请求转换配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTransform {
    pub chat_endpoint: Option<String>,
    pub model_field: Option<String>,
    pub messages_field: Option<String>,
    pub stream_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_body: Option<serde_json::Value>,
}

/// 响应转换配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTransform {
    pub content_path: Option<String>,
}

/// 模型描述符
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

/// Provider 能力
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    #[serde(default = "default_true")]
    pub streaming: bool,
    #[serde(default)]
    pub vision: bool,
    #[serde(default)]
    pub function_calling: bool,
}

fn default_true() -> bool {
    true
}

/// 健康检查配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckConfig {
    pub endpoint: Option<String>,
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_status: Option<Vec<u16>>,
}

/// 速率限制配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests_per_minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_minute: Option<u32>,
}

/// Provider 描述符 - 用于动态 Provider 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub base_url: String,
    #[serde(default = "default_true")]
    pub supports_custom_url: bool,
    pub auth_type: AuthType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_prefix: Option<String>,
    pub sse_format: SseFormat,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_transform: Option<RequestTransform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_transform: Option<ResponseTransform>,
    pub models: Vec<ModelDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Capabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<HealthCheckConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,
}

impl ProviderDescriptor {
    /// 验证描述符是否有效
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("id 不能为空".to_string());
        }
        if !self
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        {
            return Err("id 只能包含小写字母、数字和下划线".to_string());
        }
        if self.models.is_empty() {
            return Err("至少需要定义一个模型".to_string());
        }
        if self.base_url.is_empty() {
            return Err("base_url 不能为空".to_string());
        }
        Ok(())
    }
}

/// 聊天消息（与前端对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 流式事件 payload（与前端对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub content: String,
    pub done: bool,
    /// 新增：流是否正常完成（向后兼容：Option 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_complete: Option<bool>,
    /// 新增：完成原因（向后兼容：Option 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

/// 网络健康状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkHealthStatus {
    /// 基础网络连通
    pub internet_connected: bool,
    /// Provider API 可达
    pub provider_reachable: bool,
    /// RTT 延迟
    pub latency_ms: Option<u64>,
    /// ISO 8601 时间戳
    pub last_check: String,
    /// 错误详情（可选）
    pub error_detail: Option<String>,
}

/// Token 使用统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// 模型元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,            // "qwen-max", "gpt-4o", "claude-sonnet-4-20250514"
    pub name: String,          // 显示名称
    pub description: String,   // 一句话描述
    pub supports_vision: bool, // 是否支持图片输入
}

/// 连通性测试结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub model_used: String,
    pub message: String,
}

/// Provider 元信息（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMeta {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub provider_type: String, // 改为字符串，支持动态 Provider
    pub default_base_url: String,
    pub supports_custom_url: bool,
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub is_builtin: bool,
}

/// SSE 流式解析用的内部结构
#[derive(Debug, Deserialize)]
pub struct OpenAIStreamChunk {
    pub choices: Vec<OpenAIStreamChoice>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIStreamChoice {
    pub delta: OpenAIStreamDelta,
    #[allow(dead_code)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIStreamDelta {
    pub content: Option<String>,
}

/// Claude SSE 流式解析用的内部结构
#[derive(Debug, Deserialize)]
pub struct ClaudeStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub delta: Option<ClaudeStreamDelta>,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeStreamDelta {
    #[serde(rename = "type")]
    pub delta_type: Option<String>,
    pub text: Option<String>,
}
