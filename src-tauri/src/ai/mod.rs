// AI Provider 统一模块

pub mod cancellation;
pub mod claude;
pub mod configurable; // 可配置 Provider
pub mod loader;
pub mod openai_compat;
pub mod qwen;
pub mod security; // URL 安全验证
pub mod stream;
pub mod traits;
pub mod types; // 配置文件加载器

use configurable::ConfigurableProvider;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::AppHandle;
use tokio::sync::watch;
use traits::AIProvider;
use types::{ChatMessage, ConnectionTestResult, ProviderConfig, ProviderDescriptor, ProviderMeta};

/// 内置 Provider 类型枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinProviderType {
    Qwen,
    OpenAICompat,
    Claude,
}

/// Provider 类型（兼容前端字符串格式）
pub type ProviderType = BuiltinProviderType;

/// Provider 注册表——管理所有可用 Provider 实例
/// 支持内置 Provider 和动态加载的 Provider
pub struct ProviderRegistry {
    /// 内置 Provider（枚举派发，零开销）
    qwen: qwen::QwenProvider,
    openai_compat: openai_compat::OpenAICompatProvider,
    claude: claude::ClaudeProvider,
    /// 动态 Provider（配置/插件加载）
    dynamic: RwLock<HashMap<String, configurable::ConfigurableProvider>>,
}

