// 检索系统 - 向量检索、关键词检索、RRF 融合

use crate::database::Database;
use crate::rag::vector_store::{MessageEmbeddingEntry, MessageVectorStore};

/// 检索结果
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// 知识库 ID。消息检索时为空。
    pub knowledge_base_id: Option<String>,
    /// 统一的分块标识。消息分块格式为 `message:{message_id}:{chunk_idx}`。
    pub chunk_id: String,
    /// 向量表中的条目 ID。关键词检索结果可能为空。
    pub embedding_id: Option<String>,
    /// 消息来源 ID。知识库文档检索时可能为空。
    pub message_id: Option<String>,
    /// 知识库文档 ID。消息检索时为空。
    pub document_id: Option<String>,
    /// 前端可直接展示的标题。消息检索默认为“历史消息”。
    pub title: String,
    /// 原始 chunk 文本，用于构建上下文。
    pub chunk_text: String,
    /// 前端或引用面板可直接消费的摘要片段。
    pub snippet: String,
    /// 便于引用展示的页码。
    pub page_number: Option<u32>,
    /// 便于引用展示的标题路径。
    pub heading_path: Vec<String>,
    pub score: f32,
    pub source: SearchSource,
    /// 结果来源对象类型，避免把 message/document/embedding 标识混用。
    pub source_kind: SearchSourceKind,
}

/// 检索来源
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SearchSource {
    Vector,
    Keyword,
    Hybrid,
}

/// 检索命中的来源对象类型
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone)]
struct KnowledgeEmbeddingEntry {
    embedding_id: String,
    knowledge_base_id: String,
    document_id: String,
    chunk_id: String,
    title: String,
    chunk_text: String,
    page_number: Option<u32>,
    heading_path: Vec<String>,
    embedding: Vec<f32>,
    embedding_dim: usize,
}

const SEARCH_SNIPPET_MAX_CHARS: usize = 180;

pub(crate) fn build_search_snippet(text: &str) -> String {
    let trimmed = text.trim();
    let mut snippet = trimmed
        .chars()
        .take(SEARCH_SNIPPET_MAX_CHARS)
        .collect::<String>();
    if trimmed.chars().count() > SEARCH_SNIPPET_MAX_CHARS {
        snippet.push_str("...");
    }
    snippet
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

/// 统一向量检索（消息 + 知识库文档）。
pub fn combined_vector_search_for_model(
    store: &MessageVectorStore,
    db: &Database,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    session_filter: Option<&str>,
    model_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let mut results = vector_search_for_model(
        store,
        query_embedding,
        limit,
        threshold,
        session_filter,
        model_filter,
    )?;
    results.extend(knowledge_vector_search_with_db(
        db,
        query_embedding,
        limit,
        threshold,
        model_filter,
    )?);
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);
    Ok(results)
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
                knowledge_base_id: None,
                chunk_id: format!("message:{}:{}", entry.message_id, entry.chunk_idx),
                embedding_id: Some(embedding_id),
                message_id: Some(entry.message_id.clone()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: entry.chunk_text.clone(),
                snippet: build_search_snippet(&entry.chunk_text),
                page_number: None,
                heading_path: Vec::new(),
                score,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            })
        })
        .collect()
}

