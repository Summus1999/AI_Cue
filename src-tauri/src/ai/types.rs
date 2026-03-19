// AI Provider 共享类型定义

use serde::{Deserialize, Serialize};

/// Provider 运行时配置（从前端传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: Option<String>,       // 自定义 Base URL（私有化部署）
    pub extra: Option<serde_json::Value>, // Provider 专属扩展字段
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
    pub provider_type: super::ProviderType,
    pub default_base_url: String,
    pub supports_custom_url: bool,
    pub models: Vec<ModelInfo>,
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