impl Clone for ProviderRegistry {
    fn clone(&self) -> Self {
        let dynamic_clone = match self.dynamic.read() {
            Ok(map) => map.clone(),
            Err(poisoned) => {
                tracing::warn!("ProviderRegistry clone 时锁已中毒，使用中毒数据恢复");
                poisoned.into_inner().clone()
            }
        };
        Self {
            qwen: self.qwen.clone(),
            openai_compat: self.openai_compat.clone(),
            claude: self.claude.clone(),
            dynamic: RwLock::new(dynamic_clone),
        }
    }
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            qwen: qwen::QwenProvider::new(),
            openai_compat: openai_compat::OpenAICompatProvider::new(),
            claude: claude::ClaudeProvider::new(),
            dynamic: RwLock::new(HashMap::new()),
        }
    }

    /// 非流式聊天 - 内部派发
    pub async fn chat(
        &self,
        provider_type: &BuiltinProviderType,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, traits::AIError> {
        match provider_type {
            BuiltinProviderType::Qwen => self.qwen.chat(config, model, messages).await,
            BuiltinProviderType::OpenAICompat => {
                self.openai_compat.chat(config, model, messages).await
            }
            BuiltinProviderType::Claude => self.claude.chat(config, model, messages).await,
        }
    }

    /// 流式聊天 - 内部派发
    pub async fn chat_stream(
        &self,
        app: AppHandle,
        provider_type: &BuiltinProviderType,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
        event_name: &str,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<bool, traits::AIError> {
        match provider_type {
            BuiltinProviderType::Qwen => {
                self.qwen
                    .chat_stream(app, config, model, messages, event_name, cancel_rx)
                    .await
            }
            BuiltinProviderType::OpenAICompat => {
                self.openai_compat
                    .chat_stream(app, config, model, messages, event_name, cancel_rx)
                    .await
            }
            BuiltinProviderType::Claude => {
                self.claude
                    .chat_stream(app, config, model, messages, event_name, cancel_rx)
                    .await
            }
        }
    }

    /// 连通性测试 - 内部派发
    pub async fn test_connection(
        &self,
        provider_type: &BuiltinProviderType,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, traits::AIError> {
        match provider_type {
            BuiltinProviderType::Qwen => self.qwen.test_connection(config).await,
            BuiltinProviderType::OpenAICompat => self.openai_compat.test_connection(config).await,
            BuiltinProviderType::Claude => self.claude.test_connection(config).await,
        }
    }

    /// 获取默认模型列表 - 内部派发
    pub fn default_models(&self, provider_type: &BuiltinProviderType) -> Vec<types::ModelInfo> {
        match provider_type {
            BuiltinProviderType::Qwen => self.qwen.default_models(),
            BuiltinProviderType::OpenAICompat => self.openai_compat.default_models(),
            BuiltinProviderType::Claude => self.claude.default_models(),
        }
    }

    /// 列出所有可用 Provider 的元信息
    pub fn list_providers(&self) -> Vec<ProviderMeta> {
        let mut result = vec![
            ProviderMeta {
                id: "qwen".into(),
                name: "阿里云千问 (DashScope)".into(),
                description: Some("阿里云大模型平台，支持 qwen 系列模型".into()),
                provider_type: "qwen".into(),
                default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
                supports_custom_url: true,
                models: self.qwen.default_models(),
                is_builtin: true,
            },
            ProviderMeta {
                id: "openai_compat".into(),
                name: "OpenAI 兼容接口".into(),
                description: Some("支持 OpenAI、DeepSeek、Ollama 等兼容接口".into()),
                provider_type: "openai_compat".into(),
                default_base_url: "https://api.openai.com/v1".into(),
                supports_custom_url: true,
                models: self.openai_compat.default_models(),
                is_builtin: true,
            },
            ProviderMeta {
                id: "claude".into(),
                name: "Anthropic Claude".into(),
                description: Some("Anthropic Claude API".into()),
                provider_type: "claude".into(),
                default_base_url: "https://api.anthropic.com".into(),
                supports_custom_url: true,
                models: self.claude.default_models(),
                is_builtin: true,
            },
        ];

        // 添加动态 Provider
        if let Ok(dynamic) = self.dynamic.read() {
            for (id, provider) in dynamic.iter() {
                result.push(ProviderMeta {
                    id: id.clone(),
                    name: provider.descriptor().name.clone(),
                    description: provider.descriptor().description.clone(),
                    provider_type: format!("dynamic:{}", id),
                    default_base_url: provider.descriptor().base_url.clone(),
                    supports_custom_url: provider.descriptor().supports_custom_url,
                    models: provider.default_models(),
                    is_builtin: false,
                });
            }
        }

        result
    }

    /// 注册动态 Provider
    pub fn register_dynamic(&self, descriptor: ProviderDescriptor) -> Result<(), String> {
        let id = descriptor.id.clone();
        let provider = configurable::ConfigurableProvider::new(descriptor);

        let mut dynamic = self
            .dynamic
            .write()
            .map_err(|e| format!("锁获取失败: {}", e))?;

        if dynamic.contains_key(&id) {
            return Err(format!("Provider '{}' 已存在", id));
        }

        dynamic.insert(id.clone(), provider);
        tracing::info!(provider_id = %id, "动态 Provider 注册成功");
        Ok(())
    }

    /// 注销动态 Provider
    pub fn unregister_dynamic(&self, id: &str) -> Result<(), String> {
        let mut dynamic = self
            .dynamic
            .write()
            .map_err(|e| format!("锁获取失败: {}", e))?;

        dynamic
            .remove(id)
            .ok_or_else(|| format!("Provider '{}' 不存在", id))?;

        tracing::info!(provider_id = %id, "动态 Provider 注销成功");
        Ok(())
    }

    /// 动态 Provider 聊天（非流式）
    pub async fn chat_dynamic(
        &self,
        provider_id: &str,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, traits::AIError> {
        // 在锁内 clone Provider，释放锁后再 await，避免跨 await 持有读锁
        let provider = {
            let dynamic = self
                .dynamic
                .read()
                .map_err(|e| traits::AIError::Config(format!("锁获取失败: {}", e)))?;
            dynamic
                .get(provider_id)
                .ok_or_else(|| {
                    traits::AIError::Config(format!("Provider '{}' 不存在", provider_id))
                })?
                .clone()
        };

        provider.chat(config, model, messages).await
    }

    /// 动态 Provider 聊天（流式）
    pub async fn chat_stream_dynamic(
        &self,
        app: AppHandle,
        provider_id: &str,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
        event_name: &str,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<bool, traits::AIError> {
        // 先获取 provider 的克隆
        let provider = {
            let dynamic = self
                .dynamic
                .read()
                .map_err(|e| traits::AIError::Config(format!("锁获取失败: {}", e)))?;
            // 从 guard 中获取 provider 指针
            dynamic.get(provider_id).map(|p| {
                Box::new(ConfigurableProvider::new(p.descriptor().clone()))
                    as Box<dyn AIProvider + Send + Sync>
            })
        };

        let provider = provider
            .ok_or_else(|| traits::AIError::Config(format!("Provider '{}' 不存在", provider_id)))?;

        // 现在可以安全地 await
        provider
            .chat_stream(app, config, model, messages, event_name, cancel_rx)
            .await
    }

    /// 动态 Provider 连通性测试
    pub async fn test_connection_dynamic(
        &self,
        provider_id: &str,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, traits::AIError> {
        // 先获取 provider 的克隆
        let provider = {
            let dynamic = self
                .dynamic
                .read()
                .map_err(|e| traits::AIError::Config(format!("锁获取失败: {}", e)))?;
            // 从 guard 中获取 provider 指针
            dynamic.get(provider_id).map(|p| {
                Box::new(ConfigurableProvider::new(p.descriptor().clone()))
                    as Box<dyn AIProvider + Send + Sync>
            })
        };

        let provider = provider
            .ok_or_else(|| traits::AIError::Config(format!("Provider '{}' 不存在", provider_id)))?;

        // 现在可以安全地 await
        provider.test_connection(config).await
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
