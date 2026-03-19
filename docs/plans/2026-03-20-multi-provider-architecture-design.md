# 多 AI Provider 统一架构设计方案

> **版本**: v1.0  
> **日期**: 2026-03-20  
> **范围**: TODO #15 ~ #22（统一 Provider 接口 → 前端多 Provider 适配）

---

## 一、设计目标

| 维度 | 目标 |
|------|------|
| **可维护** | Trait 抽象 + 模块隔离，新增 Provider 只需实现接口 + 注册，零侵入现有逻辑 |
| **性能** | 零成本抽象（Rust enum dispatch 替代 dyn trait），流式链路复用，HTTP 客户端池化 |
| **可扩展** | 支持自定义 Base URL、自定义模型列表、Provider 级配置热切换 |

---

## 二、现有架构概要

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (React/TypeScript)                                        │
│  App.tsx → aiChat.ts → invoke('qwen_chat_stream')               │
│                         listen('qwen-stream')                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Tauri IPC
┌──────────────────────────▼──────────────────────────────────────┐
│  Rust 后端                                                       │
│  commands.rs → qwen.rs → reqwest SSE → app.emit("qwen-stream")  │
└─────────────────────────────────────────────────────────────────┘
```

**痛点**：`qwen.rs` 直接硬编码 DashScope URL、请求格式、模型列表；`commands.rs` 命令名绑定 `qwen_*`；前端 `aiChat.ts` 函数名/事件名均与千问耦合。

---

## 三、整体架构设计

### 3.1 后端模块拓扑（重构后）

```
src-tauri/src/
├── ai/                          # 新模块：AI Provider 统一层
│   ├── mod.rs                   # 模块入口 + Provider 枚举 + 工厂
│   ├── traits.rs                # AIProvider trait 定义 + AIError
│   ├── types.rs                 # 共享类型（ChatMessage, StreamEvent 等）
│   ├── stream.rs                # 通用 SSE 流式解析器
│   ├── qwen.rs                  # QwenProvider 实现（从现有 qwen.rs 迁移）
│   ├── openai_compat.rs         # OpenAI 兼容接口 Provider
│   └── claude.rs                # Claude Provider（原生 API）
├── commands.rs                  # 统一命令层（ai_chat / ai_chat_stream）
├── qwen.rs                      # 保留：截图视觉专用逻辑（chat_stream_vision）
├── lib.rs                       # 注册 ProviderRegistry 到 app.manage()
└── ...（其他模块不变）
```

### 3.2 前端模块拓扑（重构后）

```
src/
├── services/
│   ├── aiChat.ts                # 重构：统一 sendStream() 入口
│   └── providerRegistry.ts      # 新增：Provider 元数据（模型列表、配置项描述）
├── store/
│   └── config.ts                # 扩展：ProviderConfig 类型 + 多 Provider 存储
├── components/
│   ├── SettingsPanel.tsx         # 重构：动态 Provider 配置区
│   └── ProviderSelector.tsx      # 新增：Provider 切换 + 连通性测试
└── ...
```

---

## 四、后端详细设计

### 4.1 核心 Trait 定义（`ai/traits.rs`）

```rust
use async_trait::async_trait;
use tauri::AppHandle;
use crate::ai::types::{ChatMessage, ProviderConfig};

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
    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<(), AIError>;

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
```

**设计要点**：

- `config: &ProviderConfig` 作为参数传入而非构造时绑定——支持用户随时切换 API Key / Base URL 而无需重建实例
- `test_connection` 独立方法——发送极小请求（如 `max_tokens=1`）验证凭证有效性，不消耗大量 token
- `default_models` 返回元信息——前端据此渲染模型下拉列表

### 4.2 共享类型（`ai/types.rs`）

```rust
use serde::{Deserialize, Serialize};

/// Provider 运行时配置（从前端传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: Option<String>,       // 自定义 Base URL（私有化部署）
    pub extra: Option<serde_json::Value>, // Provider 专属扩展字段
}

/// 聊天消息（已有，保持不变）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 流式事件（已有，保持不变）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub content: String,
    pub done: bool,
}

/// 模型元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,            // "qwen-max", "gpt-4o", "claude-sonnet-4-20250514"
    pub name: String,          // 显示名称
    pub description: String,   // 一句话描述
    pub supports_vision: bool, // 是否支持图片输入
}

