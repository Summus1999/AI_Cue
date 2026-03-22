// Embedding Provider - API 模式实现

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Embedding 错误类型
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

/// Embedding Provider 接口
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    /// 生成单条文本的 Embedding
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError>;
    
    /// 批量生成 Embedding
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
    
    /// 模型标识符
    fn model_id(&self) -> &str;
    
    /// 输出向量维度
    fn dimension(&self) -> usize;
}

/// Qwen text-embedding-v2 实现
pub struct QwenEmbedding {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl QwenEmbedding {
    /// 创建 Qwen Embedding Provider
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            api_key,
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/text-embedding".to_string(),
        }
    }
    
    /// 创建带自定义配置的 Qwen Embedding Provider
    pub fn with_config(api_key: String, base_url: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            api_key,
            base_url,
        }
    }

    async fn embed_internal(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let url = format!("{}/embeddings", self.base_url);
        
        let body = serde_json::json!({
            "model": "text-embedding-v2",
            "input": {
                "texts": texts
            },
            "parameters": {
                "text_type": "query"
            }
        });
        
        let resp = self.client.post(&url)
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
            model: String,
        }
        
        #[derive(Deserialize)]
        struct EmbedData {
            embedding: Vec<f32>,
            index: usize,
        }
        
        let embed_resp: EmbedResponse = resp.json().await
            .map_err(|e| EmbedError::Model(e.to_string()))?;
        
        // 按 index 排序
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
        results.into_iter().next()
            .ok_or_else(|| EmbedError::Model("未获取到 embedding".to_string()))
    }
    
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        // Qwen 支持单次最多 25 条文本
        let mut results = Vec::new();
        
        for chunk in texts.chunks(25) {
            let embeddings = self.embed_internal(chunk).await?;
            results.extend(embeddings);
        }
        
        Ok(results)
    }
    
    fn model_id(&self) -> &str {
        "qwen-text-embedding-v2"
    }
    
    fn dimension(&self) -> usize {
        1536
    }
}

/// OpenAI Embedding 实现
pub struct OpenAiEmbedding {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenAiEmbedding {
    pub fn new(api_key: String) -> Self {
        Self::with_model(api_key, "text-embedding-3-small".to_string())
    }
    
    pub fn with_model(api_key: String, model: String) -> Self {
        let base_url = if model.contains("3-large") {
            "https://api.openai.com/v1".to_string()
        } else {
            "https://api.openai.com/v1".to_string()
        };
        
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
        
        let resp = self.client.post(&url)
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
        
        let embed_resp: EmbedResponse = resp.json().await
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
        results.into_iter().next()
            .ok_or_else(|| EmbedError::Model("未获取到 embedding".to_string()))
    }
    
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        // OpenAI 支持单次最多 2048 条
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
            "text-embedding-3-small" | _ => 1536,
        }
    }
}

/// Claude Embedding 实现（如果未来支持）
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
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        // Claude 目前没有 Embedding API，这里返回错误
        Err(EmbedError::Model("Claude 暂不支持 Embedding API".to_string()))
    }
    
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        Err(EmbedError::Model("Claude 暂不支持 Embedding API".to_string()))
    }
    
    fn model_id(&self) -> &str {
        "claude-embedding"
    }
    
    fn dimension(&self) -> usize {
        1024 // 占位
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_qwen_embedding_creation() {
        let embed = QwenEmbedding::new("test-key".to_string());
        assert_eq!(embed.model_id(), "qwen-text-embedding-v2");
        assert_eq!(embed.dimension(), 1536);
    }
    
    #[test]
    fn test_openai_embedding_creation() {
        let embed = OpenAiEmbedding::new("test-key".to_string());
        assert_eq!(embed.model_id(), "text-embedding-3-small");
        assert_eq!(embed.dimension(), 1536);
    }
}
