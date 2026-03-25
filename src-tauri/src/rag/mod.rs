// RAG module - vector storage and retrieval

mod chunker;
mod context_builder;
mod embedder;
mod parser;
mod retriever;
mod vector_store;

pub use self::chunker::{
    chunk_document, chunk_message, merge_qa_pairs, Chunk, ChunkConfig, ChunkType, DocumentChunk,
    SimpleMessage,
};
pub use self::context_builder::{build_rag_context, ContextConfig};
pub use self::embedder::{
    create_embedding_provider, EmbedError, EmbeddingProvider, EmbeddingProviderConfig,
    EmbeddingProviderKind, OpenAiEmbedding, QwenEmbedding,
};
pub use self::parser::{
    parse_document, BlockKind, DocumentType, ParseOptions, ParsedBlock, ParsedDocument,
    ParsedDocumentMetadata,
};
pub use self::retriever::{SearchResult, SearchSource, SearchSourceKind};
pub use self::vector_store::{MessageEmbeddingEntry, MessageVectorStore, VectorStore};

use crate::database::Database;
use std::sync::{Arc, RwLock};

/// Main RAG engine.
pub struct RagEngine {
    /// Current implementation only indexes message history vectors.
    /// Knowledge-base document vectors will live in a dedicated store later.
    message_store: vector_store::MessageVectorStore,
    embedder: RwLock<Option<Arc<dyn embedder::EmbeddingProvider>>>,
}

