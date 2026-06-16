// Embedding Provider - API implementations and runtime configuration

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const QWEN_DEFAULT_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const QWEN_DEFAULT_MODEL: &str = "text-embedding-v2";
const QWEN_COMPATIBLE_BATCH_SIZE: usize = 10;
const OPENAI_DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL: &str = "text-embedding-3-small";

/// Embedding provider type used by runtime configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingProviderKind {
    Qwen,
    OpenAiCompatible,
}

/// Serializable runtime configuration passed from Tauri/frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProviderConfig {
    pub provider: EmbeddingProviderKind,
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl EmbeddingProviderConfig {
    pub fn normalize(&self) -> Result<Self, String> {
        let api_key = self.api_key.trim().to_string();
        if api_key.is_empty() {
            return Err("Embedding provider API key 不能为空".to_string());
        }

        Ok(Self {
            provider: self.provider.clone(),
            api_key,
            base_url: self.base_url.as_deref().and_then(normalize_optional_string),
            model: self.model.as_deref().and_then(normalize_optional_string),
        })
    }
}

fn normalize_optional_string(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_openai_compatible_embedding_body(model: &str, texts: &[String]) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "input": texts,
    })
}

/// Build a concrete embedding provider from runtime config.
pub fn create_embedding_provider(
    config: &EmbeddingProviderConfig,
) -> Result<Arc<dyn EmbeddingProvider>, String> {
    let normalized = config.normalize()?;

    match normalized.provider {
        EmbeddingProviderKind::Qwen => Ok(Arc::new(QwenEmbedding::with_config(
            normalized.api_key,
            normalized
                .base_url
                .unwrap_or_else(|| QWEN_DEFAULT_BASE_URL.to_string()),
            normalized
                .model
                .unwrap_or_else(|| QWEN_DEFAULT_MODEL.to_string()),
        ))),
        EmbeddingProviderKind::OpenAiCompatible => Ok(Arc::new(OpenAiEmbedding::with_config(
            normalized.api_key,
            normalized
                .base_url
                .unwrap_or_else(|| OPENAI_DEFAULT_BASE_URL.to_string()),
            normalized
                .model
                .unwrap_or_else(|| OPENAI_DEFAULT_MODEL.to_string()),
        ))),
    }
}

/// Embedding error type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmbedError {
    Network(String),
    Api(u16, String),
    Model(String),
    Dimension(String),
}

impl std::fmt::Display for EmbedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(e) => write!(f, "网络错误: {}", e),
            Self::Api(code, e) => write!(f, "API 错误 ({}): {}", code, e),
            Self::Model(e) => write!(f, "模型错误: {}", e),
            Self::Dimension(e) => write!(f, "维度错误: {}", e),
        }
    }
}

impl std::error::Error for EmbedError {}

/// Embedding provider interface.
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError>;
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
    fn model_id(&self) -> &str;
    fn dimension(&self) -> usize;
}

/// Qwen text embedding implementation.
pub struct QwenEmbedding {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl QwenEmbedding {
    pub fn new(api_key: String) -> Self {
        Self::with_config(
            api_key,
            QWEN_DEFAULT_BASE_URL.to_string(),
            QWEN_DEFAULT_MODEL.to_string(),
        )
    }

    pub fn with_config(api_key: String, base_url: String, model: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            api_key,
            base_url,
            model,
        }
    }

    async fn embed_internal(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let url = format!("{}/embeddings", self.base_url);
        let body = build_openai_compatible_embedding_body(&self.model, texts);

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| EmbedError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(EmbedError::Api(status.as_u16(), error_text));
        }

        #[derive(Deserialize)]
        struct EmbedResponse {
            data: Vec<EmbedData>,
        }

        #[derive(Deserialize)]
        struct EmbedData {
            embedding: Vec<f32>,
            index: usize,
        }

        let embed_resp: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| EmbedError::Model(e.to_string()))?;

        let mut results = vec![vec![]; texts.len()];
        for data in embed_resp.data {
            if data.index < texts.len() {
                results[data.index] = data.embedding;
            }
        }

        Ok(results)
    }
}

#[async_trait]
impl EmbeddingProvider for QwenEmbedding {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let results = self.embed_internal(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| EmbedError::Model("未获取到 embedding".to_string()))
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let mut results = Vec::new();

        for chunk in texts.chunks(QWEN_COMPATIBLE_BATCH_SIZE) {
            let embeddings = self.embed_internal(chunk).await?;
            results.extend(embeddings);
        }

        Ok(results)
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn dimension(&self) -> usize {
        1536
    }
}