/// 连通性测试结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub model_used: String,
    pub message: String,
}

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
```

### 4.3 通用 SSE 流式解析器（`ai/stream.rs`）

将现有 `qwen.rs` 中的 `stream_response()` 提取为参数化的通用版本：

```rust
use futures_util::StreamExt;
use tauri::Emitter;

/// 通用 OpenAI 兼容 SSE 流式解析
///
/// 适用于所有返回 `data: {"choices":[{"delta":{"content":"..."}}]}` 格式的 Provider
/// （DashScope / OpenAI / DeepSeek / Ollama / vLLM 等）
pub async fn parse_openai_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    event_name: &str,
) -> Result<(), AIError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AIError::StreamParse(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() { continue; }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str.trim() == "[DONE]" {
                    let _ = app.emit(event_name, StreamEvent {
                        content: String::new(),
                        done: true,
                    });
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<OpenAIStreamChunk>(json_str) {
                    if let Some(content) = chunk.choices.first()
                        .and_then(|c| c.delta.content.as_ref())
                    {
                        let _ = app.emit(event_name, StreamEvent {
                            content: content.clone(),
                            done: false,
                        });
                    }
                }
            }
        }
    }

    // 流正常结束但未收到 [DONE]（兼容某些 Provider）
    let _ = app.emit(event_name, StreamEvent {
        content: String::new(),
        done: true,
    });
    Ok(())
}

/// Claude SSE 流式解析（Anthropic 使用不同的 SSE 事件格式）
///
/// Claude 格式：
///   event: content_block_delta
///   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
///   
///   event: message_stop
///   data: {"type":"message_stop"}
pub async fn parse_claude_sse_stream(
    app: &AppHandle,
    response: reqwest::Response,
    event_name: &str,
) -> Result<(), AIError> {
    // Claude 专用解析逻辑
    // ...
}
```

**性能要点**：流式解析器是热路径，避免不必要的内存分配——复用 buffer，按行解析而非全量读取。

### 4.4 Provider 注册表（`ai/mod.rs`）

**关键设计决策**：使用 **枚举派发（enum dispatch）** 替代 `Box<dyn AIProvider>`。

```rust
pub mod traits;
pub mod types;
pub mod stream;
pub mod qwen;
pub mod openai_compat;
pub mod claude;

use types::ProviderConfig;

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

    /// 根据类型获取 Provider 引用
    pub fn get(&self, provider_type: &ProviderType) -> &dyn traits::AIProvider {
        match provider_type {
            ProviderType::Qwen => &self.qwen,
            ProviderType::OpenAICompat => &self.openai_compat,
            ProviderType::Claude => &self.claude,
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
```

### 4.5 QwenProvider 实现（`ai/qwen.rs`）——从现有代码迁移

```rust
use crate::ai::{traits::*, types::*, stream::parse_openai_sse_stream};

pub struct QwenProvider;

impl QwenProvider {
    pub fn new() -> Self { Self }

    /// DashScope 默认 Base URL
    fn base_url(config: &ProviderConfig) -> String {
        config.base_url.clone()
            .unwrap_or_else(|| "https://dashscope.aliyuncs.com/compatible-mode/v1".into())
    }
}

#[async_trait]
impl AIProvider for QwenProvider {
    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<(), AIError> {
        let url = format!("{}/chat/completions", Self::base_url(config));
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| AIError::Network(e.to_string()))?;

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
            .map_err(|e| {
                if e.is_timeout() { AIError::Timeout }
                else if e.is_connect() { AIError::Network(e.to_string()) }
                else { AIError::Network(e.to_string()) }
            })?;

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

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| AIError::Network(e.to_string()))?;

        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| AIError::Network(e.to_string()))?;

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
            ModelInfo { id: "qwen-turbo".into(), name: "Qwen Turbo".into(),
                description: "快速响应，适合简单任务".into(), supports_vision: false },
            ModelInfo { id: "qwen-plus".into(), name: "Qwen Plus".into(),
                description: "平衡性能与质量".into(), supports_vision: false },
            ModelInfo { id: "qwen-max".into(), name: "Qwen Max".into(),
                description: "最强推理能力".into(), supports_vision: false },
            ModelInfo { id: "qwen-coder-plus".into(), name: "Qwen Coder Plus".into(),
                description: "编程优化模型".into(), supports_vision: false },
            ModelInfo { id: "qwen-vl-max".into(), name: "Qwen VL Max".into(),
                description: "视觉理解模型".into(), supports_vision: true },
        ]
    }

    fn id(&self) -> &'static str { "qwen" }
    fn display_name(&self) -> &'static str { "阿里云千问" }

    // chat() 实现类似，省略
    async fn chat(&self, config: &ProviderConfig, model: &str,
        messages: Vec<ChatMessage>) -> Result<String, AIError> { todo!() }
}
```

### 4.6 OpenAI 兼容 Provider（`ai/openai_compat.rs`）

这是最通用的 Provider——覆盖 GPT-5、DeepSeek、本地 Ollama、vLLM、Claude Code 等所有支持 OpenAI 格式的服务。

```rust
pub struct OpenAICompatProvider;