impl RagEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            message_store: vector_store::MessageVectorStore::new(db),
            embedder: RwLock::new(None),
        }
    }

    /// Replace the current embedding provider with a concrete instance.
    pub fn set_embedding_provider(
        &self,
        provider: Arc<dyn embedder::EmbeddingProvider>,
    ) -> Result<(), String> {
        let mut guard = self.embedder.write().map_err(|e| e.to_string())?;
        *guard = Some(provider);
        Ok(())
    }

    /// Configure provider from a serializable runtime config.
    pub fn configure_embedding_provider(
        &self,
        config: embedder::EmbeddingProviderConfig,
    ) -> Result<(), String> {
        let provider = embedder::create_embedding_provider(&config)?;
        self.set_embedding_provider(provider)
    }

    pub fn clear_embedding_provider(&self) -> Result<(), String> {
        let mut guard = self.embedder.write().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }

    pub fn current_embedding_model_id(&self) -> Result<Option<String>, String> {
        let guard = self.embedder.read().map_err(|e| e.to_string())?;
        Ok(guard
            .as_ref()
            .map(|provider| provider.model_id().to_string()))
    }

    fn configured_embedder(&self) -> Result<Arc<dyn embedder::EmbeddingProvider>, String> {
        let guard = self.embedder.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Embedding provider 未配置".to_string())
    }

    fn hydrate_results(
        &self,
        results: Vec<retriever::SearchResult>,
    ) -> Vec<retriever::SearchResult> {
        results
            .into_iter()
            .map(|mut result| {
                if result.chunk_text.is_empty() {
                    if let Some(embedding_id) = result.embedding_id.as_deref() {
                        if let Ok(Some(text)) = self.message_store.get_chunk_text(embedding_id) {
                            result.chunk_text = text;
                        }
                    }
                }
                result
            })
            .collect()
    }

    pub async fn embed_message(&self, message_id: &str, content: &str) -> Result<(), String> {
        let embedder = self.configured_embedder()?;

        let chunks = chunker::chunk_message(content, &ChunkConfig::default());
        let texts: Vec<String> = chunks.iter().map(|chunk| chunk.text.clone()).collect();
        let embeddings = embedder
            .embed_batch(&texts)
            .await
            .map_err(|e| e.to_string())?;

        // Re-embedding a message should replace previous rows instead of duplicating them.
        self.message_store.delete_by_message_id(message_id)?;

        for (idx, chunk) in chunks.iter().enumerate() {
            self.message_store
                .insert_embedding(
                    message_id,
                    idx,
                    &chunk.text,
                    &embeddings[idx],
                    embedder.model_id(),
                    embedder.dimension(),
                )
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub async fn search(
        &self,
        query: &str,
        limit: usize,
        session_filter: Option<&str>,
    ) -> Result<Vec<retriever::SearchResult>, String> {
        let embedder = self.configured_embedder()?;
        let model_id = embedder.model_id().to_string();
        let query_embedding = embedder.embed(query).await.map_err(|e| e.to_string())?;

        let vector_results = retriever::vector_search_for_model(
            &self.message_store,
            &query_embedding,
            limit,
            0.7,
            session_filter,
            Some(model_id.as_str()),
        )?;

        let keyword_results = retriever::keyword_search(&self.message_store, query, limit)?;
        let fused = retriever::reciprocal_rank_fusion(vector_results, keyword_results, 60);

        Ok(self
            .hydrate_results(fused)
            .into_iter()
            .take(limit)
            .collect())
    }

    pub async fn build_context(
        &self,
        query: &str,
        config: &context_builder::ContextConfig,
    ) -> Result<String, String> {
        let results = self.search(query, config.max_results, None).await?;
        Ok(context_builder::build_rag_context(&results, config))
    }

    pub fn get_stats(&self) -> Result<RagStats, String> {
        self.message_store.get_stats()
    }

    pub fn delete_vectors(&self, message_id: &str) -> Result<(), String> {
        self.message_store.delete_by_message_id(message_id)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct RagStats {
    pub total: usize,
    pub messages: usize,
    pub storage_size: u64,
    pub model_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    struct MockEmbeddingProvider {
        model_id: String,
        embedding: Vec<f32>,
    }

    impl MockEmbeddingProvider {
        fn new(model_id: &str, embedding: Vec<f32>) -> Self {
            Self {
                model_id: model_id.to_string(),
                embedding,
            }
        }
    }

    #[async_trait]
    impl EmbeddingProvider for MockEmbeddingProvider {
        async fn embed(&self, _text: &str) -> Result<Vec<f32>, EmbedError> {
            Ok(self.embedding.clone())
        }

        async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
            Ok(texts.iter().map(|_| self.embedding.clone()).collect())
        }

        fn model_id(&self) -> &str {
            &self.model_id
        }

        fn dimension(&self) -> usize {
            self.embedding.len()
        }
    }

    fn create_test_db() -> Arc<Database> {
        let temp_dir =
            std::env::temp_dir().join(format!("rag_engine_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        Arc::new(crate::database::init_database(&temp_dir).unwrap())
    }

    fn create_message(db: &Arc<Database>, content: &str) -> String {
        let session = crate::database::create_session(db, None).unwrap();
        let session_id = session.get("id").and_then(|value| value.as_str()).unwrap();
        let message = crate::database::save_message(db, session_id, "user", content, None).unwrap();
        message
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap()
            .to_string()
    }

    #[test]
    fn test_engine_can_configure_runtime_provider() {
        let engine = RagEngine::new(create_test_db());

        engine
            .configure_embedding_provider(EmbeddingProviderConfig {
                provider: EmbeddingProviderKind::OpenAiCompatible,
                api_key: "test-key".to_string(),
                base_url: Some("https://example.com/v1/".to_string()),
                model: Some("text-embedding-3-large".to_string()),
            })
            .unwrap();

        let provider = engine.configured_embedder().unwrap();
        assert_eq!(provider.model_id(), "text-embedding-3-large");
        assert_eq!(provider.dimension(), 3072);
        assert_eq!(
            engine.current_embedding_model_id().unwrap(),
            Some("text-embedding-3-large".to_string())
        );
    }

    #[tokio::test]
    async fn test_embed_message_without_provider_fails() {
        let engine = RagEngine::new(create_test_db());
        let err = engine.embed_message("msg-1", "测试内容").await.unwrap_err();
        assert!(err.contains("Embedding provider 未配置"));
    }

    #[tokio::test]
    async fn test_search_without_provider_fails() {
        let engine = RagEngine::new(create_test_db());
        let err = engine.search("测试", 10, None).await.unwrap_err();
        assert!(err.contains("Embedding provider 未配置"));
    }

    #[tokio::test]
    async fn test_provider_switch_filters_search_to_current_model() {
        let db = create_test_db();
        let engine = RagEngine::new(db.clone());

        let first_message_id = create_message(&db, "Rust ownership");
        engine
            .set_embedding_provider(Arc::new(MockEmbeddingProvider::new(
                "mock-model-a",
                vec![1.0, 0.0],
            )))
            .unwrap();
        engine
            .embed_message(&first_message_id, "Rust ownership")
            .await
            .unwrap();

        let second_message_id = create_message(&db, "Tauri commands");
        engine
            .set_embedding_provider(Arc::new(MockEmbeddingProvider::new(
                "mock-model-b",
                vec![0.0, 1.0, 0.0],
            )))
            .unwrap();
        engine
            .embed_message(&second_message_id, "Tauri commands")
            .await
            .unwrap();

        let results = engine.search("Tauri commands", 10, None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].message_id.as_deref(),
            Some(second_message_id.as_str())
        );

        let first_entries = engine
            .message_store
            .load_embeddings_for_message(&first_message_id)
            .unwrap();
        let second_entries = engine
            .message_store
            .load_embeddings_for_message(&second_message_id)
            .unwrap();
        assert_eq!(first_entries[0].model_id, "mock-model-a");
        assert_eq!(second_entries[0].model_id, "mock-model-b");
    }

    #[test]
    fn test_search_result_hydration_fills_missing_chunk_text() {
        let db = create_test_db();
        let engine = RagEngine::new(db.clone());
        let message_id = create_message(&db, "Hydrated chunk");

        let embedding_id = engine
            .message_store
            .insert_embedding(
                &message_id,
                0,
                "Hydrated chunk",
                &[1.0, 0.0],
                "mock-model",
                2,
            )
            .unwrap();

        let hydrated = engine.hydrate_results(vec![SearchResult {
            chunk_id: format!("message:{message_id}:0"),
            embedding_id: Some(embedding_id),
            message_id: Some(message_id),
            document_id: None,
            chunk_text: String::new(),
            score: 1.0,
            source: SearchSource::Vector,
            source_kind: SearchSourceKind::Message,
        }]);

        assert_eq!(hydrated[0].chunk_text, "Hydrated chunk");
    }
}
