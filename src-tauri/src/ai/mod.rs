// AI Provider 统一模块

pub mod traits;
pub mod types;
pub mod stream;
pub mod qwen;
pub mod openai_compat;
pub mod claude;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use traits::AIProvider;
use types::{ChatMessage, ConnectionTestResult, ProviderConfig, ProviderMeta};

/// Provider 枚举——编译期确定的有限集合，零成本派发
///
/// 为什么不用 dyn trait？
/// 1. 桌面应用 Provider 数量有限（3~5 个），枚举完全够用
/// 2. enum dispatch 无虚表开销，编译器可内联优化
/// 3. 模式匹配强制处理所有变体，新增 Provider 时编译器提醒所有遗漏
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    Qwen,
    OpenAICompat,
    Claude,
}

/// Provider 注册表——管理所有可用 Provider 实例
/// 直接在注册表上实现方法，避免 dyn trait 的对象安全问题
pub struct ProviderRegistry {
    qwen: qwen::QwenProvider,
    openai_compat: openai_compat::OpenAICompatProvider,
    claude: claude::ClaudeProvider,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            qwen: qwen::QwenProvider::new(),
            openai_compat: openai_compat::OpenAICompatProvider::new(),
            claude: claude::ClaudeProvider::new(),
        }
    }

    /// 非流式聊天 - 内部派发
    pub async fn chat(
        &self,
        provider_type: &ProviderType,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, traits::AIError> {
        match provider_type {
            ProviderType::Qwen => self.qwen.chat(config, model, messages).await,
            ProviderType::OpenAICompat => self.openai_compat.chat(config, model, messages).await,
            ProviderType::Claude => self.claude.chat(config, model, messages).await,
        }
    }

    /// 流式聊天 - 内部派发
    pub async fn chat_stream(
        &self,
        app: AppHandle,
        provider_type: &ProviderType,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<(), traits::AIError> {
        match provider_type {
            ProviderType::Qwen => self.qwen.chat_stream(app, config, model, messages).await,
            ProviderType::OpenAICompat => self.openai_compat.chat_stream(app, config, model, messages).await,
            ProviderType::Claude => self.claude.chat_stream(app, config, model, messages).await,
        }
    }

    /// 连通性测试 - 内部派发
    pub async fn test_connection(
        &self,
        provider_type: &ProviderType,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, traits::AIError> {
        match provider_type {
            ProviderType::Qwen => self.qwen.test_connection(config).await,
            ProviderType::OpenAICompat => self.openai_compat.test_connection(config).await,
            ProviderType::Claude => self.claude.test_connection(config).await,
        }
    }

    /// 获取默认模型列表 - 内部派发
    pub fn default_models(&self, provider_type: &ProviderType) -> Vec<types::ModelInfo> {
        match provider_type {
            ProviderType::Qwen => self.qwen.default_models(),
            ProviderType::OpenAICompat => self.openai_compat.default_models(),
            ProviderType::Claude => self.claude.default_models(),
        }
    }

    /// 列出所有可用 Provider 的元信息
    pub fn list_providers(&self) -> Vec<ProviderMeta> {
        vec![
            ProviderMeta {
                id: "qwen".into(),
                name: "阿里云千问 (DashScope)".into(),
                provider_type: ProviderType::Qwen,
                default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
                supports_custom_url: true,
                models: self.qwen.default_models(),
            },
            ProviderMeta {
                id: "openai_compat".into(),
                name: "OpenAI 兼容接口".into(),
                provider_type: ProviderType::OpenAICompat,
                default_base_url: "https://api.openai.com/v1".into(),
                supports_custom_url: true,
                models: self.openai_compat.default_models(),
            },
            ProviderMeta {
                id: "claude".into(),
                name: "Anthropic Claude".into(),
                provider_type: ProviderType::Claude,
                default_base_url: "https://api.anthropic.com".into(),
                supports_custom_url: true,
                models: self.claude.default_models(),
            },
        ]
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// HTTP 客户端创建辅助函数
pub fn create_http_client(timeout_secs: u64) -> Result<reqwest::Client, traits::AIError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| traits::AIError::Network(e.to_string()))
}

/// 将 reqwest 错误映射为 AIError
pub fn map_reqwest_error(e: reqwest::Error) -> traits::AIError {
    if e.is_timeout() {
        traits::AIError::Timeout
    } else if e.is_connect() {
        traits::AIError::Network(format!("连接失败: {}", e))
    } else {
        traits::AIError::Network(e.to_string())
    }
}
