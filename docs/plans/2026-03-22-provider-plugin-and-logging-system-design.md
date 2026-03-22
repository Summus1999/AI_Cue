# Provider 插件规范与日志系统架构设计

## 1. 概述

### 1.1 背景与动机

AI_Cue 当前采用枚举派发（enum dispatch）机制支持三个内置 AI Provider（Qwen、OpenAI兼容、Claude）。随着用户需求多样化，存在以下痛点：

1. **扩展性受限**：新增 Provider 需修改 Rust 代码并重新编译
2. **缺乏插件生态**：无法让社区贡献新的 Provider 适配器
3. **配置不灵活**：用户无法通过配置文件快速添加兼容型 Provider
4. **日志系统缺失**：仅依赖 `println!/console.log`，问题排查困难

### 1.2 设计目标

| 目标 | 具体要求 |
|------|---------|
| **可扩展** | 用户/社区可通过配置或插件添加新 Provider，无需重新编译 |
| **可维护** | 前后端统一规范，降低维护成本，代码结构清晰 |
| **高性能** | 内置 Provider 保持零开销枚举派发，插件 Provider 使用高效动态派发 |
| **安全** | API Key 加密存储、URL 白名单、插件沙箱隔离、日志脱敏 |

### 1.3 涉及需求

- **#49** - 设计前后端统一的 Provider 插件规范
- **#50** - 支持用户通过配置文件添加新模型提供商
- **#51** - 构建社区模型适配插件的加载与管理机制
- **#52** - 日志系统完善（用于问题排查，用户可导出日志）

### 1.4 术语定义

| 术语 | 定义 |
|------|------|
| **Built-in Provider** | 编译期内置的 Provider（Qwen、OpenAI兼容、Claude），使用枚举派发 |
| **Configurable Provider** | 通过 JSON 配置文件定义的 Provider，基于通用适配器实现 |
| **Plugin Provider** | 通过插件包（.aicue-plugin）安装的社区 Provider |
| **Provider Descriptor** | 描述 Provider 能力与配置的 JSON Schema |
| **SSE Format** | Server-Sent Events 流式响应格式（OpenAI/Claude 两种） |

---

## 2. 现有架构分析

### 2.1 当前 Provider 架构概要

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend (React)                       │
├─────────────────────────────────────────────────────────────┤
│  config.ts          │  aiChat.ts         │  providerRegistry │
│  ├─ PROVIDERS[]     │  ├─ sendStream()   │  ├─ getMeta()     │
│  ├─ PROVIDER_MODELS │  ├─ sendChat()     │  └─ getModels()   │
│  └─ AppConfig       │  └─ testConnection │                   │
└─────────────────────┼───────────────────────────────────────┘
                      │ Tauri IPC (invoke)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                       Backend (Rust)                         │
├─────────────────────────────────────────────────────────────┤
│  ProviderRegistry           │  AIProvider trait              │
│  ├─ qwen: QwenProvider      │  ├─ chat()                     │
│  ├─ openai: OpenAICompat    │  ├─ chat_stream()              │
│  └─ claude: ClaudeProvider  │  ├─ test_connection()          │
│                             │  └─ default_models()           │
├─────────────────────────────┴───────────────────────────────┤
│  ProviderType (enum)        │  Stream Parser                 │
│  ├─ Qwen                    │  ├─ parse_openai_sse_stream()  │
│  ├─ OpenAICompat            │  └─ parse_claude_sse_stream()  │
│  └─ Claude                  │                                │
└─────────────────────────────────────────────────────────────┘
```

**核心数据结构（当前）：**

```rust
// src-tauri/src/ai/types.rs
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: Option<String>,
    pub extra: Option<serde_json::Value>,
}

// src-tauri/src/ai/mod.rs
pub enum ProviderType {
    Qwen,
    OpenAICompat,
    Claude,
}
```

```typescript
// src/store/config.ts
export type ProviderType = 'qwen' | 'openai_compat' | 'claude';

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  customModels?: string[];
}
```

### 2.2 当前的限制与痛点

| 限制 | 影响 |
|------|------|
| **硬编码 ProviderType 枚举** | 新增 Provider 需修改 Rust 代码、重新编译发布 |
| **前端 PROVIDERS 数组静态定义** | Provider 元数据分散在前后端，不一致风险高 |
| **无插件加载机制** | 社区无法贡献新 Provider，生态受限 |
| **日志仅 println/console** | 生产环境问题排查困难，无日志持久化与导出 |
| **API Key 明文存储** | 配置文件中 API Key 无加密保护 |

---

## 3. 前后端统一 Provider 插件规范（#49）

### 3.1 插件规范概览

设计一套前后端共用的 Provider 描述规范，通过 JSON Schema 定义 Provider 的所有能力：

```
┌─────────────────────────────────────────────────────────────┐
│               Provider Descriptor (JSON)                     │
├─────────────────────────────────────────────────────────────┤
│  identity    │ id, name, version, author                    │
│  connection  │ baseUrl, authType, authHeader                │
│  protocol    │ sseFormat, requestTransform, responseTransform│
│  capabilities│ models[], supportsVision, supportsStreaming  │
│  healthCheck │ endpoint, expectedStatus                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Provider 插件描述符（JSON Schema）

