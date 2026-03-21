// AI Provider Trait 定义 - 所有 AI Provider 必须实现的接口

use async_trait::async_trait;
use tauri::AppHandle;
use crate::ai::types::{ChatMessage, ConnectionTestResult, ModelInfo, ProviderConfig};

/// 统一错误类型
#[derive(Debug)]
pub enum AIError {
    Timeout,
    Network(String),
    Auth(String),              // 401/403
    RateLimit(String),         // 429
    Api(u16, String),          // 其他 HTTP 状态码
    InvalidRequest(String),
    StreamParse(String),
    Config(String),
}

impl std::fmt::Display for AIError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Timeout => write!(f, "请求超时，请检查网络连接"),
            Self::Network(e) => write!(f, "网络错误: {}", e),
            Self::Auth(e) => write!(f, "认证失败: {}", e),
            Self::RateLimit(e) => write!(f, "请求频率超限: {}", e),
            Self::Api(code, e) => write!(f, "API 错误 ({}): {}", code, e),
            Self::InvalidRequest(e) => write!(f, "请求格式错误: {}", e),
            Self::StreamParse(e) => write!(f, "流解析错误: {}", e),
            Self::Config(e) => write!(f, "配置错误: {}", e),
        }
    }
}

impl From<AIError> for String {
    fn from(e: AIError) -> String {
        e.to_string()
    }
}

/// 所有 AI Provider 必须实现的接口
#[async_trait]
pub trait AIProvider: Send + Sync {
    /// 非流式调用
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError>;

    /// 流式调用（通过 Tauri Event 推送）
    /// 返回: 流是否正常完成（true = 正常完成，false = 中断）
    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<bool, AIError>;

    /// 连通性测试（轻量级，用于设置页一键检测）
    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, AIError>;

    /// 该 Provider 支持的默认模型列表
    fn default_models(&self) -> Vec<ModelInfo>;

    /// Provider 标识符
    fn id(&self) -> &'static str;

    /// Provider 显示名称
    fn display_name(&self) -> &'static str;
}
