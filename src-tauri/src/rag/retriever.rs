// 检索系统 - 向量检索、关键词检索、RRF 融合

use crate::rag::vector_store::{MessageEmbeddingEntry, MessageVectorStore};

/// 检索结果
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// 统一的分块标识。消息分块格式为 `message:{message_id}:{chunk_idx}`。
    pub chunk_id: String,
    /// 向量表中的条目 ID。关键词检索结果可能为空。
    pub embedding_id: Option<String>,
    /// 消息来源 ID。知识库文档检索时可能为空。
    pub message_id: Option<String>,
    /// 知识库文档 ID。消息检索时为空。
    pub document_id: Option<String>,
    pub chunk_text: String,
    pub score: f32,
    pub source: SearchSource,
    /// 结果来源对象类型，避免把 message/document/embedding 标识混用。
    pub source_kind: SearchSourceKind,
}

/// 检索来源
#[derive(Debug, Clone, PartialEq)]
pub enum SearchSource {
    Vector,
    Keyword,
    Hybrid,
}

/// 检索命中的来源对象类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchSourceKind {
    Message,
    KnowledgeBaseDocument,
}

impl SearchResult {
    pub fn fusion_key(&self) -> String {
        if let Some(message_id) = &self.message_id {
            return format!("message:{message_id}");
        }

        if let Some(document_id) = &self.document_id {
            return format!("document:{document_id}:{}", self.chunk_id);
        }

        format!("chunk:{}", self.chunk_id)
    }
}

/// 向量检索
pub fn vector_search(
    store: &MessageVectorStore,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    session_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let entries = store.load_all_embeddings(session_filter)?;
    Ok(vector_search_entries(
        entries,
        query_embedding,
        limit,
        threshold,
    ))
}

/// 向量检索（按当前模型过滤）。
pub fn vector_search_for_model(
    store: &MessageVectorStore,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    session_filter: Option<&str>,
    model_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let entries = store.load_embeddings(session_filter, model_filter)?;
    Ok(vector_search_entries(
        entries,
        query_embedding,
        limit,
        threshold,
    ))
}

fn vector_search_entries(
    entries: Vec<MessageEmbeddingEntry>,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
) -> Vec<SearchResult> {
    use std::collections::HashMap;

    let candidates: Vec<(String, Vec<f32>)> = entries
        .iter()
        .filter(|entry| entry.embedding_dim == query_embedding.len())
        .map(|e| (e.id.clone(), e.embedding.clone()))
        .collect();

    let top_results =
        MessageVectorStore::top_k_similar(query_embedding, &candidates, limit, threshold);
    let entries_by_embedding_id: HashMap<&str, &MessageEmbeddingEntry> = entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect();

    top_results
        .into_iter()
        .filter_map(|(embedding_id, score)| {
            let entry = entries_by_embedding_id.get(embedding_id.as_str())?;

            Some(SearchResult {
                chunk_id: format!("message:{}:{}", entry.message_id, entry.chunk_idx),
                embedding_id: Some(embedding_id),
                message_id: Some(entry.message_id.clone()),
                document_id: None,
                chunk_text: entry.chunk_text.clone(),
                score,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            })
        })
        .collect()
}

/// 关键词检索（基于 SQLite LIKE）
pub fn keyword_search(
    store: &MessageVectorStore,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    // 这里需要访问数据库，使用 store 的数据库连接
    // 由于 VectorStore 不直接暴露数据库，我们通过获取所有 embeddings 后过滤
    // 实际实现中应该在 VectorStore 中添加 keyword_search 方法

    // 简化实现：返回空结果，实际使用时关键词检索依赖 SQLite LIKE
    // 在完整实现中，应该直接查询 messages 表
    let _ = (store, query, limit);

    Ok(Vec::new())
}

