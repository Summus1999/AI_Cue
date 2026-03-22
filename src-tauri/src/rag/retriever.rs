// 检索系统 - 向量检索、关键词检索、RRF 融合

use crate::rag::vector_store::VectorStore;

/// 检索结果
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub message_id: String,
    pub chunk_text: String,
    pub score: f32,
    pub source: SearchSource,
}

/// 检索来源
#[derive(Debug, Clone, PartialEq)]
pub enum SearchSource {
    Vector,
    Keyword,
    Hybrid,
}

/// 向量检索
pub fn vector_search(
    store: &VectorStore,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    session_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let entries = store.load_all_embeddings(session_filter)?;
    
    let candidates: Vec<(String, Vec<f32>)> = entries.iter()
        .map(|e| (e.id.clone(), e.embedding.clone()))
        .collect();
    
    let top_results = VectorStore::top_k_similar(query_embedding, &candidates, limit, threshold);
    
    Ok(top_results.into_iter().map(|(id, score)| SearchResult {
        message_id: id,
        score,
        source: SearchSource::Vector,
        chunk_text: String::new(),
    }).collect())
}

/// 关键词检索（基于 SQLite LIKE）
pub fn keyword_search(
    store: &VectorStore,
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
    
    let mut stmt = conn.prepare(
        "SELECT id, content FROM messages 
         WHERE content LIKE ?1 
         ORDER BY LENGTH(content) ASC
         LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    
    let results = stmt.query_map(
        rusqlite::params![search_pattern, limit as i32],
        |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }
    ).map_err(|e| e.to_string())?;
    
    let search_results: Vec<SearchResult> = results
        .filter_map(|r| r.ok())
        .map(|(id, content)| {
            // 计算简单的关键词匹配分数
            let query_lower = query.to_lowercase();
            let content_lower = content.to_lowercase();
            let count = content_lower.matches(&query_lower).count();
            let score = (count as f32).min(1.0);
            
            SearchResult {
                message_id: id,
                chunk_text: content.chars().take(200).collect(),
                score,
                source: SearchSource::Keyword,
            }
        })
        .collect();
    
    Ok(search_results)
}

/// RRF（倒数排名融合）
pub fn reciprocal_rank_fusion(
    vector_results: Vec<SearchResult>,
    keyword_results: Vec<SearchResult>,
    k: usize,  // RRF 常数，通常为 60
) -> Vec<SearchResult> {
    use std::collections::HashMap;
    
    let mut scores: HashMap<String, (f32, SearchResult)> = HashMap::new();
    
    // 向量结果贡献（权重 70%）
    for (rank, r) in vector_results.iter().enumerate() {
        let rrf_score = 1.0 / (k as f32 + rank as f32 + 1.0);
        let weighted_score = rrf_score * 0.7;
        
        scores.entry(r.message_id.clone())
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
        
        scores.entry(r.message_id.clone())
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
    
    let mut results: Vec<_> = scores.into_values()
        .map(|(_, result)| result)
        .collect();
    
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    results
}

/// 混合检索（向量 + 关键词）
pub fn hybrid_search(
    store: &VectorStore,
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
    
    #[test]
    fn test_reciprocal_rank_fusion() {
        let vector_results = vec![
            SearchResult {
                message_id: "1".to_string(),
                chunk_text: "文本1".to_string(),
                score: 0.0,
                source: SearchSource::Vector,
            },
            SearchResult {
                message_id: "2".to_string(),
                chunk_text: "文本2".to_string(),
                score: 0.0,
                source: SearchSource::Vector,
            },
        ];
        
        let keyword_results = vec![
            SearchResult {
                message_id: "2".to_string(),
                chunk_text: "文本2".to_string(),
                score: 0.0,
                source: SearchSource::Keyword,
            },
            SearchResult {
                message_id: "3".to_string(),
                chunk_text: "文本3".to_string(),
                score: 0.0,
                source: SearchSource::Keyword,
            },
        ];
        
        let fused = reciprocal_rank_fusion(vector_results, keyword_results, 60);
        
        // "2" 应该在结果中，并且是 Hybrid 类型
        assert_eq!(fused.len(), 3);
        let result_2 = fused.iter().find(|r| r.message_id == "2").unwrap();
        assert_eq!(result_2.source, SearchSource::Hybrid);
    }
}
