// 向量存储引擎 - SQLite BLOB 存储 + Rust 原生余弦相似度计算

use crate::database::Database;
use rusqlite::params;
use std::sync::Arc;

/// 向量条目
#[derive(Debug, Clone)]
pub struct EmbeddingEntry {
    pub id: String,
    pub message_id: String,
    pub chunk_idx: usize,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
    pub embedding_dim: usize,
    pub model_id: String,
    pub created_at: i64,
}

/// 向量存储
pub struct VectorStore {
    db: Arc<Database>,
    /// LRU 缓存：message_id -> Vec<f32>
    cache: std::sync::Mutex<lru::LruCache<String, Vec<f32>>>,
}

mod lru {
    use std::collections::HashMap;
    use std::collections::hash_map::Entry;
    
    pub struct LruCache<K, V> {
        capacity: usize,
        order: Vec<K>,
        map: HashMap<K, V>,
    }
    
    impl<K: std::hash::Hash + Eq + Clone, V: Clone> LruCache<K, V> {
        pub fn new(capacity: usize) -> Self {
            Self {
                capacity,
                order: Vec::new(),
                map: HashMap::new(),
            }
        }
        
        pub fn get(&mut self, key: &K) -> Option<&V> {
            if let Entry::Occupied(_) = self.map.entry(key.clone()) {
                // 移动到末尾（最近使用）
                self.order.retain(|k| k != key);
                self.order.push(key.clone());
                self.map.get(key)
            } else {
                None
            }
        }
        
        pub fn put(&mut self, key: K, value: V) {
            if self.order.len() >= self.capacity {
                if let Some(oldest) = self.order.first().cloned() {
                    self.map.remove(&oldest);
                    self.order.remove(0);
                }
            }
            self.order.push(key.clone());
            self.map.insert(key, value);
        }
    }
}

