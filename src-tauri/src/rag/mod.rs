// RAG 模块 - 向量存储与检索

mod chunker;
mod context_builder;
mod embedder;
mod parser;
mod retriever;
mod vector_store;

// 公开导出
pub use self::chunker::{Chunk, ChunkConfig, ChunkType, DocumentChunk, SimpleMessage, chunk_document, chunk_message, merge_qa_pairs};
pub use self::context_builder::{build_rag_context, ContextConfig};
pub use self::embedder::{EmbeddingProvider, EmbedError, QwenEmbedding};
pub use self::parser::{BlockKind, DocumentType, ParseOptions, ParsedBlock, ParsedDocument, ParsedDocumentMetadata, parse_document};
pub use self::retriever::{SearchResult, SearchSource};
pub use self::vector_store::VectorStore;

// 内部使用
use crate::database::Database;
use std::sync::Arc;

/// RAG 引擎主结构
pub struct RagEngine {
    store: vector_store::VectorStore,
    embedder: Option<embedder::QwenEmbedding>,
}

impl RagEngine {
    /// 创建 RAG 引擎
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            store: vector_store::VectorStore::new(db),
            embedder: None,
        }
    }

    /// 配置 Embedding Provider
    pub fn with_embedder(mut self, embedder: embedder::QwenEmbedding) -> Self {
        self.embedder = Some(embedder);
        self
    }

    /// 向量化单条消息
    pub async fn embed_message(&self, message_id: &str, content: &str) -> Result<(), String> {
        let embedder = self.embedder.as_ref()
            .ok_or_else(|| "Embedding provider 未配置".to_string())?;
        
        // 分块
        let chunks = chunker::chunk_message(content, &ChunkConfig::default());
        
        // 批量向量化
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let embeddings: Vec<Vec<f32>> = embedder.embed_batch(&texts).await
            .map_err(|e| e.to_string())?;
        
        // 存储向量
        for (idx, chunk) in chunks.iter().enumerate() {
            self.store.insert_embedding(
                message_id,
                idx,
                &chunk.text,
                &embeddings[idx],
                embedder.model_id(),
                embedder.dimension(),
            ).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }

    /// 语义检索
    pub async fn search(&self, query: &str, limit: usize, session_filter: Option<&str>) -> Result<Vec<retriever::SearchResult>, String> {
        let embedder = self.embedder.as_ref()
            .ok_or_else(|| "Embedding provider 未配置".to_string())?;
        
        // 查询向量化
        let query_embedding: Vec<f32> = embedder.embed(query).await
            .map_err(|e| e.to_string())?;
        
        // 向量检索
        let vector_results = retriever::vector_search(
            &self.store,
            &query_embedding,
            limit,
            0.7,
            session_filter,
        )?;
        
        // 关键词检索
        let keyword_results = retriever::keyword_search(
            &self.store,
            query,
            limit,
        )?;
        
        // RRF 融合
        let fused = retriever::reciprocal_rank_fusion(vector_results, keyword_results, 60);
        
        Ok(fused.into_iter().take(limit).collect())
    }

    /// 构建 RAG 增强上下文
    pub async fn build_context(&self, query: &str, config: &context_builder::ContextConfig) -> Result<String, String> {
        let results = self.search(query, config.max_results, None).await?;
        
        // 填充 chunk_text
        let results_with_text: Vec<retriever::SearchResult> = results.into_iter().map(|mut r| {
            if let Ok(Some(text)) = self.store.get_chunk_text(&r.message_id) {
                r.chunk_text = text;
            }
            r
        }).collect();
        
        Ok(context_builder::build_rag_context(&results_with_text, config))
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> Result<RagStats, String> {
        self.store.get_stats()
    }

    /// 删除消息的向量
    pub fn delete_vectors(&self, message_id: &str) -> Result<(), String> {
        self.store.delete_by_message_id(message_id)
    }
}

/// RAG 统计信息
#[derive(Debug, serde::Serialize)]
pub struct RagStats {
    pub total: usize,
    pub messages: usize,
    pub storage_size: u64,
    pub model_id: Option<String>,
}