/// 知识库文档向量检索（基于 kb_embeddings + kb_chunks）。
pub fn knowledge_vector_search_with_db(
    db: &Database,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    model_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    match model_filter {
        Some(model_id) => {
            let mut stmt = conn
                .prepare(
                    "SELECT ke.id, ke.knowledge_base_id, ke.document_id, ke.chunk_id, kd.title,
                            kc.text, kc.page_number, kc.heading_path, ke.embedding, ke.embedding_dim
                     FROM kb_embeddings ke
                     INNER JOIN kb_chunks kc ON kc.id = ke.chunk_id
                     INNER JOIN kb_documents kd ON kd.id = ke.document_id
                     WHERE kd.index_state = 'ready' AND ke.model_id = ?1
                     ORDER BY ke.created_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![model_id], |row| {
                    let blob: Vec<u8> = row.get(8)?;
                    let heading_path_json: String = row.get(7)?;
                    Ok(KnowledgeEmbeddingEntry {
                        embedding_id: row.get(0)?,
                        knowledge_base_id: row.get(1)?,
                        document_id: row.get(2)?,
                        chunk_id: row.get(3)?,
                        title: row.get(4)?,
                        chunk_text: row.get(5)?,
                        page_number: row.get::<_, Option<i64>>(6)?.map(|value| value as u32),
                        heading_path: serde_json::from_str(&heading_path_json).unwrap_or_default(),
                        embedding: MessageVectorStore::blob_to_embedding(&blob),
                        embedding_dim: row.get::<_, i32>(9)? as usize,
                    })
                })
                .map_err(|e| e.to_string())?;

            for row in rows {
                entries.push(row.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT ke.id, ke.knowledge_base_id, ke.document_id, ke.chunk_id, kd.title,
                            kc.text, kc.page_number, kc.heading_path, ke.embedding, ke.embedding_dim
                     FROM kb_embeddings ke
                     INNER JOIN kb_chunks kc ON kc.id = ke.chunk_id
                     INNER JOIN kb_documents kd ON kd.id = ke.document_id
                     WHERE kd.index_state = 'ready'
                     ORDER BY ke.created_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    let blob: Vec<u8> = row.get(8)?;
                    let heading_path_json: String = row.get(7)?;
                    Ok(KnowledgeEmbeddingEntry {
                        embedding_id: row.get(0)?,
                        knowledge_base_id: row.get(1)?,
                        document_id: row.get(2)?,
                        chunk_id: row.get(3)?,
                        title: row.get(4)?,
                        chunk_text: row.get(5)?,
                        page_number: row.get::<_, Option<i64>>(6)?.map(|value| value as u32),
                        heading_path: serde_json::from_str(&heading_path_json).unwrap_or_default(),
                        embedding: MessageVectorStore::blob_to_embedding(&blob),
                        embedding_dim: row.get::<_, i32>(9)? as usize,
                    })
                })
                .map_err(|e| e.to_string())?;

            for row in rows {
                entries.push(row.map_err(|e| e.to_string())?);
            }
        }
    }

    let candidates: Vec<(String, Vec<f32>)> = entries
        .iter()
        .filter(|entry| entry.embedding_dim == query_embedding.len())
        .map(|entry| (entry.embedding_id.clone(), entry.embedding.clone()))
        .collect();
    let top_results =
        MessageVectorStore::top_k_similar(query_embedding, &candidates, limit, threshold);
    let entries_by_embedding_id = entries
        .iter()
        .map(|entry| (entry.embedding_id.as_str(), entry))
        .collect::<std::collections::HashMap<_, _>>();

    Ok(top_results
        .into_iter()
        .filter_map(|(embedding_id, score)| {
            let entry = entries_by_embedding_id.get(embedding_id.as_str())?;

            Some(SearchResult {
                knowledge_base_id: Some(entry.knowledge_base_id.clone()),
                chunk_id: entry.chunk_id.clone(),
                embedding_id: Some(entry.embedding_id.clone()),
                message_id: None,
                document_id: Some(entry.document_id.clone()),
                title: entry.title.clone(),
                chunk_text: entry.chunk_text.clone(),
                snippet: build_search_snippet(&entry.chunk_text),
                page_number: entry.page_number,
                heading_path: entry.heading_path.clone(),
                score,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::KnowledgeBaseDocument,
            })
        })
        .collect())
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
                knowledge_base_id: None,
                chunk_id: format!("message:{id}:keyword"),
                embedding_id: None,
                message_id: Some(id),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: content.chars().take(200).collect(),
                snippet: build_search_snippet(&content),
                page_number: None,
                heading_path: Vec::new(),
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

    fn create_test_knowledge_embedding(
        db: &Arc<database::Database>,
        title: &str,
        model_id: &str,
        embedding: Vec<f32>,
    ) -> (String, String, String, String) {
        let knowledge_base = database::create_knowledge_base(
            db,
            database::CreateKnowledgeBaseInput {
                name: format!("KB-{title}"),
                description: Some("retriever test".to_string()),
            },
        )
        .unwrap();

        let document = database::create_knowledge_document(
            db,
            database::CreateKnowledgeDocumentInput {
                knowledge_base_id: knowledge_base.id.clone(),
                title: title.to_string(),
                file_name: format!("{title}.md"),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: format!("C:/docs/{title}.md"),
                source_byte_size: 128,
                source_modified_at: 1,
                content_hash: format!("hash-{title}"),
                fingerprint: format!("fp-{title}"),
                index_state: Some(database::KnowledgeDocumentIndexState::Indexing),
                last_error: None,
            },
        )
        .unwrap();

        let chunk = database::insert_knowledge_chunks(
            db,
            &document.id,
            &[database::CreateKnowledgeChunkInput {
                chunk_index: 0,
                text: format!("{title} chunk text"),
                chunk_type: "text".to_string(),
                heading_path: vec![title.to_string()],
                page_number: Some(1),
                language: Some("zh".to_string()),
                start_offset: 0,
                end_offset: title.len(),
                block_count: 1,
            }],
        )
        .unwrap()
        .remove(0);

        let embedding_record = database::insert_knowledge_embeddings(
            db,
            &[database::CreateKnowledgeEmbeddingInput {
                knowledge_base_id: knowledge_base.id.clone(),
                document_id: document.id.clone(),
                chunk_id: chunk.id.clone(),
                embedding_dim: embedding.len(),
                embedding,
                model_id: model_id.to_string(),
            }],
        )
        .unwrap()
        .remove(0);

        (
            knowledge_base.id,
            document.id,
            chunk.id,
            embedding_record.id,
        )
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
        assert_eq!(result.title, "历史消息");
        assert_eq!(result.chunk_text, "Rust ownership 规则");
        assert_eq!(result.snippet, "Rust ownership 规则");
        assert_eq!(result.page_number, None);
        assert!(result.heading_path.is_empty());
        assert_eq!(result.source_kind, SearchSourceKind::Message);
    }

    #[test]
    fn test_knowledge_vector_search_returns_document_chunk_identity() {
        let (_store, db) = create_test_store();
        let embedding = vec![1.0f32, 0.0, 0.0];
        let (knowledge_base_id, document_id, chunk_id, embedding_id) =
            create_test_knowledge_embedding(&db, "Rust KB", "kb-model-a", embedding.clone());
        let _ = create_test_knowledge_embedding(&db, "Other KB", "kb-model-b", vec![0.0, 1.0, 0.0]);

        let results =
            knowledge_vector_search_with_db(&db, &embedding, 5, 0.5, Some("kb-model-a")).unwrap();

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(
            result.knowledge_base_id.as_deref(),
            Some(knowledge_base_id.as_str())
        );
        assert_eq!(result.embedding_id.as_deref(), Some(embedding_id.as_str()));
        assert_eq!(result.document_id.as_deref(), Some(document_id.as_str()));
        assert_eq!(result.chunk_id, chunk_id);
        assert_eq!(result.message_id, None);
        assert_eq!(result.title, "Rust KB");
        assert_eq!(result.chunk_text, "Rust KB chunk text");
        assert_eq!(result.snippet, "Rust KB chunk text");
        assert_eq!(result.page_number, Some(1));
        assert_eq!(result.heading_path, vec!["Rust KB".to_string()]);
        assert_eq!(result.source_kind, SearchSourceKind::KnowledgeBaseDocument);
    }

    #[test]
    fn test_combined_vector_search_includes_message_and_knowledge_results() {
        let (store, db) = create_test_store();
        let embedding = vec![1.0f32, 0.0, 0.0];
        let session = database::create_session(&db, None).unwrap();
        let session_id = session.get("id").and_then(|value| value.as_str()).unwrap();
        let message =
            database::save_message(&db, session_id, "user", "Rust ownership 规则", None).unwrap();
        let message_id = message.get("id").and_then(|value| value.as_str()).unwrap();

        store
            .insert_embedding(
                message_id,
                0,
                "Rust ownership 规则",
                &embedding,
                "shared-model",
                embedding.len(),
            )
            .unwrap();

        let (_knowledge_base_id, _document_id, _chunk_id, _embedding_id) =
            create_test_knowledge_embedding(&db, "Rust KB", "shared-model", embedding.clone());

        let results = combined_vector_search_for_model(
            &store,
            &db,
            &embedding,
            5,
            0.5,
            None,
            Some("shared-model"),
        )
        .unwrap();

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .any(|result| result.source_kind == SearchSourceKind::Message));
        assert!(results
            .iter()
            .any(|result| result.source_kind == SearchSourceKind::KnowledgeBaseDocument));
    }

    #[test]
    fn test_combined_vector_search_filters_low_similarity_results() {
        let (store, db) = create_test_store();
        let indexed_embedding = vec![1.0f32, 0.0, 0.0];
        let query_embedding = vec![0.0f32, 1.0, 0.0];
        let session = database::create_session(&db, None).unwrap();
        let session_id = session.get("id").and_then(|value| value.as_str()).unwrap();
        let message =
            database::save_message(&db, session_id, "user", "Rust ownership 规则", None).unwrap();
        let message_id = message.get("id").and_then(|value| value.as_str()).unwrap();

        store
            .insert_embedding(
                message_id,
                0,
                "Rust ownership 规则",
                &indexed_embedding,
                "shared-model",
                indexed_embedding.len(),
            )
            .unwrap();

        let _ = create_test_knowledge_embedding(
            &db,
            "Rust KB",
            "shared-model",
            indexed_embedding.clone(),
        );

        let results = combined_vector_search_for_model(
            &store,
            &db,
            &query_embedding,
            5,
            0.7,
            None,
            Some("shared-model"),
        )
        .unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn test_reciprocal_rank_fusion() {
        let vector_results = vec![
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:1:0".to_string(),
                embedding_id: Some("emb-1".to_string()),
                message_id: Some("1".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "文本1".to_string(),
                snippet: "文本1".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.0,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:2:0".to_string(),
                embedding_id: Some("emb-2".to_string()),
                message_id: Some("2".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "文本2".to_string(),
                snippet: "文本2".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.0,
                source: SearchSource::Vector,
                source_kind: SearchSourceKind::Message,
            },
        ];

        let keyword_results = vec![
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:2:keyword".to_string(),
                embedding_id: None,
                message_id: Some("2".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "文本2".to_string(),
                snippet: "文本2".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.0,
                source: SearchSource::Keyword,
                source_kind: SearchSourceKind::Message,
            },
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:3:keyword".to_string(),
                embedding_id: None,
                message_id: Some("3".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "文本3".to_string(),
                snippet: "文本3".to_string(),
                page_number: None,
                heading_path: Vec::new(),
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