impl VectorStore {
    /// 创建向量存储
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            cache: std::sync::Mutex::new(lru::LruCache::new(1000)),
        }
    }

    /// 向量序列化为 BLOB（Little-Endian f32）
    pub fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
        embedding.iter()
            .flat_map(|f| f.to_le_bytes())
            .collect()
    }

    /// BLOB 反序列化为向量
    pub fn blob_to_embedding(blob: &[u8]) -> Vec<f32> {
        blob.chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect()
    }

    /// 余弦相似度计算
    #[inline]
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        debug_assert_eq!(a.len(), b.len(), "向量维度必须一致");
        
        let mut dot = 0.0f32;
        let mut norm_a = 0.0f32;
        let mut norm_b = 0.0f32;
        
        for i in 0..a.len() {
            dot += a[i] * b[i];
            norm_a += a[i] * a[i];
            norm_b += b[i] * b[i];
        }
        
        let denom = (norm_a * norm_b).sqrt();
        if denom < 1e-10 { 0.0 } else { dot / denom }
    }

    /// Top-K 检索（堆排序优化）
    pub fn top_k_similar(
        query: &[f32],
        candidates: &[(String, Vec<f32>)],
        k: usize,
        threshold: f32,
    ) -> Vec<(String, f32)> {
        use std::cmp::Ordering;
        
        #[derive(PartialEq)]
        struct ScoreItem(f32, String);
        
        impl Eq for ScoreItem {}
        impl Ord for ScoreItem {
            fn cmp(&self, other: &Self) -> Ordering {
                other.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
            }
        }
        impl PartialOrd for ScoreItem {
            fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
                Some(self.cmp(other))
            }
        }
        
        use std::collections::BinaryHeap;
        let mut heap = BinaryHeap::with_capacity(k + 1);
        
        for (id, emb) in candidates {
            let score = Self::cosine_similarity(query, emb);
            if score >= threshold {
                heap.push(ScoreItem(score, id.clone()));
                if heap.len() > k {
                    heap.pop();
                }
            }
        }
        
        heap.into_sorted_vec()
            .into_iter()
            .map(|item| (item.1, item.0))
            .collect()
    }

    /// 插入向量
    pub fn insert_embedding(
        &self,
        message_id: &str,
        chunk_idx: usize,
        chunk_text: &str,
        embedding: &[f32],
        model_id: &str,
        embedding_dim: usize,
    ) -> Result<String, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let blob = Self::embedding_to_blob(embedding);
        
        conn.execute(
            "INSERT INTO vec_embeddings (id, message_id, chunk_idx, chunk_text, embedding, embedding_dim, model_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, message_id, chunk_idx as i32, chunk_text, blob, embedding_dim as i32, model_id, now],
        ).map_err(|e| e.to_string())?;
        
        Ok(id)
    }

    /// 加载指定 message_id 的所有向量
    pub fn load_embeddings_for_message(&self, message_id: &str) -> Result<Vec<EmbeddingEntry>, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let mut stmt = conn.prepare(
            "SELECT id, message_id, chunk_idx, chunk_text, embedding, embedding_dim, model_id, created_at
             FROM vec_embeddings WHERE message_id = ?1 ORDER BY chunk_idx"
        ).map_err(|e| e.to_string())?;
        
        let entries = stmt.query_map(params![message_id], |row| {
            let blob: Vec<u8> = row.get(4)?;
            let embedding = Self::blob_to_embedding(&blob);
            
            Ok(EmbeddingEntry {
                id: row.get(0)?,
                message_id: row.get(1)?,
                chunk_idx: row.get::<_, i32>(2)? as usize,
                chunk_text: row.get(3)?,
                embedding,
                embedding_dim: row.get::<_, i32>(5)? as usize,
                model_id: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        
        let mut result = Vec::new();
        for entry in entries {
            result.push(entry.map_err(|e| e.to_string())?);
        }
        
        Ok(result)
    }

    /// 加载所有向量（可选按 session_id 过滤）
    pub fn load_all_embeddings(&self, session_filter: Option<&str>) -> Result<Vec<EmbeddingEntry>, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let mut result = Vec::new();
        
        match session_filter {
            Some(session_id) => {
                let mut stmt = conn.prepare(
                    "SELECT ve.id, ve.message_id, ve.chunk_idx, ve.chunk_text, ve.embedding, ve.embedding_dim, ve.model_id, ve.created_at
                     FROM vec_embeddings ve
                     JOIN messages m ON ve.message_id = m.id
                     WHERE m.session_id = ?1
                     ORDER BY ve.created_at DESC"
                ).map_err(|e| e.to_string())?;
                
                let entries = stmt.query_map(params![session_id], |row| {
                    let blob: Vec<u8> = row.get(4)?;
                    let embedding = Self::blob_to_embedding(&blob);
                    
                    Ok(EmbeddingEntry {
                        id: row.get(0)?,
                        message_id: row.get(1)?,
                        chunk_idx: row.get::<_, i32>(2)? as usize,
                        chunk_text: row.get(3)?,
                        embedding,
                        embedding_dim: row.get::<_, i32>(5)? as usize,
                        model_id: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                }).map_err(|e| e.to_string())?;
                
                for entry in entries {
                    result.push(entry.map_err(|e| e.to_string())?);
                }
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, message_id, chunk_idx, chunk_text, embedding, embedding_dim, model_id, created_at
                     FROM vec_embeddings ORDER BY created_at DESC"
                ).map_err(|e| e.to_string())?;
                
                let entries = stmt.query_map([], |row| {
                    let blob: Vec<u8> = row.get(4)?;
                    let embedding = Self::blob_to_embedding(&blob);
                    
                    Ok(EmbeddingEntry {
                        id: row.get(0)?,
                        message_id: row.get(1)?,
                        chunk_idx: row.get::<_, i32>(2)? as usize,
                        chunk_text: row.get(3)?,
                        embedding,
                        embedding_dim: row.get::<_, i32>(5)? as usize,
                        model_id: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                }).map_err(|e| e.to_string())?;
                
                for entry in entries {
                    result.push(entry.map_err(|e| e.to_string())?);
                }
            }
        }
        
        Ok(result)
    }

    /// 获取消息的 chunk_text（用于填充检索结果）
    pub fn get_chunk_text(&self, embedding_id: &str) -> Result<Option<String>, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let result: Result<String, _> = conn.query_row(
            "SELECT chunk_text FROM vec_embeddings WHERE id = ?1",
            params![embedding_id],
            |row| row.get(0),
        );
        
        match result {
            Ok(text) => Ok(Some(text)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// 按 message_id 删除向量
    pub fn delete_by_message_id(&self, message_id: &str) -> Result<(), String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        conn.execute(
            "DELETE FROM vec_embeddings WHERE message_id = ?1",
            params![message_id],
        ).map_err(|e| e.to_string())?;
        
        Ok(())
    }

    /// 按 model_id 删除向量（模型切换时清理旧向量）
    pub fn delete_by_model(&self, model_id: &str) -> Result<(), String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        conn.execute(
            "DELETE FROM vec_embeddings WHERE model_id = ?1",
            params![model_id],
        ).map_err(|e| e.to_string())?;
        
        Ok(())
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> Result<super::RagStats, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        // 总向量数
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM vec_embeddings",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        
        // 独立消息数
        let messages: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT message_id) FROM vec_embeddings",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        
        // 存储大小
        let storage_size: i64 = conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(embedding) + LENGTH(chunk_text) + 50), 0) FROM vec_embeddings",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        
        // 最新模型 ID
        let model_id: Option<String> = conn.query_row(
            "SELECT model_id FROM vec_embeddings ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        ).ok();
        
        Ok(super::RagStats {
            total: total as usize,
            messages: messages as usize,
            storage_size: storage_size as u64,
            model_id,
        })
    }

    /// 检查消息是否已向量化
    pub fn is_message_embedded(&self, message_id: &str) -> Result<bool, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM vec_embeddings WHERE message_id = ?1",
            params![message_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        
        Ok(count > 0)
    }

    /// 搜索未向量化的消息
    pub fn get_unembedded_messages(&self, limit: usize) -> Result<Vec<(String, String)>, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        
        let mut stmt = conn.prepare(
            "SELECT m.id, m.content FROM messages m
             LEFT JOIN vec_embeddings ve ON m.id = ve.message_id
             WHERE ve.id IS NULL AND LENGTH(m.content) > 10
             ORDER BY m.created_at DESC
             LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![limit as i32], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_blob_conversion() {
        let embedding = vec![0.1f32, 0.2, 0.3, 0.4];
        let blob = VectorStore::embedding_to_blob(&embedding);
        let restored = VectorStore::blob_to_embedding(&blob);
        
        assert_eq!(embedding.len(), restored.len());
        for (a, b) in embedding.iter().zip(restored.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
    
    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        let c = vec![0.0f32, 1.0, 0.0];
        
        assert!((VectorStore::cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);
        assert!((VectorStore::cosine_similarity(&a, &c) - 0.0).abs() < 1e-6);
    }
}