/// 关键词检索（使用数据库）
pub fn keyword_search_with_db(
    db: &crate::database::Database,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let search_pattern = format!("%{}%", query);

    let mut stmt = conn
        .prepare(
            "SELECT id, content FROM messages 
         WHERE content LIKE ?1 
         ORDER BY LENGTH(content) ASC
         LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(rusqlite::params![search_pattern, limit as i32], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let search_results: Vec<SearchResult> = results
        .filter_map(|r| r.ok())
        .map(|(id, content)| {
            // 计算简单的关键词匹配分数
            let query_lower = query.to_lowercase();
            let content_lower = content.to_lowercase();
            let count = content_lower.matches(&query_lower).count();
            let score = (count as f32).min(1.0);

            SearchResult {
                chunk_id: format!("message:{id}:keyword"),
                embedding_id: None,
                message_id: Some(id),
                document_id: None,
                chunk_text: content.chars().take(200).collect(),
                score,
                source: SearchSource::Keyword,
                source_kind: SearchSourceKind::Message,
            }
        })
        .collect();

    Ok(search_results)
}

/// RRF（倒数排名融合）
pub fn reciprocal_rank_fusion(
    vector_results: Vec<SearchResult>,
    keyword_results: Vec<SearchResult>,
    k: usize, // RRF 常数，通常为 60
) -> Vec<SearchResult> {
    use std::collections::HashMap;

    let mut scores: HashMap<String, (f32, SearchResult)> = HashMap::new();

    // 向量结果贡献（权重 70%）
    for (rank, r) in vector_results.iter().enumerate() {
        let rrf_score = 1.0 / (k as f32 + rank as f32 + 1.0);
        let weighted_score = rrf_score * 0.7;

        scores
            .entry(r.fusion_key())
            .and_modify(|(_, existing)| {
                existing.score += weighted_score;
                if existing.source == SearchSource::Vector {
                    existing.source = SearchSource::Hybrid;
                }
            })
            .or_insert_with(|| {
                let mut result = r.clone();
                result.score = weighted_score;
                result.source = SearchSource::Vector;
                (weighted_score, result)
            });
    }

    // 关键词结果贡献（权重 30%）
    for (rank, r) in keyword_results.iter().enumerate() {
        let rrf_score = 1.0 / (k as f32 + rank as f32 + 1.0);
        let weighted_score = rrf_score * 0.3;

        scores
            .entry(r.fusion_key())
            .and_modify(|(_, existing)| {
                existing.score += weighted_score;
                // 如果之前是 Vector（来自向量搜索），则变为 Hybrid
                if existing.source == SearchSource::Vector {
                    existing.source = SearchSource::Hybrid;
                }
            })
            .or_insert_with(|| {
                let mut result = r.clone();
                result.score = weighted_score;
                result.source = SearchSource::Keyword;
                (weighted_score, result)
            });
    }

    let mut results: Vec<_> = scores.into_values().map(|(_, result)| result).collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    results
}

/// 混合检索（向量 + 关键词）
pub fn hybrid_search(
    store: &MessageVectorStore,
    query: &[f32],
    query_text: &str,
    limit: usize,
    threshold: f32,
    db: Option<&crate::database::Database>,
) -> Result<Vec<SearchResult>, String> {
    // 向量检索
    let vector_results = vector_search(store, query, limit, threshold, None)?;

    // 关键词检索
    let keyword_results = if let Some(database) = db {
        keyword_search_with_db(database, query_text, limit)?
    } else {
        Vec::new()
    };

    // RRF 融合
    Ok(reciprocal_rank_fusion(vector_results, keyword_results, 60))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;
    use std::sync::Arc;

    fn create_test_store() -> (MessageVectorStore, Arc<database::Database>) {
        let temp_dir =
            std::env::temp_dir().join(format!("retriever_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db = Arc::new(database::init_database(&temp_dir).unwrap());
        (MessageVectorStore::new(db.clone()), db)
    }

    #[test]
    fn test_vector_search_returns_message_and_chunk_identity() {
        let (store, db) = create_test_store();
        let chunk_idx = 3usize;
        let embedding = vec![1.0f32, 0.0, 0.0];
        let session = database::create_session(&db, None).unwrap();
        let session_id = session.get("id").and_then(|value| value.as_str()).unwrap();
        let message =
            database::save_message(&db, session_id, "user", "Rust ownership 规则", None).unwrap();
        let message_id = message.get("id").and_then(|value| value.as_str()).unwrap();

        let embedding_id = store
            .insert_embedding(
                message_id,
                chunk_idx,
                "Rust ownership 规则",
                &embedding,
                "test-model",
                embedding.len(),
            )
            .unwrap();

        let results = vector_search(&store, &embedding, 5, 0.5, None).unwrap();
        assert_eq!(results.len(), 1);

        let result = &results[0];
        assert_eq!(result.embedding_id.as_deref(), Some(embedding_id.as_str()));
        assert_eq!(result.message_id.as_deref(), Some(message_id));
        assert_eq!(result.chunk_id, format!("message:{message_id}:{chunk_idx}"));
        assert_eq!(result.document_id, None);
        assert_eq!(result.chunk_text, "Rust ownership 规则");
        assert_eq!(result.source_kind, SearchSourceKind::Message);
    }

    #[test]
    fn test_reciprocal_rank_fusion() {
        let vector_results = vec![
            SearchResult {
                chunk_id: "message:1:0".to_string(),
                embedding_id: Some("emb-1".to_string()),
                message_id: Some("1".to_string()),
                document_id: None,
                chunk_text: "文本1".to_string(),
                score: 0.0,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
            SearchResult {
                chunk_id: "message:2:0".to_string(),
                embedding_id: Some("emb-2".to_string()),
                message_id: Some("2".to_string()),
                document_id: None,
                chunk_text: "文本2".to_string(),
                score: 0.0,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
        ];

        let keyword_results = vec![
            SearchResult {
                chunk_id: "message:2:keyword".to_string(),
                embedding_id: None,
                message_id: Some("2".to_string()),
                document_id: None,
                chunk_text: "文本2".to_string(),
                score: 0.0,
                source: SearchSource::Keyword,
                source_kind: SearchSourceKind::Message,
            },
            SearchResult {
                chunk_id: "message:3:keyword".to_string(),
                embedding_id: None,
                message_id: Some("3".to_string()),
                document_id: None,
                chunk_text: "文本3".to_string(),
                score: 0.0,
                source: SearchSource::Keyword,
                source_kind: SearchSourceKind::Message,
            },
        ];

        let fused = reciprocal_rank_fusion(vector_results, keyword_results, 60);

        // "2" 应该在结果中，并且是 Hybrid 类型
        assert_eq!(fused.len(), 3);
        let result_2 = fused
            .iter()
            .find(|r| r.message_id.as_deref() == Some("2"))
            .unwrap();
        assert_eq!(result_2.source, SearchSource::Hybrid);
    }
}