#[async_trait]
impl AIProvider for OpenAICompatProvider {
    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<(), AIError> {
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".into());
        let url = format!("{}/chat/completions", base_url);

        // 请求结构与千问完全一致（OpenAI 兼容格式）
        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true
        });

        let response = create_client(120)?
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send().await
            .map_err(map_reqwest_error)?;

        handle_error_status(&response)?;

        // 复用同一个 SSE 解析器
        parse_openai_sse_stream(&app, response, "ai-stream").await
    }

    fn default_models(&self) -> Vec<ModelInfo> {
        vec![
            // 预置常用模型，用户可通过配置自定义追加
            ModelInfo { id: "gpt-4o".into(), name: "GPT-4o".into(), .. },
            ModelInfo { id: "gpt-4o-mini".into(), name: "GPT-4o Mini".into(), .. },
            ModelInfo { id: "deepseek-chat".into(), name: "DeepSeek Chat".into(), .. },
            ModelInfo { id: "deepseek-reasoner".into(), name: "DeepSeek R1".into(), .. },
        ]
    }

    fn id(&self) -> &'static str { "openai_compat" }
    fn display_name(&self) -> &'static str { "OpenAI 兼容" }
    // ...
}
```

**用户切换不同 Base URL 即可接入**：

| 服务 | Base URL |
|------|----------|
| OpenAI 官方 | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 本地 Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| 其他兼容服务 | 用户自定义 |

### 4.7 Claude Provider（`ai/claude.rs`）

Anthropic 使用独立 API 格式，需要专用实现：

```rust
pub struct ClaudeProvider;

#[async_trait]
impl AIProvider for ClaudeProvider {
    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<(), AIError> {
        let base_url = config.base_url.clone()
            .unwrap_or_else(|| "https://api.anthropic.com".into());
        let url = format!("{}/v1/messages", base_url);

        // Claude 使用不同的请求格式
        // 需要将 system message 从 messages 中提取出来
        let (system_msg, user_messages) = extract_system_message(&messages);

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": 8192,
            "messages": user_messages,
            "stream": true
        });

        if let Some(sys) = system_msg {
            body["system"] = serde_json::Value::String(sys);
        }

        let response = create_client(120)?
            .post(&url)
            .header("x-api-key", &config.api_key)            // Claude 用 x-api-key
            .header("anthropic-version", "2023-06-01")         // 必须指定 API 版本
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await
            .map_err(map_reqwest_error)?;

        handle_error_status(&response)?;

        // Claude 专用 SSE 解析器
        parse_claude_sse_stream(&app, response, "ai-stream").await
    }

    fn default_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo { id: "claude-sonnet-4-20250514".into(), name: "Claude Sonnet 4".into(), .. },
            ModelInfo { id: "claude-opus-4-20250514".into(), name: "Claude Opus 4".into(), .. },
            ModelInfo { id: "claude-haiku-3-5-20241022".into(), name: "Claude 3.5 Haiku".into(), .. },
        ]
    }

    fn id(&self) -> &'static str { "claude" }
    fn display_name(&self) -> &'static str { "Anthropic Claude" }
}
```

### 4.8 统一命令层（`commands.rs` 重构）

```rust
use crate::ai::{ProviderType, ProviderRegistry, types::*};

/// 统一流式聊天命令——替代原有的 qwen_chat_stream
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,          // "qwen" | "openai_compat" | "claude"
    config: ProviderConfig,          // { api_key, base_url?, extra? }
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let provider_impl = registry.get(&provider);
    provider_impl
        .chat_stream(app, &config, &model, messages)
        .await
        .map_err(|e| e.to_string())
}