#### 3.2.1 完整 JSON Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ai-cue.app/schemas/provider-descriptor.json",
  "title": "AI_Cue Provider Descriptor",
  "description": "定义 AI Provider 的能力、协议与配置",
  "type": "object",
  "required": ["id", "name", "version", "baseUrl", "authType", "sseFormat", "models"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]{2,31}$",
      "description": "Provider 唯一标识符，小写字母开头，3-32字符"
    },
    "name": {
      "type": "string",
      "maxLength": 64,
      "description": "Provider 显示名称"
    },
    "description": {
      "type": "string",
      "maxLength": 256,
      "description": "Provider 简要描述"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "语义化版本号"
    },
    "author": {
      "type": "string",
      "maxLength": 64,
      "description": "作者/维护者"
    },
    "homepage": {
      "type": "string",
      "format": "uri",
      "description": "Provider 官网或文档链接"
    },
    "baseUrl": {
      "type": "string",
      "format": "uri",
      "description": "API 基础 URL"
    },
    "supportsCustomUrl": {
      "type": "boolean",
      "default": true,
      "description": "是否允许用户自定义 Base URL"
    },
    "authType": {
      "type": "string",
      "enum": ["bearer", "api_key_header", "api_key_query", "none"],
      "description": "认证方式"
    },
    "authHeader": {
      "type": "string",
      "default": "Authorization",
      "description": "认证 Header 名称（authType=api_key_header 时生效）"
    },
    "authPrefix": {
      "type": "string",
      "default": "Bearer ",
      "description": "认证值前缀（authType=bearer 时生效）"
    },
    "sseFormat": {
      "type": "string",
      "enum": ["openai", "claude", "custom"],
      "description": "SSE 流式响应格式"
    },
    "requestTransform": {
      "type": "object",
      "description": "请求体转换配置",
      "properties": {
        "chatEndpoint": {
          "type": "string",
          "default": "/chat/completions",
          "description": "聊天接口路径"
        },
        "modelField": {
          "type": "string",
          "default": "model",
          "description": "模型字段名"
        },
        "messagesField": {
          "type": "string",
          "default": "messages",
          "description": "消息列表字段名"
        },
        "streamField": {
          "type": "string",
          "default": "stream",
          "description": "流式标志字段名"
        },
        "extraHeaders": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "额外请求头"
        },
        "extraBody": {
          "type": "object",
          "description": "额外请求体字段"
        }
      }
    },
    "responseTransform": {
      "type": "object",
      "description": "响应体转换配置（非流式）",
      "properties": {
        "contentPath": {
          "type": "string",
          "default": "choices[0].message.content",
          "description": "内容提取 JSONPath"
        }
      }
    },
    "models": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": {
            "type": "string",
            "description": "模型 ID"
          },
          "name": {
            "type": "string",
            "description": "模型显示名称"
          },
          "description": {
            "type": "string",
            "description": "模型描述"
          },
          "supportsVision": {
            "type": "boolean",
            "default": false,
            "description": "是否支持视觉输入"
          },
          "contextWindow": {
            "type": "integer",
            "description": "上下文窗口大小"
          },
          "maxOutputTokens": {
            "type": "integer",
            "description": "最大输出 Token 数"
          }
        }
      },
      "description": "支持的模型列表"
    },
    "capabilities": {
      "type": "object",
      "properties": {
        "streaming": {
          "type": "boolean",
          "default": true,
          "description": "是否支持流式输出"
        },
        "vision": {
          "type": "boolean",
          "default": false,
          "description": "是否支持视觉输入"
        },
        "functionCalling": {
          "type": "boolean",
          "default": false,
          "description": "是否支持函数调用"
        }
      }
    },
    "healthCheck": {
      "type": "object",
      "properties": {
        "endpoint": {
          "type": "string",
          "default": "/models",
          "description": "健康检查接口路径"
        },
        "method": {
          "type": "string",
          "enum": ["GET", "HEAD", "POST"],
          "default": "GET"
        },
        "expectedStatus": {
          "type": "array",
          "items": { "type": "integer" },
          "default": [200, 401, 403],
          "description": "预期 HTTP 状态码（任一即可）"
        }
      }
    },
    "rateLimit": {
      "type": "object",
      "properties": {
        "requestsPerMinute": {
          "type": "integer",
          "description": "每分钟最大请求数"
        },
        "tokensPerMinute": {
          "type": "integer",
          "description": "每分钟最大 Token 数"
        }
      }
    }
  }
}
```

#### 3.2.2 字段说明表

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，如 `deepseek`, `ollama_local` |
| `name` | string | 是 | 显示名称，如 "DeepSeek AI" |
| `version` | string | 是 | 语义化版本 |
| `baseUrl` | string | 是 | 默认 API 基础 URL |
| `authType` | enum | 是 | 认证方式：bearer/api_key_header/none |
| `sseFormat` | enum | 是 | SSE 格式：openai/claude/custom |
| `models` | array | 是 | 至少包含一个模型定义 |
| `requestTransform` | object | 否 | 请求转换配置（默认 OpenAI 格式） |
| `healthCheck` | object | 否 | 连通性检测配置 |

### 3.3 后端插件接口

#### 3.3.1 Rust Trait 扩展设计

保持现有 `AIProvider` trait 不变，新增 `DynamicProvider` trait 支持动态加载：

```rust
// src-tauri/src/ai/traits.rs（扩展）

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Provider 描述符（对应 JSON Schema）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub author: Option<String>,
    pub base_url: String,
    pub supports_custom_url: bool,
    pub auth_type: AuthType,
    pub auth_header: Option<String>,
    pub auth_prefix: Option<String>,
    pub sse_format: SseFormat,
    pub request_transform: Option<RequestTransform>,
    pub response_transform: Option<ResponseTransform>,
    pub models: Vec<ModelDescriptor>,
    pub capabilities: Option<Capabilities>,
    pub health_check: Option<HealthCheckConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    ApiKeyHeader,
    ApiKeyQuery,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SseFormat {
    Openai,
    Claude,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTransform {
    pub chat_endpoint: Option<String>,
    pub model_field: Option<String>,
    pub messages_field: Option<String>,
    pub stream_field: Option<String>,
    pub extra_headers: Option<std::collections::HashMap<String, String>>,
    pub extra_body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTransform {
    pub content_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub supports_vision: bool,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub streaming: bool,
    pub vision: bool,
    pub function_calling: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckConfig {
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub expected_status: Option<Vec<u16>>,
}
```

#### 3.3.2 ConfigurableProvider 通用实现

基于描述符驱动的通用 Provider 实现：

```rust
// src-tauri/src/ai/configurable.rs（新增）

use super::traits::*;
use super::types::*;
use super::stream::{parse_openai_sse_stream, parse_claude_sse_stream};
use async_trait::async_trait;
use tauri::AppHandle;

/// 可配置 Provider - 基于描述符驱动
pub struct ConfigurableProvider {
    descriptor: ProviderDescriptor,
}

impl ConfigurableProvider {
    pub fn new(descriptor: ProviderDescriptor) -> Self {
        Self { descriptor }
    }

    /// 构建请求 URL
    fn build_url(&self, config: &ProviderConfig, endpoint: &str) -> String {
        let base = config.base_url.as_deref()
            .unwrap_or(&self.descriptor.base_url);
        format!("{}{}", base.trim_end_matches('/'), endpoint)
    }

    /// 构建认证 Header
    fn build_auth_header(&self, api_key: &str) -> (String, String) {
        match self.descriptor.auth_type {
            AuthType::Bearer => {
                let prefix = self.descriptor.auth_prefix.as_deref().unwrap_or("Bearer ");
                ("Authorization".to_string(), format!("{}{}", prefix, api_key))
            }
            AuthType::ApiKeyHeader => {
                let header = self.descriptor.auth_header.as_deref().unwrap_or("X-API-Key");
                (header.to_string(), api_key.to_string())
            }
            AuthType::ApiKeyQuery | AuthType::None => {
                ("".to_string(), "".to_string())
            }
        }
    }

    /// 构建请求体
    fn build_request_body(
        &self,
        model: &str,
        messages: &[ChatMessage],
        stream: bool,
    ) -> serde_json::Value {
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
            model_field: model,
            messages_field: messages,
            stream_field: stream,
        });

        // 合并 extra_body
        if let Some(extra) = transform.and_then(|t| t.extra_body.as_ref()) {
            if let Some(obj) = body.as_object_mut() {
                if let Some(extra_obj) = extra.as_object() {
                    for (k, v) in extra_obj {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
        }

        body
    }
}

#[async_trait]
impl AIProvider for ConfigurableProvider {
    async fn chat(
        &self,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError> {
        let transform = self.descriptor.request_transform.as_ref();
        let endpoint = transform
            .and_then(|t| t.chat_endpoint.as_deref())
            .unwrap_or("/chat/completions");

        let url = self.build_url(config, endpoint);
        let (auth_header, auth_value) = self.build_auth_header(&config.api_key);
        let body = self.build_request_body(model, &messages, false);

        let client = super::create_http_client(60)?;
        let mut request = client.post(&url).json(&body);

        if !auth_header.is_empty() {
            request = request.header(&auth_header, &auth_value);
        }

        // 添加额外 Headers
        if let Some(extra_headers) = transform.and_then(|t| t.extra_headers.as_ref()) {
            for (k, v) in extra_headers {
                request = request.header(k, v);
            }
        }

        let response = request.send().await.map_err(super::map_reqwest_error)?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(match status.as_u16() {
                401 | 403 => AIError::Auth(text),
                429 => AIError::RateLimit(text),
                _ => AIError::Api(status.as_u16(), text),
            });
        }

        let json: serde_json::Value = response.json().await
            .map_err(|e| AIError::StreamParse(e.to_string()))?;

        // 使用 content_path 提取内容（简化实现，实际需 JSONPath 库）
        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    async fn chat_stream(
        &self,
        app: AppHandle,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<bool, AIError> {
        let transform = self.descriptor.request_transform.as_ref();
        let endpoint = transform
            .and_then(|t| t.chat_endpoint.as_deref())
            .unwrap_or("/chat/completions");

        let url = self.build_url(config, endpoint);
        let (auth_header, auth_value) = self.build_auth_header(&config.api_key);
        let body = self.build_request_body(model, &messages, true);

        let client = super::create_http_client(120)?;
        let mut request = client.post(&url).json(&body);

        if !auth_header.is_empty() {
            request = request.header(&auth_header, &auth_value);
        }

        if let Some(extra_headers) = transform.and_then(|t| t.extra_headers.as_ref()) {
            for (k, v) in extra_headers {
                request = request.header(k, v);
            }
        }

        let response = request.send().await.map_err(super::map_reqwest_error)?;
        super::stream::handle_error_status(&response)?;

        // 根据 SSE 格式选择解析器
        match self.descriptor.sse_format {
            SseFormat::Claude => {
                parse_claude_sse_stream(&app, response, "ai-stream").await
            }
            _ => {
                parse_openai_sse_stream(&app, response, "ai-stream").await
            }
        }
    }

    async fn test_connection(
        &self,
        config: &ProviderConfig,
    ) -> Result<ConnectionTestResult, AIError> {
        let health = self.descriptor.health_check.as_ref();
        let endpoint = health
            .and_then(|h| h.endpoint.as_deref())
            .unwrap_or("/models");

        let url = self.build_url(config, endpoint);
        let (auth_header, auth_value) = self.build_auth_header(&config.api_key);

        let start = std::time::Instant::now();
        let client = super::create_http_client(10)?;
        
        let mut request = client.get(&url);
        if !auth_header.is_empty() {
            request = request.header(&auth_header, &auth_value);
        }

        let response = request.send().await.map_err(super::map_reqwest_error)?;
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
            model_used: self.descriptor.models.first()
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
        self.descriptor.models.iter().map(|m| ModelInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            description: m.description.clone().unwrap_or_default(),
            supports_vision: m.supports_vision,
        }).collect()
    }

    fn id(&self) -> &'static str {
        // 使用 Box::leak 将动态字符串转为 'static（内存泄漏可控）
        Box::leak(self.descriptor.id.clone().into_boxed_str())
    }

    fn display_name(&self) -> &'static str {
        Box::leak(self.descriptor.name.clone().into_boxed_str())
    }
}
```

#### 3.3.3 动态与静态 Provider 并存的注册机制

```rust
// src-tauri/src/ai/registry.rs（重构）

use super::traits::*;
use super::types::*;
use super::qwen::QwenProvider;
use super::openai_compat::OpenAICompatProvider;
use super::claude::ClaudeProvider;
use super::configurable::ConfigurableProvider;
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::AppHandle;

/// 统一 Provider 注册表
pub struct UnifiedProviderRegistry {
    /// 内置 Provider（枚举派发，零开销）
    builtin: BuiltinProviders,
    /// 动态 Provider（配置/插件加载）
    dynamic: RwLock<HashMap<String, ConfigurableProvider>>,
}

struct BuiltinProviders {
    qwen: QwenProvider,
    openai_compat: OpenAICompatProvider,
    claude: ClaudeProvider,
}

/// 扩展的 ProviderType，支持动态 Provider
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum ExtendedProviderType {
    /// 内置 Provider
    Builtin(BuiltinProviderType),
    /// 动态 Provider（通过 id 标识）
    Dynamic(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinProviderType {
    Qwen,
    OpenAICompat,
    Claude,
}

impl UnifiedProviderRegistry {
    pub fn new() -> Self {
        Self {
            builtin: BuiltinProviders {
                qwen: QwenProvider::new(),
                openai_compat: OpenAICompatProvider::new(),
                claude: ClaudeProvider::new(),
            },
            dynamic: RwLock::new(HashMap::new()),
        }
    }

    /// 注册动态 Provider
    pub fn register_dynamic(&self, descriptor: ProviderDescriptor) -> Result<(), String> {
        let id = descriptor.id.clone();
        let provider = ConfigurableProvider::new(descriptor);
        
        let mut dynamic = self.dynamic.write()
            .map_err(|e| format!("锁获取失败: {}", e))?;
        
        if dynamic.contains_key(&id) {
            return Err(format!("Provider '{}' 已存在", id));
        }
        
        dynamic.insert(id, provider);
        Ok(())
    }

    /// 注销动态 Provider
    pub fn unregister_dynamic(&self, id: &str) -> Result<(), String> {
        let mut dynamic = self.dynamic.write()
            .map_err(|e| format!("锁获取失败: {}", e))?;
        
        dynamic.remove(id)
            .ok_or_else(|| format!("Provider '{}' 不存在", id))?;
        
        Ok(())
    }

    /// 获取所有 Provider 元信息
    pub fn list_all_providers(&self) -> Vec<ProviderMeta> {
        let mut result = vec![
            self.builtin_meta(&BuiltinProviderType::Qwen),
            self.builtin_meta(&BuiltinProviderType::OpenAICompat),
            self.builtin_meta(&BuiltinProviderType::Claude),
        ];

        if let Ok(dynamic) = self.dynamic.read() {
            for (id, provider) in dynamic.iter() {
                result.push(ProviderMeta {
                    id: id.clone(),
                    name: provider.descriptor.name.clone(),
                    provider_type: ExtendedProviderType::Dynamic(id.clone()),
                    default_base_url: provider.descriptor.base_url.clone(),
                    supports_custom_url: provider.descriptor.supports_custom_url,
                    models: provider.default_models(),
                    is_builtin: false,
                });
            }
        }

        result
    }

    /// 聊天（自动路由）
    pub async fn chat(
        &self,
        provider_type: &ExtendedProviderType,
        config: &ProviderConfig,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, AIError> {
        match provider_type {
            ExtendedProviderType::Builtin(builtin) => {
                match builtin {
                    BuiltinProviderType::Qwen => {
                        self.builtin.qwen.chat(config, model, messages).await
                    }
                    BuiltinProviderType::OpenAICompat => {
                        self.builtin.openai_compat.chat(config, model, messages).await
                    }
                    BuiltinProviderType::Claude => {
                        self.builtin.claude.chat(config, model, messages).await
                    }
                }
            }
            ExtendedProviderType::Dynamic(id) => {
                let dynamic = self.dynamic.read()
                    .map_err(|e| AIError::Config(format!("锁获取失败: {}", e)))?;
                
                let provider = dynamic.get(id)
                    .ok_or_else(|| AIError::Config(format!("Provider '{}' 不存在", id)))?;
                
                provider.chat(config, model, messages).await
            }
        }
    }

    // chat_stream, test_connection 等方法类似实现...
    
    fn builtin_meta(&self, provider_type: &BuiltinProviderType) -> ProviderMeta {
        match provider_type {
            BuiltinProviderType::Qwen => ProviderMeta {
                id: "qwen".into(),
                name: "阿里云千问 (DashScope)".into(),
                provider_type: ExtendedProviderType::Builtin(BuiltinProviderType::Qwen),
                default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
                supports_custom_url: true,
                models: self.builtin.qwen.default_models(),
                is_builtin: true,
            },
            BuiltinProviderType::OpenAICompat => ProviderMeta {
                id: "openai_compat".into(),
                name: "OpenAI 兼容接口".into(),
                provider_type: ExtendedProviderType::Builtin(BuiltinProviderType::OpenAICompat),
                default_base_url: "https://api.openai.com/v1".into(),
                supports_custom_url: true,
                models: self.builtin.openai_compat.default_models(),
                is_builtin: true,
            },
            BuiltinProviderType::Claude => ProviderMeta {
                id: "claude".into(),
                name: "Anthropic Claude".into(),
                provider_type: ExtendedProviderType::Builtin(BuiltinProviderType::Claude),
                default_base_url: "https://api.anthropic.com".into(),
                supports_custom_url: true,
                models: self.builtin.claude.default_models(),
                is_builtin: true,
            },
        }
    }
}
```

### 3.4 前端插件接口

#### 3.4.1 TypeScript 接口定义

```typescript
// src/types/provider.ts（新增）

/**
 * Provider 描述符 - 与后端 JSON Schema 对齐
 */
export interface ProviderDescriptor {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  homepage?: string;
  baseUrl: string;
  supportsCustomUrl: boolean;
  authType: 'bearer' | 'api_key_header' | 'api_key_query' | 'none';
  authHeader?: string;
  authPrefix?: string;
  sseFormat: 'openai' | 'claude' | 'custom';
  requestTransform?: RequestTransform;
  responseTransform?: ResponseTransform;
  models: ModelDescriptor[];
  capabilities?: Capabilities;
  healthCheck?: HealthCheckConfig;
  rateLimit?: RateLimit;
}

export interface RequestTransform {
  chatEndpoint?: string;
  modelField?: string;
  messagesField?: string;
  streamField?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface ResponseTransform {
  contentPath?: string;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  description?: string;
  supportsVision?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface Capabilities {
  streaming?: boolean;
  vision?: boolean;
  functionCalling?: boolean;
}

export interface HealthCheckConfig {
  endpoint?: string;
  method?: 'GET' | 'HEAD' | 'POST';
  expectedStatus?: number[];
}

export interface RateLimit {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

/**
 * 扩展的 Provider 类型
 */
export type ExtendedProviderType = 
  | { type: 'builtin'; id: 'qwen' | 'openai_compat' | 'claude' }
  | { type: 'dynamic'; id: string };

/**
 * Provider 元信息（前端展示用）
 */
export interface ProviderMeta {
  id: string;
  name: string;
  description?: string;
  providerType: ExtendedProviderType;
  defaultBaseUrl: string;
  supportsCustomUrl: boolean;
  models: ModelDescriptor[];
  isBuiltin: boolean;
}
```

#### 3.4.2 前端 PluginProviderRegistry 设计

```typescript
// src/services/pluginProviderRegistry.ts（新增）

import { invoke } from '@tauri-apps/api/core';
import type { ProviderDescriptor, ProviderMeta, ExtendedProviderType } from '../types/provider';

/**
 * 插件 Provider 注册表服务
 */
class PluginProviderRegistry {
  private cachedProviders: ProviderMeta[] | null = null;

  /**
   * 获取所有可用 Provider（含内置和动态）
   */
  async getAllProviders(): Promise<ProviderMeta[]> {
    if (this.cachedProviders) {
      return this.cachedProviders;
    }
    
    try {
      const providers = await invoke<ProviderMeta[]>('ai_list_all_providers');
      this.cachedProviders = providers;
      return providers;
    } catch (error) {
      console.error('[PluginProviderRegistry] 获取 Provider 列表失败:', error);
      return [];
    }
  }

  /**
   * 注册动态 Provider
   */
  async registerProvider(descriptor: ProviderDescriptor): Promise<void> {
    await invoke('ai_register_provider', { descriptor });
    this.invalidateCache();
  }

  /**
   * 注销动态 Provider
   */
  async unregisterProvider(id: string): Promise<void> {
    await invoke('ai_unregister_provider', { id });
    this.invalidateCache();
  }

  /**
   * 验证 Provider 描述符
   */
  validateDescriptor(descriptor: Partial<ProviderDescriptor>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!descriptor.id || !/^[a-z][a-z0-9_]{2,31}$/.test(descriptor.id)) {
      errors.push('id 必须是 3-32 位小写字母开头的标识符');
    }
    if (!descriptor.name || descriptor.name.length > 64) {
      errors.push('name 必填且不超过 64 字符');
    }
    if (!descriptor.version || !/^\d+\.\d+\.\d+$/.test(descriptor.version)) {
      errors.push('version 必须是语义化版本号');
    }
    if (!descriptor.baseUrl) {
      errors.push('baseUrl 必填');
    }
    if (!descriptor.authType) {
      errors.push('authType 必填');
    }
    if (!descriptor.sseFormat) {
      errors.push('sseFormat 必填');
    }
    if (!descriptor.models || descriptor.models.length === 0) {
      errors.push('至少需要定义一个模型');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 刷新缓存
   */
  invalidateCache(): void {
    this.cachedProviders = null;
  }

  /**
   * 判断是否为内置 Provider
   */
  isBuiltin(providerType: ExtendedProviderType): boolean {
    return providerType.type === 'builtin';
  }
}

export const pluginProviderRegistry = new PluginProviderRegistry();
```

### 3.5 插件生命周期

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  加载    │───▶│  验证    │───▶│  注册    │───▶│  激活    │
│  Load    │    │ Validate │    │ Register │    │ Activate │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                               │
                     ▼                               ▼
              ┌──────────┐                    ┌──────────┐
              │  拒绝    │                    │  停用    │
              │ Reject   │                    │ Deactivate│
              └──────────┘                    └──────────┘
                                                    │
                                                    ▼
                                             ┌──────────┐
                                             │  卸载    │
                                             │ Unload   │
                                             └──────────┘
```

| 阶段 | 触发条件 | 主要操作 |
|------|---------|---------|
| **加载** | 配置文件读取/插件文件发现 | 读取 descriptor.json，解析 JSON |
| **验证** | 加载完成后 | Schema 校验、必填字段检查、安全规则检查 |
| **注册** | 验证通过后 | 加入 Registry，分配 ID |
| **激活** | 用户选择使用 | 初始化 HTTP 客户端，执行健康检查 |
| **停用** | 切换到其他 Provider | 释放资源 |
| **卸载** | 用户主动删除 | 从 Registry 移除，清理配置 |

### 3.6 安全约束

#### 3.6.1 URL 白名单/黑名单

```rust
// src-tauri/src/ai/security.rs（新增）

use std::collections::HashSet;
use url::Url;

/// URL 安全验证器
pub struct UrlValidator {
    /// 允许的域名白名单
    allowed_domains: HashSet<String>,
    /// 禁止的域名黑名单
    blocked_domains: HashSet<String>,
    /// 是否允许本地地址
    allow_localhost: bool,
    /// 是否允许私有 IP
    allow_private_ip: bool,
}

impl UrlValidator {
    pub fn new() -> Self {
        let mut allowed = HashSet::new();
        // 内置白名单
        allowed.insert("dashscope.aliyuncs.com".to_string());
        allowed.insert("api.openai.com".to_string());
        allowed.insert("api.anthropic.com".to_string());
        allowed.insert("api.deepseek.com".to_string());

        let mut blocked = HashSet::new();
        // 内置黑名单
        blocked.insert("localhost".to_string());  // 可通过配置启用

        Self {
            allowed_domains: allowed,
            blocked_domains: blocked,
            allow_localhost: false,  // 默认禁止
            allow_private_ip: false,
        }
    }

    /// 验证 URL 是否安全
    pub fn validate(&self, url_str: &str) -> Result<(), String> {
        let url = Url::parse(url_str)
            .map_err(|e| format!("无效 URL: {}", e))?;

        // 必须是 HTTPS（localhost 除外）
        let host = url.host_str().ok_or("URL 缺少主机名")?;
        
        if url.scheme() != "https" {
            if !self.allow_localhost || host != "localhost" {
                return Err("仅支持 HTTPS 协议".to_string());
            }
        }

        // 检查黑名单
        if self.blocked_domains.contains(host) && !self.allow_localhost {
            return Err(format!("域名 {} 已被禁止", host));
        }

        // 检查私有 IP（如果禁止）
        if !self.allow_private_ip {
            if let Ok(ip) = host.parse::<std::net::IpAddr>() {
                if is_private_ip(&ip) {
                    return Err("禁止访问私有 IP 地址".to_string());
                }
            }
        }

        Ok(())
    }

    /// 添加允许的域名
    pub fn allow_domain(&mut self, domain: &str) {
        self.allowed_domains.insert(domain.to_string());
        self.blocked_domains.remove(domain);
    }

    /// 启用本地地址访问
    pub fn enable_localhost(&mut self) {
        self.allow_localhost = true;
    }
}

fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_private() || v4.is_loopback() || v4.is_link_local()
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
        }
    }
}
```

#### 3.6.2 API Key 加密存储

```rust
// src-tauri/src/ai/keystore.rs（新增）

use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use base64::{Engine as _, engine::general_purpose::STANDARD};

/// API Key 加密存储管理器
pub struct KeyStore {
    /// 加密密钥（从系统密钥链派生）
    key: LessSafeKey,
    rng: SystemRandom,
}

impl KeyStore {
    /// 初始化（从设备指纹派生密钥）
    pub fn new() -> Result<Self, String> {
        // 获取设备唯一标识作为密钥材料
        let device_id = Self::get_device_id()?;
        
        // 使用 HKDF 派生密钥
        let key_bytes = Self::derive_key(&device_id)?;
        
        let unbound_key = UnboundKey::new(&CHACHA20_POLY1305, &key_bytes)
            .map_err(|_| "密钥初始化失败")?;
        
        Ok(Self {
            key: LessSafeKey::new(unbound_key),
            rng: SystemRandom::new(),
        })
    }

    /// 加密 API Key
    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let mut nonce_bytes = [0u8; 12];
        self.rng.fill(&mut nonce_bytes)
            .map_err(|_| "随机数生成失败")?;
        
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        
        let mut in_out = plaintext.as_bytes().to_vec();
        
        self.key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
            .map_err(|_| "加密失败")?;
        
        // 格式：nonce (12 bytes) + ciphertext + tag
        let mut result = nonce_bytes.to_vec();
        result.extend(in_out);
        
        Ok(STANDARD.encode(&result))
    }

    /// 解密 API Key
    pub fn decrypt(&self, ciphertext: &str) -> Result<String, String> {
        let data = STANDARD.decode(ciphertext)
            .map_err(|_| "Base64 解码失败")?;
        
        if data.len() < 12 {
            return Err("密文格式错误".to_string());
        }
        
        let (nonce_bytes, encrypted) = data.split_at(12);
        let nonce = Nonce::assume_unique_for_key(
            nonce_bytes.try_into().map_err(|_| "Nonce 解析失败")?
        );
        
        let mut in_out = encrypted.to_vec();
        
        let plaintext = self.key.open_in_place(nonce, Aad::empty(), &mut in_out)
            .map_err(|_| "解密失败，密钥可能不正确")?;
        
        String::from_utf8(plaintext.to_vec())
            .map_err(|_| "UTF-8 解码失败".to_string())
    }

    #[cfg(target_os = "windows")]
    fn get_device_id() -> Result<Vec<u8>, String> {
        // Windows: 使用 MachineGuid
        use winreg::enums::*;
        use winreg::RegKey;
        
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography")
            .map_err(|e| format!("注册表访问失败: {}", e))?;
        let guid: String = key.get_value("MachineGuid")
            .map_err(|e| format!("读取 MachineGuid 失败: {}", e))?;
        
        Ok(guid.into_bytes())
    }

    fn derive_key(material: &[u8]) -> Result<[u8; 32], String> {
        use ring::hkdf::{Salt, HKDF_SHA256};
        
        let salt = Salt::new(HKDF_SHA256, b"AI_Cue_KeyStore_v1");
        let prk = salt.extract(material);
        
        let mut key = [0u8; 32];
        prk.expand(&[b"api_key_encryption"], &CHACHA20_POLY1305)
            .map_err(|_| "密钥扩展失败")?
            .fill(&mut key)
            .map_err(|_| "密钥填充失败")?;
        
        Ok(key)
    }
}
```

---

## 4. 配置文件驱动的 Provider 添加（#50）

### 4.1 配置文件格式与位置

#### 4.1.1 用户级配置文件路径

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\ai-cue\providers\` |
| macOS | `~/Library/Application Support/ai-cue/providers/` |
| Linux | `~/.config/ai-cue/providers/` |

目录结构：
```
providers/
├── deepseek.json         # 单文件 Provider 定义
├── ollama-local.json
└── custom/               # 用户自定义
    └── my-provider.json
```

#### 4.1.2 JSON 配置文件完整示例

```json
{
  "id": "deepseek",
  "name": "DeepSeek AI",
  "description": "DeepSeek 大模型服务，支持对话和推理",
  "version": "1.0.0",
  "author": "AI_Cue Community",
  "homepage": "https://www.deepseek.com",
  "baseUrl": "https://api.deepseek.com/v1",
  "supportsCustomUrl": true,
  "authType": "bearer",
  "authPrefix": "Bearer ",
  "sseFormat": "openai",
  "requestTransform": {
    "chatEndpoint": "/chat/completions",
    "modelField": "model",
    "messagesField": "messages",
    "streamField": "stream"
  },
  "models": [
    {
      "id": "deepseek-chat",
      "name": "DeepSeek Chat",
      "description": "通用对话模型",
      "supportsVision": false,
      "contextWindow": 64000
    },
    {
      "id": "deepseek-reasoner",
      "name": "DeepSeek R1",
      "description": "深度推理模型",
      "supportsVision": false,
      "contextWindow": 64000
    }
  ],
  "capabilities": {
    "streaming": true,
    "vision": false,
    "functionCalling": true
  },
  "healthCheck": {
    "endpoint": "/models",
    "method": "GET",
    "expectedStatus": [200, 401]
  }
}
```

### 4.2 配置加载流程

#### 4.2.1 应用启动时的加载逻辑

```rust
// src-tauri/src/ai/loader.rs（新增）

use super::traits::ProviderDescriptor;
use std::path::PathBuf;
use tokio::fs;

/// Provider 配置加载器
pub struct ProviderLoader {
    providers_dir: PathBuf,
}

impl ProviderLoader {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        Self {
            providers_dir: app_data_dir.join("providers"),
        }
    }

    /// 启动时加载所有 Provider 配置
    pub async fn load_all(&self) -> Result<Vec<ProviderDescriptor>, String> {
        // 确保目录存在
        if !self.providers_dir.exists() {
            fs::create_dir_all(&self.providers_dir).await
                .map_err(|e| format!("创建 providers 目录失败: {}", e))?;
            
            // 复制内置示例配置
            self.copy_builtin_examples().await?;
        }

        let mut descriptors = Vec::new();
        let mut entries = fs::read_dir(&self.providers_dir).await
            .map_err(|e| format!("读取 providers 目录失败: {}", e))?;

        while let Some(entry) = entries.next_entry().await
            .map_err(|e| format!("遍历目录失败: {}", e))?
        {
            let path = entry.path();
            
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                match self.load_single(&path).await {
                    Ok(descriptor) => {
                        tracing::info!(
                            provider_id = %descriptor.id,
                            "加载 Provider 配置成功"
                        );
                        descriptors.push(descriptor);
                    }
                    Err(e) => {
                        tracing::warn!(
                            path = %path.display(),
                            error = %e,
                            "加载 Provider 配置失败，已跳过"
                        );
                    }
                }
            }
        }

        Ok(descriptors)
    }

    /// 加载单个配置文件
    async fn load_single(&self, path: &std::path::Path) -> Result<ProviderDescriptor, String> {
        let content = fs::read_to_string(path).await
            .map_err(|e| format!("读取文件失败: {}", e))?;
        
        let descriptor: ProviderDescriptor = serde_json::from_str(&content)
            .map_err(|e| format!("JSON 解析失败: {}", e))?;
        
        // 校验必填字段
        self.validate(&descriptor)?;
        
        Ok(descriptor)
    }

    /// 校验描述符
    fn validate(&self, descriptor: &ProviderDescriptor) -> Result<(), String> {
        if descriptor.id.is_empty() {
            return Err("id 不能为空".to_string());
        }
        if !descriptor.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            return Err("id 只能包含小写字母、数字和下划线".to_string());
        }
        if descriptor.models.is_empty() {
            return Err("至少需要定义一个模型".to_string());
        }
        
        // URL 安全校验
        crate::ai::security::UrlValidator::new().validate(&descriptor.base_url)?;
        
        Ok(())
    }

    /// 复制内置示例配置
    async fn copy_builtin_examples(&self) -> Result<(), String> {
        // 从资源目录复制示例文件
        let examples = include_str!("../../resources/provider-examples/deepseek.json");
        let target = self.providers_dir.join("deepseek.json.example");
        
        fs::write(&target, examples).await
            .map_err(|e| format!("写入示例文件失败: {}", e))?;
        
        Ok(())
    }
}
```

#### 4.2.2 热加载（文件变更监听）

```rust
// src-tauri/src/ai/watcher.rs（新增）

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tokio::sync::broadcast;

/// Provider 配置热加载监听器
pub struct ProviderWatcher {
    providers_dir: PathBuf,
    event_tx: broadcast::Sender<ProviderWatchEvent>,
}

#[derive(Clone, Debug)]
pub enum ProviderWatchEvent {
    Created(String),   // 新增配置
    Modified(String),  // 修改配置
    Removed(String),   // 删除配置
}

impl ProviderWatcher {
    pub fn new(providers_dir: PathBuf) -> (Self, broadcast::Receiver<ProviderWatchEvent>) {
        let (tx, rx) = broadcast::channel(16);
        (Self { providers_dir, event_tx: tx }, rx)
    }

    /// 启动监听（在后台线程运行）
    pub fn start(self) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
        
        let mut watcher = RecommendedWatcher::new(
            tx,
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ).map_err(|e| format!("创建文件监听器失败: {}", e))?;

        watcher.watch(&self.providers_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("监听目录失败: {}", e))?;

        std::thread::spawn(move || {
            // 保持 watcher 存活
            let _watcher = watcher;
            
            for res in rx {
                match res {
                    Ok(event) => {
                        self.handle_event(event);
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "文件监听错误");
                    }
                }
            }
        });

        Ok(())
    }

    fn handle_event(&self, event: Event) {
        use notify::EventKind;

        for path in event.paths {
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                let file_name = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                let watch_event = match event.kind {
                    EventKind::Create(_) => ProviderWatchEvent::Created(file_name),
                    EventKind::Modify(_) => ProviderWatchEvent::Modified(file_name),
                    EventKind::Remove(_) => ProviderWatchEvent::Removed(file_name),
                    _ => continue,
                };

                let _ = self.event_tx.send(watch_event);
            }
        }
    }
}
```

### 4.3 配置验证

#### 4.3.1 JSON Schema 校验

```typescript
// src/services/providerValidator.ts（新增）

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ProviderDescriptor } from '../types/provider';

// 内嵌 JSON Schema（或从后端获取）
const providerSchema = {
  // ... 完整 schema 定义（见 3.2.1）
};

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

const validate = ajv.compile(providerSchema);

/**
 * 验证 Provider 描述符
 */
export function validateProviderDescriptor(
  data: unknown
): { valid: boolean; errors: string[] } {
  const valid = validate(data);
  
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors || []).map(err => {
    const path = err.instancePath || '/';
    const message = err.message || '未知错误';
    return `${path}: ${message}`;
  });

  return { valid: false, errors };
}

/**
 * 运行时连通性验证
 */
export async function testProviderConnectivity(
  descriptor: ProviderDescriptor,
  apiKey: string
): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  
  return invoke('ai_test_dynamic_provider', {
    descriptor,
    apiKey,
  });
}
```

### 4.4 与现有配置系统的集成

#### 4.4.1 AppConfig 扩展

```typescript
// src/store/config.ts（扩展）

export interface AppConfig {
  // 现有字段保持不变...
  activeProvider: string;  // 改为 string 以支持动态 Provider ID
  providerConfigs: Record<string, ProviderConfig>;  // 改为动态 key
  
  // 新增：动态 Provider 配置
  dynamicProviders: {
    enabled: boolean;       // 是否启用动态 Provider
    autoLoad: boolean;      // 应用启动时自动加载
    watchChanges: boolean;  // 监听配置文件变更
  };
}

// 默认配置扩展
export const DEFAULT_CONFIG: AppConfig = {
  // ...现有默认值
  dynamicProviders: {
    enabled: true,
    autoLoad: true,
    watchChanges: true,
  },
};
```

#### 4.4.2 前端配置 UI 的自动生成

```typescript
// src/components/DynamicProviderForm.tsx（新增）

import React from 'react';
import type { ProviderDescriptor, ModelDescriptor } from '../types/provider';

interface Props {
  descriptor: ProviderDescriptor;
  config: {
    apiKey: string;
    baseUrl?: string;
    model: string;
  };
  onChange: (config: Props['config']) => void;
}

/**
 * 根据 Provider 描述符自动生成配置表单
 */
export const DynamicProviderForm: React.FC<Props> = ({
  descriptor,
  config,
  onChange,
}) => {
  return (
    <div className="space-y-4">
      {/* API Key 输入 */}
      {descriptor.authType !== 'none' && (
        <div>
          <label className="block text-sm font-medium mb-1">
            API Key
          </label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
            className="w-full px-3 py-2 border rounded-md"
            placeholder={`请输入 ${descriptor.name} API Key`}
          />
        </div>
      )}

      {/* 自定义 Base URL（如果支持）*/}
      {descriptor.supportsCustomUrl && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Base URL（可选）
          </label>
          <input
            type="url"
            value={config.baseUrl || ''}
            onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
            className="w-full px-3 py-2 border rounded-md"
            placeholder={descriptor.baseUrl}
          />
          <p className="text-xs text-gray-500 mt-1">
            留空使用默认地址：{descriptor.baseUrl}
          </p>
        </div>
      )}

      {/* 模型选择 */}
      <div>
        <label className="block text-sm font-medium mb-1">
          模型
        </label>
        <select
          value={config.model}
          onChange={(e) => onChange({ ...config, model: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
        >
          {descriptor.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {model.description && ` - ${model.description}`}
            </option>
          ))}
        </select>
      </div>

      {/* 能力标签 */}
      <div className="flex gap-2 flex-wrap">
        {descriptor.capabilities?.streaming && (
          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
            流式输出
          </span>
        )}
        {descriptor.capabilities?.vision && (
          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
            视觉理解
          </span>
        )}
        {descriptor.capabilities?.functionCalling && (
          <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">
            函数调用
          </span>
        )}
      </div>
    </div>
  );
};
```

---

## 5. 社区插件加载与管理机制（#51）

### 5.1 插件目录结构

#### 5.1.1 插件包格式

支持两种格式：

**1. 单文件插件（.json）**
```
deepseek.json
```

**2. 插件包目录（适用于复杂插件）**
```
my-custom-provider/
├── manifest.json       # 必需：插件描述符
├── README.md          # 可选：使用说明
├── icon.png           # 可选：图标（64x64）
└── CHANGELOG.md       # 可选：更新日志
```

#### 5.1.2 manifest.json 格式

```json
{
  "$schema": "https://ai-cue.app/schemas/provider-descriptor.json",
  "id": "my_custom_provider",
  "name": "My Custom Provider",
  "version": "1.0.0",
  "author": "Community Developer",
  "minAppVersion": "0.3.0",
  "license": "MIT",
  // ... 标准 ProviderDescriptor 字段
}
```

### 5.2 插件发现与安装

#### 5.2.1 本地安装

```rust
// src-tauri/src/ai/plugin_manager.rs（新增）

use std::path::{Path, PathBuf};
use tokio::fs;
use super::traits::ProviderDescriptor;

/// 插件管理器
pub struct PluginManager {
    plugins_dir: PathBuf,
    installed: std::sync::RwLock<Vec<InstalledPlugin>>,
}

#[derive(Clone)]
pub struct InstalledPlugin {
    pub id: String,
    pub path: PathBuf,
    pub descriptor: ProviderDescriptor,
    pub enabled: bool,
}

impl PluginManager {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            plugins_dir: app_data_dir.join("plugins"),
            installed: std::sync::RwLock::new(Vec::new()),
        }
    }

    /// 从文件安装插件
    pub async fn install_from_file(&self, source_path: &Path) -> Result<InstalledPlugin, String> {
        // 1. 验证文件类型
        let extension = source_path.extension()
            .and_then(|e| e.to_str())
            .ok_or("无效的文件类型")?;

        let descriptor = match extension {
            "json" => self.load_json_plugin(source_path).await?,
            _ => return Err("不支持的插件格式，请使用 .json 文件".to_string()),
        };

        // 2. 安全校验
        self.security_check(&descriptor)?;

        // 3. 检查冲突
        {
            let installed = self.installed.read().map_err(|e| e.to_string())?;
            if installed.iter().any(|p| p.id == descriptor.id) {
                return Err(format!("插件 '{}' 已安装", descriptor.id));
            }
        }

        // 4. 复制到插件目录
        fs::create_dir_all(&self.plugins_dir).await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        let target_path = self.plugins_dir.join(format!("{}.json", descriptor.id));
        fs::copy(source_path, &target_path).await
            .map_err(|e| format!("复制插件文件失败: {}", e))?;

        // 5. 注册插件
        let plugin = InstalledPlugin {
            id: descriptor.id.clone(),
            path: target_path,
            descriptor,
            enabled: true,
        };

        {
            let mut installed = self.installed.write().map_err(|e| e.to_string())?;
            installed.push(plugin.clone());
        }

        tracing::info!(
            plugin_id = %plugin.id,
            "插件安装成功"
        );

        Ok(plugin)
    }

    /// 卸载插件
    pub async fn uninstall(&self, plugin_id: &str) -> Result<(), String> {
        let plugin_path = {
            let mut installed = self.installed.write().map_err(|e| e.to_string())?;
            let idx = installed.iter().position(|p| p.id == plugin_id)
                .ok_or_else(|| format!("插件 '{}' 未安装", plugin_id))?;
            let plugin = installed.remove(idx);
            plugin.path
        };

        // 删除文件
        fs::remove_file(&plugin_path).await
            .map_err(|e| format!("删除插件文件失败: {}", e))?;

        tracing::info!(
            plugin_id = %plugin_id,
            "插件卸载成功"
        );

        Ok(())
    }

    /// 启用/禁用插件
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), String> {
        let mut installed = self.installed.write().map_err(|e| e.to_string())?;
        let plugin = installed.iter_mut().find(|p| p.id == plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未安装", plugin_id))?;
        
        plugin.enabled = enabled;
        Ok(())
    }

    /// 获取已安装插件列表
    pub fn list_installed(&self) -> Vec<InstalledPlugin> {
        self.installed.read()
            .map(|i| i.clone())
            .unwrap_or_default()
    }

    async fn load_json_plugin(&self, path: &Path) -> Result<ProviderDescriptor, String> {
        let content = fs::read_to_string(path).await
            .map_err(|e| format!("读取文件失败: {}", e))?;
        
        serde_json::from_str(&content)
            .map_err(|e| format!("JSON 解析失败: {}", e))
    }

    fn security_check(&self, descriptor: &ProviderDescriptor) -> Result<(), String> {
        // URL 白名单检查
        let validator = super::security::UrlValidator::new();
        validator.validate(&descriptor.base_url)?;

        // 禁止可疑字段
        if let Some(transform) = &descriptor.request_transform {
            if let Some(headers) = &transform.extra_headers {
                for key in headers.keys() {
                    if key.to_lowercase().contains("cookie") {
                        return Err("禁止设置 Cookie 相关 Header".to_string());
                    }
                }
            }
        }

        Ok(())
    }
}
```

#### 5.2.2 Tauri 命令暴露

```rust
// src-tauri/src/commands.rs（扩展）

