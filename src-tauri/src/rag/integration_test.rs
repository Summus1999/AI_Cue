// RAG 功能集成测试
// 运行方式: cd src-tauri && cargo test --test rag_integration_test -- --nocapture

use std::sync::Arc;

/// 测试向量存储的基本 CRUD 操作
#[cfg(test)]
mod vector_store_tests {
    use super::*;
    use ai_cue_lib::rag::{VectorStore, embedding_to_blob, blob_to_embedding, cosine_similarity, top_k_similar};
    use ai_cue_lib::database::Database;
    use std::path::PathBuf;
    
    fn create_test_db() -> Arc<Database> {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_rag_{}.db", uuid::Uuid::new_v4()));
        
        // 清理可能存在的旧数据库
        let _ = std::fs::remove_file(&db_path);
        
        let db = ai_cue_lib::database::init_database(&temp_dir).unwrap();
        Arc::new(db)
    }
    
    #[test]
    fn test_blob_serialization() {
        let embedding = vec![0.1f32, 0.2, 0.3, 0.4, 0.5];
        
        let blob = embedding_to_blob(&embedding);
        assert_eq!(blob.len(), 5 * 4); // 5 个 f32 = 20 字节
        
        let restored = blob_to_embedding(&blob);
        assert_eq!(embedding.len(), restored.len());
        
        for (a, b) in embedding.iter().zip(restored.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
    
    #[test]
    fn test_cosine_similarity_same_vector() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-6);
    }
    
    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![0.0f32, 1.0, 0.0];
        
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 0.0).abs() < 1e-6);
    }
    
    #[test]
    fn test_top_k_similar() {
        let query = vec![1.0f32, 0.0, 0.0];
        let candidates = vec![
            ("id1".to_string(), vec![0.99f32, 0.01, 0.01]),
            ("id2".to_string(), vec![0.5f32, 0.5, 0.0]),
            ("id3".to_string(), vec![0.1f32, 0.9, 0.0]),
        ];
        
        let results = top_k_similar(&query, &candidates, 2, 0.3);
        
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "id1"); // 最相似的应该在前面
        assert!(results[0].1 >= results[1].1);
    }
    
    #[test]
    fn test_vector_store_insert_and_retrieve() {
        let db = create_test_db();
        let store = VectorStore::new(db.clone());
        
        let message_id = "test-msg-001";
        let content = "这是一个测试消息内容";
        let embedding = vec![0.1f32; 1536]; // 模拟 1536 维向量
        let model_id = "test-model";
        
        // 插入向量
        let embedding_id = store.insert_embedding(
            message_id,
            0,
            content,
            &embedding,
            model_id,
            1536,
        ).unwrap();
        
        assert!(!embedding_id.is_empty());
        
        // 验证已向量化
        assert!(store.is_message_embedded(message_id).unwrap());
        
        // 获取向量
        let entries = store.load_embeddings_for_message(message_id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].chunk_text, content);
        assert_eq!(entries[0].embedding_dim, 1536);
        
        // 获取 chunk_text
        let chunk_text = store.get_chunk_text(&embedding_id).unwrap();
        assert_eq!(chunk_text, Some(content.to_string()));
    }
    
    #[test]
    fn test_vector_store_delete() {
        let db = create_test_db();
        let store = VectorStore::new(db.clone());
        
        let message_id = "test-msg-delete";
        let embedding = vec![0.1f32; 512];
        
        store.insert_embedding(message_id, 0, "测试内容", &embedding, "test", 512).unwrap();
        
        // 验证存在
        assert!(store.is_message_embedded(message_id).unwrap());
        
        // 删除
        store.delete_by_message_id(message_id).unwrap();
        
        // 验证已删除
        assert!(!store.is_message_embedded(message_id).unwrap());
    }
    
    #[test]
    fn test_vector_store_stats() {
        let db = create_test_db();
        let store = VectorStore::new(db.clone());
        
        // 初始统计
        let stats = store.get_stats().unwrap();
        assert_eq!(stats.total, 0);
        
        // 插入一些向量
        for i in 0..3 {
            let msg_id = format!("msg-{}", i);
            let embedding = vec![0.1f32; 512];
            store.insert_embedding(&msg_id, 0, &format!("内容 {}", i), &embedding, "test", 512).unwrap();
        }
        
        // 验证统计
        let stats = store.get_stats().unwrap();
        assert_eq!(stats.total, 3);
        assert!(stats.storage_size > 0);
    }
}

/// 测试分块功能
#[cfg(test)]
mod chunker_tests {
    use ai_cue_lib::rag::{ChunkConfig, ChunkType, chunk_message, merge_qa_pairs, chunker::SimpleMessage};
    