/// 统一非流式聊天
#[tauri::command]
pub async fn ai_chat(
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let provider_impl = registry.get(&provider);
    provider_impl
        .chat(&config, &model, messages)
        .await
        .map_err(|e| e.to_string())
}

/// 连通性测试
#[tauri::command]
pub async fn ai_test_connection(
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
) -> Result<ConnectionTestResult, String> {
    let provider_impl = registry.get(&provider);
    provider_impl
        .test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

/// 获取可用 Provider 列表
#[tauri::command]
pub fn ai_list_providers(
    registry: State<'_, ProviderRegistry>,
) -> Vec<ProviderMeta> {
    registry.list_providers()
}

// ═══════ 向下兼容：保留原有截图视觉命令 ═══════

/// 截图识别仍走千问专用逻辑（qwen-vl-max 独占能力）
#[tauri::command]
pub async fn qwen_chat_stream_vision(
    app: AppHandle,
    api_key: String,
    image_base64: String,
    prompt: String,
    repo_urls: Vec<String>,
    local_doc_path: Option<String>,
) -> Result<(), String> {
    // 保持现有实现不变
    crate::qwen::chat_stream_vision(app, &api_key, &image_base64, &prompt, repo_urls, local_doc_path).await
}
```

### 4.9 应用入口注册（`lib.rs` 改动）

```rust
use crate::ai::ProviderRegistry;

pub fn run() {
    tauri::Builder::default()
        // ... 现有插件
        .setup(|app| {
            // 现有：数据库初始化
            let db = database::init_database(&app_data_dir)?;
            app.manage(db);

            // 新增：Provider 注册表
            app.manage(ProviderRegistry::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 新增：统一 AI 命令
            commands::ai_chat,
            commands::ai_chat_stream,
            commands::ai_test_connection,
            commands::ai_list_providers,
            // 保留：截图视觉（千问专用）
            commands::qwen_chat_stream_vision,
            // 保留：其他原有命令
            commands::qwen_chat,              // 过渡期保留，标记 deprecated
            commands::qwen_chat_stream,       // 过渡期保留，标记 deprecated
            // ...
        ])
        .run(tauri::generate_context!())
}
```

---

## 五、前端详细设计

### 5.1 配置类型扩展（`config.ts`）

```typescript
// ═══════ 新增类型 ═══════

export type ProviderType = 'qwen' | 'openai_compat' | 'claude';

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;             // 自定义 Base URL
  model: string;                // 当前选中的模型
  customModels?: string[];      // 用户自定义模型 ID 列表
}

// ═══════ 扩展 AppConfig ═══════

export interface AppConfig {
  // 新增：多 Provider 配置
  activeProvider: ProviderType;                       // 当前激活的 Provider
  providerConfigs: Record<ProviderType, ProviderConfig>;  // 每个 Provider 独立配置

  // 保留：与 Provider 无关的配置
  promptTemplateId: string;
  customPrompt: string;
  nlsAppKey: string;
  nlsAccessKeyId: string;
  nlsAccessKeySecret: string;
  nlsRegion: string;
  highQualityRepoUrls: string;
  localDocPath: string;
  shortcutConfig: ShortcutConfig;
  window: WindowConfig;

  // 废弃（过渡期保留，兼容旧配置迁移）
  /** @deprecated 使用 providerConfigs.qwen.apiKey */
  apiKey?: string;
  /** @deprecated 使用 providerConfigs.qwen.model */
  model?: string;
}
```

**配置迁移策略**（`loadConfig()` 中处理）：

```typescript
function migrateConfig(raw: any): AppConfig {
  // 如果是旧配置格式（存在顶层 apiKey），自动迁移
  if (raw.apiKey && !raw.providerConfigs) {
    return {
      ...raw,
      activeProvider: 'qwen',
      providerConfigs: {
        qwen: {
          apiKey: raw.apiKey,
          model: raw.model || 'qwen-plus',
        },
        openai_compat: { apiKey: '', model: 'gpt-4o' },
        claude: { apiKey: '', model: 'claude-sonnet-4-20250514' },
      },
    };
  }
  return raw as AppConfig;
}
```

### 5.2 AI 服务层重构（`aiChat.ts`）

```typescript
// ═══════ 统一入口 ═══════

/**
 * 统一流式聊天——根据 config.activeProvider 自动路由到对应后端 Provider
 */
export async function sendStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
  history: ChatMessage[] = [],
): Promise<void> {
  const provider = config.activeProvider;
  const providerConfig = config.providerConfigs[provider];

  if (!providerConfig.apiKey) {
    throw new Error(`请先配置 ${provider} 的 API Key`);
  }

  const systemPrompt = getSystemPrompt(config);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  await streamWithEvent(
    'ai_chat_stream',   // 统一命令名
    {
      provider,
      config: {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl || null,
      },
      model: providerConfig.model,
      messages,
    },
    onChunk,
  );
}