/// 安装插件
#[tauri::command]
pub async fn install_plugin(
    manager: State<'_, PluginManager>,
    registry: State<'_, UnifiedProviderRegistry>,
    source_path: String,
) -> Result<InstalledPluginInfo, String> {
    let path = std::path::Path::new(&source_path);
    let plugin = manager.install_from_file(path).await?;
    
    // 注册到 Provider Registry
    registry.register_dynamic(plugin.descriptor.clone())?;
    
    Ok(InstalledPluginInfo {
        id: plugin.id,
        name: plugin.descriptor.name,
        version: plugin.descriptor.version,
        enabled: plugin.enabled,
    })
}

/// 卸载插件
#[tauri::command]
pub async fn uninstall_plugin(
    manager: State<'_, PluginManager>,
    registry: State<'_, UnifiedProviderRegistry>,
    plugin_id: String,
) -> Result<(), String> {
    registry.unregister_dynamic(&plugin_id)?;
    manager.uninstall(&plugin_id).await
}

/// 获取已安装插件列表
#[tauri::command]
pub fn list_installed_plugins(
    manager: State<'_, PluginManager>,
) -> Vec<InstalledPluginInfo> {
    manager.list_installed()
        .into_iter()
        .map(|p| InstalledPluginInfo {
            id: p.id,
            name: p.descriptor.name,
            version: p.descriptor.version,
            enabled: p.enabled,
        })
        .collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
}
```

### 5.3 前端插件管理 UI

```typescript
// src/components/PluginManager.tsx（新增）

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export const PluginManagerPanel: React.FC = () => {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    const list = await invoke<InstalledPlugin[]>('list_installed_plugins');
    setPlugins(list);
  };

  const handleInstall = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Provider 配置', extensions: ['json'] }],
    });

    if (selected) {
      setLoading(true);
      try {
        await invoke('install_plugin', { sourcePath: selected });
        await loadPlugins();
      } catch (error) {
        alert(`安装失败: ${error}`);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleUninstall = async (pluginId: string) => {
    if (!confirm(`确定要卸载插件 "${pluginId}" 吗？`)) return;

    try {
      await invoke('uninstall_plugin', { pluginId });
      await loadPlugins();
    } catch (error) {
      alert(`卸载失败: ${error}`);
    }
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">插件管理</h2>
        <button
          onClick={handleInstall}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '安装中...' : '安装插件'}
        </button>
      </div>

      {plugins.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          暂无已安装的插件
        </p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div>
                <div className="font-medium">{plugin.name}</div>
                <div className="text-sm text-gray-500">
                  ID: {plugin.id} | 版本: {plugin.version}
                </div>
              </div>
              <button
                onClick={() => handleUninstall(plugin.id)}
                className="px-3 py-1 text-red-500 hover:bg-red-50 rounded"
              >
                卸载
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### 5.4 版本管理与兼容性

```typescript
// src/services/pluginVersionManager.ts（新增）

import { compare, valid } from 'semver';

interface VersionCheckResult {
  compatible: boolean;
  message?: string;
}

/**
 * 检查插件版本兼容性
 */
export function checkPluginCompatibility(
  pluginMinVersion: string | undefined,
  currentAppVersion: string
): VersionCheckResult {
  if (!pluginMinVersion) {
    return { compatible: true };
  }

  if (!valid(pluginMinVersion) || !valid(currentAppVersion)) {
    return {
      compatible: false,
      message: '版本号格式无效',
    };
  }

  const comparison = compare(currentAppVersion, pluginMinVersion);
  
  if (comparison < 0) {
    return {
      compatible: false,
      message: `需要 AI_Cue ${pluginMinVersion} 或更高版本，当前版本 ${currentAppVersion}`,
    };
  }

  return { compatible: true };
}
```

### 5.5 安全审计

#### 5.5.1 权限声明与用户授权

```typescript
// src/types/plugin.ts（新增）

/**
 * 插件权限声明
 */
export interface PluginPermissions {
  /** 网络访问权限 */
  network: {
    /** 允许访问的域名列表 */
    allowedDomains: string[];
  };
  /** 存储权限 */
  storage: {
    /** 是否需要持久化配置 */
    persistent: boolean;
    /** 最大存储空间（字节） */
    maxBytes?: number;
  };
}

/**
 * 用户授权状态
 */
export interface PluginAuthorization {
  pluginId: string;
  grantedAt: number;
  permissions: PluginPermissions;
  /** 用户是否已确认 */
  confirmed: boolean;
}
```

---

## 6. 日志系统设计（#52）

### 6.1 日志架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Logger      │───▶│ RingBuffer  │───▶│ LogBridge   │     │
│  │ (singleton) │    │ (memory)    │    │ (to backend)│     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└───────────────────────────┼─────────────────────────────────┘
                            │ Tauri IPC
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Rust)                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ tracing     │───▶│ Subscriber  │───▶│ File Appender│    │
│  │ (macros)    │    │ (filter)    │    │ (rotation)   │    │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                            │                  │             │
│                            ▼                  ▼             │
│                     ┌─────────────┐    ┌─────────────┐     │
│                     │ Console     │    │ logs/*.log  │     │
│                     │ (dev only)  │    │ (persistent)│     │
│                     └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 后端日志（Rust）

#### 6.2.1 使用 tracing crate

```toml
# src-tauri/Cargo.toml（依赖新增）
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-appender = "0.2"
```

#### 6.2.2 日志初始化

```rust
// src-tauri/src/logging.rs（新增）

use tracing_subscriber::{
    fmt,
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use std::path::Path;

/// 日志配置
pub struct LogConfig {
    /// 日志目录
    pub log_dir: std::path::PathBuf,
    /// 最低日志级别
    pub level: LogLevel,
    /// 是否输出到控制台
    pub console_output: bool,
    /// 是否启用 JSON 格式
    pub json_format: bool,
    /// 单文件最大大小（MB）
    pub max_file_size_mb: u64,
    /// 最多保留文件数
    pub max_files: usize,
}

#[derive(Clone, Copy)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            log_dir: std::path::PathBuf::from("logs"),
            level: LogLevel::Info,
            console_output: cfg!(debug_assertions),
            json_format: false,
            max_file_size_mb: 10,
            max_files: 5,
        }
    }
}

/// 初始化日志系统
pub fn init_logging(config: LogConfig) -> Result<LogGuard, String> {
    // 确保日志目录存在
    std::fs::create_dir_all(&config.log_dir)
        .map_err(|e| format!("创建日志目录失败: {}", e))?;

    // 文件输出（按日轮转）
    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &config.log_dir,
        "ai-cue.log",
    );
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // 构建过滤器
    let level_str = match config.level {
        LogLevel::Trace => "trace",
        LogLevel::Debug => "debug",
        LogLevel::Info => "info",
        LogLevel::Warn => "warn",
        LogLevel::Error => "error",
    };
    
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("ai_cue={}", level_str)));

    // 文件层（JSON 格式）
    let file_layer = fmt::layer()
        .json()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true);

    // 控制台层（仅开发环境）
    let console_layer = if config.console_output {
        Some(fmt::layer()
            .with_target(true)
            .with_thread_ids(false)
            .pretty())
    } else {
        None
    };

    // 组合并初始化
    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(console_layer)
        .init();

    tracing::info!(
        log_dir = %config.log_dir.display(),
        level = level_str,
        "日志系统初始化完成"
    );

    Ok(LogGuard { _guard: guard })
}

/// 日志守护（保持 non-blocking writer 存活）
pub struct LogGuard {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}

/// 敏感信息过滤器
pub fn sanitize_log_value(value: &str) -> String {
    // API Key 脱敏
    let sanitized = regex::Regex::new(r"(sk-|Bearer\s+)[a-zA-Z0-9]{20,}")
        .unwrap()
        .replace_all(value, "$1[REDACTED]");
    
    // 密码脱敏
    let sanitized = regex::Regex::new(r#"("password"\s*:\s*")[^"]+""#)
        .unwrap()
        .replace_all(&sanitized, r#"$1[REDACTED]""#);
    
    sanitized.to_string()
}
```

#### 6.2.3 日志使用示例

```rust
// 在现有代码中添加日志（示例）

// src-tauri/src/ai/configurable.rs
impl ConfigurableProvider {
    async fn chat(...) -> Result<String, AIError> {
        tracing::info!(
            provider_id = %self.descriptor.id,
            model = %model,
            message_count = messages.len(),
            "开始聊天请求"
        );

        let start = std::time::Instant::now();
        
        // ... 执行请求 ...
        
        tracing::info!(
            provider_id = %self.descriptor.id,
            latency_ms = %start.elapsed().as_millis(),
            "聊天请求完成"
        );
        
        Ok(content)
    }
}

// 错误日志
tracing::error!(
    provider_id = %self.descriptor.id,
    status = %status.as_u16(),
    error = %crate::logging::sanitize_log_value(&text),
    "API 请求失败"
);

// 警告日志
tracing::warn!(
    config_path = %path.display(),
    error = %e,
    "加载 Provider 配置失败，已跳过"
);
```

### 6.3 前端日志（TypeScript）

#### 6.3.1 Logger 单例设计

```typescript
// src/services/logger.ts（新增）

import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 前端日志服务（单例）
 */
class Logger {
  private static instance: Logger;
  
  /** 内存环形缓冲 */
  private buffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;
  
  /** 当前日志级别 */
  private level: LogLevel = 'info';
  
  /** 日志级别优先级 */
  private readonly levelPriority: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  };

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** 设置日志级别 */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** 创建模块化 logger */
  createModuleLogger(module: string) {
    return {
      trace: (message: string, data?: Record<string, unknown>) =>
        this.log('trace', module, message, data),
      debug: (message: string, data?: Record<string, unknown>) =>
        this.log('debug', module, message, data),
      info: (message: string, data?: Record<string, unknown>) =>
        this.log('info', module, message, data),
      warn: (message: string, data?: Record<string, unknown>) =>
        this.log('warn', module, message, data),
      error: (message: string, data?: Record<string, unknown>) =>
        this.log('error', module, message, data),
    };
  }

  /** 记录日志 */
  private log(
    level: LogLevel,
    module: string,
    message: string,
    data?: Record<string, unknown>
  ): void {
    // 级别过滤
    if (this.levelPriority[level] < this.levelPriority[this.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      module,
      message: this.sanitize(message),
      timestamp: Date.now(),
      data: data ? this.sanitizeObject(data) : undefined,
    };

    // 添加到缓冲
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // 控制台输出
    const consoleMethod = level === 'trace' ? 'log' : level;
    console[consoleMethod](`[${module}]`, message, data || '');

    // 桥接到后端（仅 warn/error）
    if (level === 'warn' || level === 'error') {
      this.bridgeToBackend(entry);
    }
  }

  /** 获取缓冲中的日志 */
  getBufferedLogs(): LogEntry[] {
    return [...this.buffer];
  }

  /** 清空缓冲 */
  clearBuffer(): void {
    this.buffer = [];
  }

  /** 导出日志 */
  async exportLogs(): Promise<string> {
    const logs = this.buffer.map(entry => ({
      ...entry,
      timestamp: new Date(entry.timestamp).toISOString(),
    }));
    return JSON.stringify(logs, null, 2);
  }

  /** 敏感信息脱敏 */
  private sanitize(value: string): string {
    return value
      .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9\-_.]+/gi, 'Bearer [REDACTED]');
  }

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['apiKey', 'api_key', 'token', 'password', 'secret'];
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        result[key] = this.sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /** 桥接到后端 */
  private async bridgeToBackend(entry: LogEntry): Promise<void> {
    try {
      await invoke('log_from_frontend', {
        level: entry.level,
        module: entry.module,
        message: entry.message,
        data: entry.data ? JSON.stringify(entry.data) : null,
      });
    } catch {
      // 静默失败，避免日志循环
    }
  }
}