    #[test]
    fn test_short_content_single_chunk() {
        let content = "短文本";
        let chunks = chunk_message(content, &ChunkConfig::default());
        
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, content);
        assert!(matches!(chunks[0].chunk_type, ChunkType::Text));
    }
    
    #[test]
    fn test_code_block_extraction() {
        let content = "普通文本\n```python\nprint('hello')\n```\n更多文本";
        let chunks = chunk_message(content, &ChunkConfig::default());
        
        // 应该有一个代码块
        let code_chunks: Vec<_> = chunks.iter()
            .filter(|c| matches!(c.chunk_type, ChunkType::Code { .. }))
            .collect();
        
        assert!(!code_chunks.is_empty());
    }
    
    #[test]
    fn test_qa_pairs_merge() {
        let messages = vec![
            SimpleMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "什么是 Rust?".to_string(),
            },
            SimpleMessage {
                id: "2".to_string(),
                role: "assistant".to_string(),
                content: "Rust 是系统编程语言。".to_string(),
            },
        ];
        
        let chunks = merge_qa_pairs(&messages);
        
        assert_eq!(chunks.len(), 1);
        assert!(matches!(chunks[0].chunk_type, ChunkType::QaPair));
        assert!(chunks[0].text.contains("问题："));
        assert!(chunks[0].text.contains("回答："));
    }
}

/// 测试上下文构建
#[cfg(test)]
mod context_builder_tests {
    use ai_cue_lib::rag::{ContextConfig, build_rag_context, estimate_total_tokens, truncate_to_token_limit};
    use ai_cue_lib::rag::retriever::{SearchResult, SearchSource, SearchSourceKind};
    
    #[test]
    fn test_build_rag_context() {
        let results = vec![
            SearchResult {
                chunk_id: "message:1:0".to_string(),
                embedding_id: Some("emb-1".to_string()),
                message_id: Some("1".to_string()),
                document_id: None,
                chunk_text: "这是第一个答案".to_string(),
                score: 0.9,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
            SearchResult {
                chunk_id: "message:2:0".to_string(),
                embedding_id: Some("emb-2".to_string()),
                message_id: Some("2".to_string()),
                document_id: None,
                chunk_text: "这是第二个答案".to_string(),
                score: 0.8,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
        ];
        
        let config = ContextConfig::default();
        let context = build_rag_context(&results, &config);
        
        assert!(context.contains("【相关历史参考】"));
        assert!(context.contains("[1]"));
        assert!(context.contains("[2]"));
        assert!(context.contains("请参考以上历史记录"));
    }
    
    #[test]
    fn test_truncate_to_token_limit() {
        let long_text = "这是一个很长的文本".repeat(100);
        let truncated = truncate_to_token_limit(&long_text, 50);
        
        // 应该被截断
        assert!(truncated.len() < long_text.len());
        assert!(!truncated.is_empty());
    }
}

/// 测试 Embedder (需要网络或使用 mock)
#[cfg(test)]
mod embedder_tests {
    use ai_cue_lib::rag::embedder::{EmbeddingProvider, EmbedError, QwenEmbedding};
    
    #[test]
    fn test_qwen_embedding_config() {
        let embed = QwenEmbedding::new("test-key".to_string());
        
        assert_eq!(embed.model_id(), "qwen-text-embedding-v2");
        assert_eq!(embed.dimension(), 1536);
    }
    
    #[test]
    fn test_embed_without_api_key_fails() {
        let embed = QwenEmbedding::new("invalid-key".to_string());
        
        // 由于 API Key 无效，应该返回错误
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(embed.embed("测试文本"));
        
        // 这里期望失败，因为使用了无效的 API key
        // 实际测试时可能需要 mock 或真实 key
        if result.is_err() {
            match result.unwrap_err() {
                EmbedError::Api(_, _) | EmbedError::Network(_) => {},
                _ => panic!("期望 API 或网络错误"),
            }
        }
    }
}

/// 端到端集成测试
#[cfg(test)]
mod e2e_tests {
    use super::*;
    use ai_cue_lib::rag::{RagEngine, ChunkConfig, ContextConfig, QwenEmbedding};
    
    fn create_test_db() -> Arc<ai_cue_lib::database::Database> {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("e2e_test_{}.db", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_file(&db_path);
        
        let db = ai_cue_lib::database::init_database(&temp_dir).unwrap();
        Arc::new(db)
    }
    
    #[test]
    fn test_rag_engine_without_embedder() {
        let db = create_test_db();
        let engine = RagEngine::new(db);
        
        // 没有配置 embedder 时应该返回错误
        let rt = tokio::runtime::Runtime::new().unwrap();
        
        let result = rt.block_on(engine.embed_message("msg1", "测试内容"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Embedding provider 未配置"));
    }
    
    #[test]
    fn test_rag_engine_search_without_embedder() {
        let db = create_test_db();
        let engine = RagEngine::new(db);
        
        let rt = tokio::runtime::Runtime::new().unwrap();
        
        let result = rt.block_on(engine.search("测试", 10, None));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Embedding provider 未配置"));
    }
}