// ═══════ 通用流式事件处理（从现有代码复用） ═══════

async function streamWithEvent(
  invokeCommand: string,
  invokeArgs: Record<string, unknown>,
  onChunk: (content: string, done: boolean) => void,
): Promise<void> {
  // 事件名从 "qwen-stream" 统一为 "ai-stream"
  const EVENT_NAME = 'ai-stream';
  // ... 其余逻辑保持不变（字符队列 + 30ms 节流）
}

// ═══════ 向下兼容：截图识别仍走千问专用通道 ═══════

export async function sendToQwenStreamWithImage(
  prompt: string,
  imageBase64: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
): Promise<void> {
  // 保持不变，仍调用 qwen_chat_stream_vision
}
```

### 5.3 设置面板 UI 重构（`SettingsPanel.tsx`）

核心交互流程：

```
┌──────────────────────────────────────────────────┐
│  AI 模型设置                                       │
├──────────────────────────────────────────────────┤
│                                                    │
│  模型提供商：  [▼ 阿里云千问 (DashScope) ]          │
│                                                    │
│  ┌─── 动态配置区（根据选中 Provider 切换） ───┐      │
│  │                                              │    │
│  │  API Key:     [*************]  [👁]           │    │
│  │  Base URL:    [https://dashscope...]  (可选)  │    │
│  │  模型:        [▼ Qwen Plus          ]         │    │
│  │  自定义模型:  [输入模型ID，回车添加]    (可选) │    │
│  │                                              │    │
│  │  [ 🔌 测试连接 ]     ← 一键连通性测试          │    │
│  │  ✅ 连接成功，延迟 156ms                       │    │
│  │                                              │    │
│  └──────────────────────────────────────────────┘    │
│                                                    │
│  ────── Prompt 设置 ──────                          │
│  模板:  [▼ 通用面试助手]                             │
│  自定义: [                ]                          │
│                                                    │
│  ────── 语音识别 (NLS) ──────                       │
│  ...（保持不变）                                     │
│                                                    │
├──────────────────────────────────────────────────┤
│  [ 保存设置 ]                                       │
└──────────────────────────────────────────────────┘
```

**Provider 切换逻辑**：

```tsx
const [activeProvider, setActiveProvider] = useState<ProviderType>(config.activeProvider);
const [providerConfigs, setProviderConfigs] = useState(config.providerConfigs);

// 切换 Provider 时保留所有 Provider 的独立配置
const handleProviderChange = (newProvider: ProviderType) => {
  setActiveProvider(newProvider);
  // 不清除其他 Provider 的配置——用户切回时仍保留
};

// 当前 Provider 的配置编辑
const currentConfig = providerConfigs[activeProvider];
```

**连通性测试按钮**：

```tsx
const handleTestConnection = async () => {
  setTesting(true);
  setTestResult(null);
  try {
    const result = await invoke<ConnectionTestResult>('ai_test_connection', {
      provider: activeProvider,
      config: {
        apiKey: currentConfig.apiKey,
        baseUrl: currentConfig.baseUrl || null,
      },
    });
    setTestResult(result);
  } catch (e) {
    setTestResult({ success: false, message: String(e), latency_ms: 0 });
  } finally {
    setTesting(false);
  }
};
```

---

## 六、事件名与向下兼容策略

| 阶段 | 事件名 | 命令名 | 说明 |
|------|--------|--------|------|
| 现有 | `qwen-stream` | `qwen_chat_stream` | 千问专用 |
| 重构后 | `ai-stream` | `ai_chat_stream` | 统一入口 |
| 过渡期 | 两者并存 | 两者并存 | 旧命令标记 `#[deprecated]`，6 个月后移除 |
| 截图视觉 | `qwen-stream` | `qwen_chat_stream_vision` | 保持不变（千问专属能力） |

---

## 七、性能设计

### 7.1 HTTP 客户端池化

```rust
/// 全局共享 HTTP 客户端（连接池复用）
lazy_static! {
    static ref HTTP_CLIENT: reqwest::Client = reqwest::Client::builder()
        .pool_max_idle_per_host(5)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .expect("Failed to create HTTP client");
}
```

每个 Provider 共享同一个客户端实例，避免重复创建 TCP 连接。

### 7.2 流式链路零拷贝

- SSE 解析器中 buffer 原地裁剪，避免 `clone()`
- `StreamEvent` 直接序列化发送，不做中间转换
- 前端字符队列 30ms 节流不变（已经是最佳实践）

### 7.3 连通性测试轻量化

- 使用 `max_tokens: 1` 限制响应，几乎不消耗 token
- 独立超时 15 秒（不影响正常对话的 120 秒超时）
- 不走流式通道，直接返回结果

---

## 八、扩展性设计

### 8.1 新增 Provider 的步骤（开发者指南）

只需 3 步：

1. **创建文件** `ai/new_provider.rs`，实现 `AIProvider` trait
2. **注册到枚举** `ProviderType` 新增 variant，`ProviderRegistry` 新增字段和 `get()` 分支
3. **前端配置** `providerRegistry.ts` 添加元数据（名称、默认 URL、模型列表）

无需修改 `commands.rs`、`aiChat.ts`、`App.tsx` 中的任何业务逻辑。

### 8.2 自定义模型支持

用户可在设置面板手动输入模型 ID，存储在 `ProviderConfig.customModels` 中。前端下拉列表合并 `defaultModels + customModels` 渲染。

### 8.3 Provider 专属扩展字段

`ProviderConfig.extra: serde_json::Value` 支持 Provider 特有的配置：

```json
// Claude 专属
{ "extra": { "anthropic_version": "2023-06-01", "max_tokens": 8192 } }

// Ollama 专属
{ "extra": { "num_ctx": 4096, "temperature": 0.7 } }
```

---

## 九、实施路径（分 Task 执行）

| Task | 内容 | 改动文件 | 依赖 |
|------|------|----------|------|
| T1 | 创建 `ai/` 模块骨架：traits.rs, types.rs, stream.rs, mod.rs | 新建 4 文件 | 无 |
| T2 | 迁移现有千问逻辑为 `QwenProvider` | ai/qwen.rs + 旧 qwen.rs | T1 |
| T3 | 实现 `OpenAICompatProvider` | ai/openai_compat.rs | T1 |
| T4 | 实现 `ClaudeProvider` | ai/claude.rs | T1 |
| T5 | 重构 `commands.rs` 为统一命令层 | commands.rs + lib.rs | T1, T2 |
| T6 | 前端 `config.ts` 扩展 + 配置迁移 | config.ts | 无 |
| T7 | 前端 `aiChat.ts` 适配统一接口 | aiChat.ts | T5, T6 |
| T8 | 设置面板 UI 重构 + Provider 选择 + 连通性测试 | SettingsPanel.tsx, ProviderSelector.tsx | T5, T6, T7 |
| T9 | 端到端集成测试 | 全链路 | T1~T8 |

```
T1 ──→ T2 ──→ T5 ──→ T7 ──→ T8 ──→ T9
  ├──→ T3 ──┘         ↑
  └──→ T4 ──┘    T6 ──┘
```

T1/T6 可并行，T2/T3/T4 可并行，T7/T8 依赖前置完成后可并行。

---

## 十、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Claude SSE 格式差异 | 流式解析失败 | 独立 `parse_claude_sse_stream` 解析器 |
| 旧配置丢失 | 用户升级后配置清空 | `migrateConfig()` 自动迁移 + 旧字段保留 |
| 截图视觉耦合千问 | 切换 Provider 后截图失效 | 截图视觉保持独立通道，始终使用千问 VL |
| Provider API 变更 | 调用失败 | `extra` 扩展字段适配 + 版本号显式指定 |
| 本地模型连接不稳定 | 超时频繁 | Provider 级超时配置，本地模型可设更长超时 |