export const logger = Logger.getInstance();

// 便捷导出
export const createLogger = (module: string) => logger.createModuleLogger(module);
```

#### 6.3.2 使用示例

```typescript
// src/services/aiChat.ts
import { createLogger } from './logger';

const log = createLogger('AIChat');

export async function sendStream(...) {
  log.info('开始流式请求', { provider, model });
  
  try {
    const result = await streamWithEvent(...);
    log.info('流式请求完成', { isComplete: result.isComplete });
    return result;
  } catch (error) {
    log.error('流式请求失败', { error: String(error) });
    throw error;
  }
}
```

### 6.4 日志存储与轮转

```rust
// 日志存储路径
// Windows: %APPDATA%\ai-cue\logs\
// macOS:   ~/Library/Logs/ai-cue/
// Linux:   ~/.local/share/ai-cue/logs/

// 轮转策略
// - 按日轮转（DAILY）
// - 单文件最大 10MB
// - 最多保留 5 个历史文件
// - 命名格式：ai-cue.log, ai-cue.log.2026-03-21, ...
```

### 6.5 日志导出

#### 6.5.1 Tauri 命令

```rust
// src-tauri/src/commands.rs（扩展）

use chrono::Utc;
use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExportResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub error: Option<String>,
}

/// 导出日志
#[tauri::command]
pub async fn export_logs(
    app: tauri::AppHandle,
    format: String,  // "text" | "json"
    include_frontend: bool,
    frontend_logs: Option<String>,  // 前端传入的日志 JSON
) -> Result<LogExportResult, String> {
    let log_dir = app.path().app_log_dir()
        .map_err(|e| format!("获取日志目录失败: {}", e))?;
    
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let export_path = log_dir.join(format!("ai-cue-export-{}.{}", timestamp, 
        if format == "json" { "json" } else { "txt" }
    ));

    // 读取后端日志
    let backend_logs = read_log_files(&log_dir)?;
    
    // 合并前端日志
    let combined = if include_frontend {
        if let Some(fe_logs) = frontend_logs {
            format!("=== Frontend Logs ===\n{}\n\n=== Backend Logs ===\n{}", 
                fe_logs, backend_logs)
        } else {
            backend_logs
        }
    } else {
        backend_logs
    };

    // 写入导出文件
    std::fs::write(&export_path, &combined)
        .map_err(|e| format!("写入导出文件失败: {}", e))?;

    let metadata = std::fs::metadata(&export_path)
        .map_err(|e| format!("获取文件信息失败: {}", e))?;

    Ok(LogExportResult {
        success: true,
        file_path: Some(export_path.to_string_lossy().to_string()),
        file_size: Some(metadata.len()),
        error: None,
    })
}