/// OpenAI-compatible embedding implementation.
pub struct OpenAiEmbedding {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenAiEmbedding {
    pub fn new(api_key: String) -> Self {
        Self::with_config(
            api_key,
            OPENAI_DEFAULT_BASE_URL.to_string(),
            OPENAI_DEFAULT_MODEL.to_string(),
        )
    }

    pub fn with_model(api_key: String, model: String) -> Self {
        Self::with_config(api_key, OPENAI_DEFAULT_BASE_URL.to_string(), model)
    }

    pub fn with_config(api_key: String, base_url: String, model: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            api_key,
            base_url,
            model,
        }
    }

    async fn embed_internal(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let url = format!("{}/embeddings", self.base_url);

        #[derive(Serialize)]
        struct EmbedRequest<'a> {
            model: &'a str,
            input: &'a [String],
        }

        let body = EmbedRequest {
            model: &self.model,
            input: texts,
        };

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| EmbedError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(EmbedError::Api(status.as_u16(), error_text));
        }

        #[derive(Deserialize)]
        struct EmbedResponse {
            data: Vec<EmbedData>,
        }

        #[derive(Deserialize)]
        struct EmbedData {
            embedding: Vec<f32>,
            index: usize,
        }

        let embed_resp: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| EmbedError::Model(e.to_string()))?;

        let mut results = vec![vec![]; texts.len()];
        for data in embed_resp.data {
            if data.index < texts.len() {
                results[data.index] = data.embedding;
            }
        }

        Ok(results)
    }
}

#[async_trait]
impl EmbeddingProvider for OpenAiEmbedding {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let results = self.embed_internal(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| EmbedError::Model("未获取到 embedding".to_string()))
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let mut results = Vec::new();

        for chunk in texts.chunks(100) {
            let embeddings = self.embed_internal(chunk).await?;
            results.extend(embeddings);
        }

        Ok(results)
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn dimension(&self) -> usize {
        match self.model.as_str() {
            "text-embedding-3-large" => 3072,
            _ => 1536,
        }
    }
}

/// Placeholder for future Claude support.
pub struct ClaudeEmbedding {
    client: reqwest::Client,
    api_key: String,
}

impl ClaudeEmbedding {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            api_key,
        }
    }
}

#[async_trait]
impl EmbeddingProvider for ClaudeEmbedding {
    async fn embed(&self, _text: &str) -> Result<Vec<f32>, EmbedError> {
        let _ = (&self.client, &self.api_key);
        Err(EmbedError::Model(
            "Claude 暂不支持 Embedding API".to_string(),
        ))
    }

    async fn embed_batch(&self, _texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let _ = (&self.client, &self.api_key);
        Err(EmbedError::Model(
            "Claude 暂不支持 Embedding API".to_string(),
        ))
    }

    fn model_id(&self) -> &str {
        "claude-embedding"
    }

    fn dimension(&self) -> usize {
        1024
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_qwen_embedding_creation() {
        let embed = QwenEmbedding::new("test-key".to_string());
        assert_eq!(embed.model_id(), QWEN_DEFAULT_MODEL);
        assert_eq!(embed.dimension(), 1536);
    }

    #[test]
    fn test_openai_embedding_creation() {
        let embed = OpenAiEmbedding::new("test-key".to_string());
        assert_eq!(embed.model_id(), OPENAI_DEFAULT_MODEL);
        assert_eq!(embed.dimension(), 1536);
    }

    #[test]
    fn test_create_provider_from_runtime_config() {
        let provider = create_embedding_provider(&EmbeddingProviderConfig {
            provider: EmbeddingProviderKind::OpenAiCompatible,
            api_key: "test-key".to_string(),
            base_url: Some("https://example.com/v1/".to_string()),
            model: Some("text-embedding-3-large".to_string()),
        })
        .unwrap();

        assert_eq!(provider.model_id(), "text-embedding-3-large");
        assert_eq!(provider.dimension(), 3072);
    }

    #[test]
    fn test_runtime_config_rejects_empty_api_key() {
        let err = create_embedding_provider(&EmbeddingProviderConfig {
            provider: EmbeddingProviderKind::Qwen,
            api_key: "   ".to_string(),
            base_url: None,
            model: None,
        })
        .err()
        .unwrap();

        assert!(err.contains("API key"));
    }

    #[test]
    fn test_qwen_embedding_request_uses_openai_compatible_input_array() {
        let texts = vec!["ARP 协议会把 IP 地址解析为 MAC 地址".to_string()];

        let body = build_openai_compatible_embedding_body("text-embedding-v2", &texts);

        assert_eq!(body["model"], "text-embedding-v2");
        assert_eq!(
            body["input"],
            serde_json::json!(["ARP 协议会把 IP 地址解析为 MAC 地址"])
        );
        assert!(body.get("parameters").is_none());
    }
}