fn read_log_files(log_dir: &PathBuf) -> Result<String, String> {
    let mut content = String::new();
    
    for entry in std::fs::read_dir(log_dir)
        .map_err(|e| format!("读取日志目录失败: {}", e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.extension().map(|e| e == "log").unwrap_or(false) {
            if let Ok(log_content) = std::fs::read_to_string(&path) {
                content.push_str(&format!("\n=== {} ===\n", path.display()));
                content.push_str(&log_content);
            }
        }
    }
    
    Ok(content)
}

/// 从前端接收日志
#[tauri::command]
pub fn log_from_frontend(
    level: String,
    module: String,
    message: String,
    data: Option<String>,
) {
    let data_str = data.as_deref().unwrap_or("");
    
    match level.as_str() {
        "error" => tracing::error!(
            frontend = true,
            module = %module,
            data = %data_str,
            "{}",
            message
        ),
        "warn" => tracing::warn!(
            frontend = true,
            module = %module,
            data = %data_str,
            "{}",
            message
        ),
        "info" => tracing::info!(
            frontend = true,
            module = %module,
            data = %data_str,
            "{}",
            message
        ),
        "debug" => tracing::debug!(
            frontend = true,
            module = %module,
            data = %data_str,
            "{}",
            message
        ),
        _ => tracing::trace!(
            frontend = true,
            module = %module,
            data = %data_str,
            "{}",
            message
        ),
    }
}
```

#### 6.5.2 前端导出 UI

```typescript
// src/components/LogExportDialog.tsx（新增）

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../services/logger';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const LogExportDialog: React.FC<Props> = ({ open, onClose }) => {
  const [format, setFormat] = useState<'text' | 'json'>('text');
  const [includeFrontend, setIncludeFrontend] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ path?: string; error?: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setResult(null);

    try {
      const frontendLogs = includeFrontend ? await logger.exportLogs() : undefined;
      
      const res = await invoke<{
        success: boolean;
        filePath?: string;
        fileSize?: number;
        error?: string;
      }>('export_logs', {
        format,
        includeFrontend,
        frontendLogs,
      });

      if (res.success && res.filePath) {
        setResult({ path: res.filePath });
      } else {
        setResult({ error: res.error || '导出失败' });
      }
    } catch (error) {
      setResult({ error: String(error) });
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <h2 className="text-lg font-semibold mb-4">导出日志</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">导出格式</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="text"
                  checked={format === 'text'}
                  onChange={() => setFormat('text')}
                  className="mr-2"
                />
                纯文本
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="json"
                  checked={format === 'json'}
                  onChange={() => setFormat('json')}
                  className="mr-2"
                />
                JSON
              </label>
            </div>
          </div>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={includeFrontend}
              onChange={(e) => setIncludeFrontend(e.target.checked)}
              className="mr-2"
            />
            包含前端日志
          </label>

          {result && (
            <div className={`p-3 rounded ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {result.error || `已导出到: ${result.path}`}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            关闭
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {exporting ? '导出中...' : '导出'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

### 6.6 性能优化

| 优化项 | 实现方式 |
|--------|---------|
| **异步写入** | 使用 `tracing-appender::non_blocking` |
| **批量刷新** | 缓冲积累后批量写入 |
| **级别过滤** | 生产环境默认 INFO，减少日志量 |
| **环形缓冲** | 前端限制 1000 条，自动淘汰旧日志 |
| **懒初始化** | 日志系统在首次使用时初始化 |

### 6.7 隐私与安全

```typescript
// 自动脱敏规则（已在 Logger 中实现）
const sensitivePatterns = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI API Key
  /Bearer\s+[a-zA-Z0-9\-_.]+/gi,    // Bearer Token
  /["']?api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/gi,  // JSON 中的 apiKey
  /["']?password["']?\s*[:=]\s*["'][^"']+["']/gi,     // 密码字段
];
```

---

## 7. 数据库变更

### 7.1 新增 plugins 表

```sql
-- src-tauri/src/migrations/v6.sql

-- 已安装插件表
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    author TEXT,
    descriptor TEXT NOT NULL,  -- JSON 序列化的 ProviderDescriptor
    installed_at INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER
);

-- 插件授权表
CREATE TABLE IF NOT EXISTS plugin_authorizations (
    plugin_id TEXT PRIMARY KEY,
    permissions TEXT NOT NULL,  -- JSON 序列化的权限声明
    granted_at INTEGER NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 更新版本号
PRAGMA user_version = 6;
```

### 7.2 迁移脚本

```rust
// src-tauri/src/database.rs（扩展）

fn migrate_v5_to_v6(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    
    if version < 6 {
        println!("执行数据库迁移 v5 -> v6...");
        
        let tx = conn.unchecked_transaction()?;
        
        tx.execute_batch(include_str!("migrations/v6.sql"))?;
        
        tx.commit()?;
        println!("数据库迁移 v5 -> v6 完成");
    }
    
    Ok(())
}
```

---

## 8. 实现路线图

### Phase 1：日志系统 + Provider 插件规范（2 周）

| 任务 | 工时 | 优先级 |
|------|------|--------|
| 后端 tracing 集成 | 2d | P0 |
| 前端 Logger 服务 | 1d | P0 |
| 日志导出功能 | 1d | P0 |
| ProviderDescriptor 数据结构 | 1d | P0 |
| ConfigurableProvider 通用实现 | 2d | P0 |
| 单元测试 | 1d | P1 |

### Phase 2：配置文件 Provider 添加（1.5 周）

| 任务 | 工时 | 优先级 |
|------|------|--------|
| ProviderLoader 实现 | 2d | P0 |
| 热加载监听器 | 1d | P1 |
| 前端配置 UI 自动生成 | 2d | P0 |
| AppConfig 扩展 | 0.5d | P0 |
| 内置示例配置（DeepSeek） | 0.5d | P1 |

### Phase 3：社区插件管理（2 周）

| 任务 | 工时 | 优先级 |
|------|------|--------|
| PluginManager 实现 | 2d | P0 |
| 安全校验模块 | 1d | P0 |
| API Key 加密存储 | 2d | P1 |
| 前端插件管理 UI | 2d | P0 |
| 数据库迁移 v6 | 0.5d | P0 |
| 集成测试 | 1.5d | P1 |

---

## 9. 风险评估与缓解策略

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|---------|
| 动态 Provider 性能不如内置 | 中 | 低 | 内置 Provider 保持枚举派发，动态仅影响插件 |
| 恶意插件执行危险代码 | 低 | 高 | URL 白名单、权限声明、用户确认 |
| 日志泄露敏感信息 | 中 | 高 | 自动脱敏、导出前预览 |
| 配置文件格式变更导致兼容问题 | 中 | 中 | 版本声明、向后兼容校验 |
| 加密密钥泄露 | 低 | 高 | 设备绑定密钥派生、不存储密钥 |

---

## 10. 附录

### 10.1 完整 JSON Schema

见 [3.2.1 节](#321-完整-json-schema-定义)

### 10.2 示例插件配置

**DeepSeek:**
```json
{
  "id": "deepseek",
  "name": "DeepSeek AI",
  "version": "1.0.0",
  "baseUrl": "https://api.deepseek.com/v1",
  "authType": "bearer",
  "sseFormat": "openai",
  "models": [
    { "id": "deepseek-chat", "name": "DeepSeek Chat" },
    { "id": "deepseek-reasoner", "name": "DeepSeek R1" }
  ]
}
```

**Ollama 本地:**
```json
{
  "id": "ollama_local",
  "name": "Ollama 本地",
  "version": "1.0.0",
  "baseUrl": "http://localhost:11434/v1",
  "authType": "none",
  "sseFormat": "openai",
  "supportsCustomUrl": true,
  "models": [
    { "id": "llama3.2", "name": "Llama 3.2" },
    { "id": "qwen2.5", "name": "Qwen 2.5" }
  ]
}
```

### 10.3 API 接口清单

| 接口 | 类型 | 说明 |
|------|------|------|
| `ai_list_all_providers` | Query | 获取所有 Provider（含动态） |
| `ai_register_provider` | Mutation | 注册动态 Provider |
| `ai_unregister_provider` | Mutation | 注销动态 Provider |
| `install_plugin` | Mutation | 安装插件 |
| `uninstall_plugin` | Mutation | 卸载插件 |
| `list_installed_plugins` | Query | 获取已安装插件 |
| `export_logs` | Query | 导出日志 |
| `log_from_frontend` | Mutation | 前端日志桥接 |
