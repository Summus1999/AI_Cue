# Rust 后端向量存储引擎设计文档

> 版本：v1.0 | 日期：2026-03-22 | 作者：AI_Cue 团队

## 1. 概述

### 1.1 需求背景

AI_Cue 作为面试辅助工具，积累了大量用户的面试问答记录。当前系统仅支持关键词搜索，无法理解用户意图进行语义检索。引入向量存储引擎可实现：

- **历史知识复用**：从过往面试中检索相似问题和优质回答
- **个人知识库构建**：自动沉淀用户擅长的技术领域
- **上下文增强（RAG）**：基于语义相关性为 AI 提供更精准的参考信息
- **智能复盘**：关联相似问题，发现知识盲区规律

### 1.2 设计目标

| 指标 | 目标值 |
|------|--------|
| 单次向量检索延迟 | < 50ms（1万条向量） |
| Embedding 生成延迟 | < 500ms（API 模式）/ < 100ms（本地模式） |
| 存储空间开销 | < 5KB/消息（含向量） |
| 内存占用增量 | < 50MB（运行时向量缓存） |

### 1.3 设计原则

1. **本地优先**：所有向量数据存储在本地 SQLite，无需云端依赖
2. **隐私保护**：Embedding 可选本地 ONNX 模型，敏感数据不出设备
3. **增量式设计**：消息写入时异步向量化，不阻塞主流程
4. **可扩展**：EmbeddingProvider 可插拔，支持多种模型切换
5. **渐进增强**：功能降级时不影响核心面试流程

## 2. 现状分析

### 2.1 数据库现状

- **存储引擎**：SQLite 3.x（rusqlite 0.31），WAL 模式
- **数据库位置**：`{app_data_dir}/sessions.db`
- **现有表结构**：

```
sessions     - 会话元数据（provider、model、interview_context 等）
messages     - 消息内容（id, session_id, role, content, image, created_at）
message_scores    - 消息评分（复盘功能）
session_insights  - 会话洞察（复盘功能）
```

- **迁移版本**：当前 v5，使用 `PRAGMA user_version` 检测

### 2.2 AI 模块现状

- **Provider Trait**：`AIProvider`（async_trait），支持 chat/chat_stream/test_connection
- **已实现 Provider**：Qwen、OpenAI、Claude
- **配置结构**：`ProviderConfig { api_key, base_url, extra }`
- **流式输出**：支持 OpenAI SSE 和 Claude SSE 两种格式

### 2.3 已有基础设施

- **HTTP 客户端**：各 Provider 已有 reqwest 异步客户端实现
- **序列化**：serde + serde_json 全面覆盖
- **命令接口**：`src-tauri/src/commands.rs` 已有完整的 Tauri 命令框架
- **RAG 目录**：`src-tauri/src/rag/` 已创建但为空

### 2.4 当前局限

- 无 Embedding 生成能力
- 无向量存储表
- 消息检索仅支持 LIKE 关键词匹配
- 上下文构建仅按时间窗口截取，无语义相关性

## 3. 整体架构设计

### 3.1 模块架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ ragService   │  │ SearchBar    │  │ ContextEnhancer Component│  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
└─────────┼─────────────────┼────────────────────────┼────────────────┘
          │ invoke          │ invoke                 │ invoke
┌─────────▼─────────────────▼────────────────────────▼────────────────┐
│                      Tauri Commands Layer                           │
│  rag_search | rag_embed_message | rag_get_context | rag_stats       │
└─────────┬─────────────────┬────────────────────────┬────────────────┘
          │                 │                        │
┌─────────▼─────────────────▼────────────────────────▼────────────────┐
│                         RAG Module (src-tauri/src/rag/)             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ retriever  │  │ embedder   │  │ chunker    │  │ context_builder│ │
│  │  .rs       │  │  .rs       │  │  .rs       │  │  .rs          │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └───────┬───────┘ │
│        │               │               │                 │         │
│  ┌─────▼───────────────▼───────────────▼─────────────────▼───────┐ │
│  │                    VectorStore (vector_store.rs)              │ │
│  │   - insert_embedding()  - search_similar()  - delete()        │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
└──────────────────────────────────┼──────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────┐
│                      SQLite (sessions.db)                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  vec_embeddings (id, message_id, chunk_idx, embedding, ...)  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责划分

| 模块 | 文件 | 职责 |
|------|------|------|
| VectorStore | `rag/vector_store.rs` | 向量 CRUD、余弦相似度计算、Top-K 检索 |
| Embedder | `rag/embedder.rs` | EmbeddingProvider trait、API/本地实现 |
| Chunker | `rag/chunker.rs` | 文本分块、Q&A 对识别、代码块处理 |
| Retriever | `rag/retriever.rs` | 混合检索（向量 + BM25）、RRF 融合 |
| ContextBuilder | `rag/context_builder.rs` | RAG Prompt 构建、Token 预算管理 |

### 3.3 数据流图

```
消息产生 ──► Chunker ──► Embedder ──► VectorStore ──► SQLite
    │           │            │             │
    │      分块+元数据    生成向量      BLOB存储
    │
    └──────────────────────────────────────────────────────────┐
                                                               │
用户提问 ──► Embedder ──► Retriever ──► ContextBuilder ──► AI Chat
                │             │               │
           查询向量化    Top-K检索        Prompt注入
```

## 4. 向量存储引擎设计

### 4.1 SQLite 向量表设计

```sql
-- vec_embeddings: 向量嵌入存储表
CREATE TABLE IF NOT EXISTS vec_embeddings (
    id              TEXT PRIMARY KEY,           -- UUID
    message_id      TEXT NOT NULL,              -- 关联 messages.id
    chunk_idx       INTEGER NOT NULL DEFAULT 0, -- 分块索引（单消息可能多块）
    chunk_text      TEXT NOT NULL,              -- 原始文本块
    embedding       BLOB NOT NULL,              -- f32[] 序列化为 BLOB
    embedding_dim   INTEGER NOT NULL,           -- 向量维度（用于校验）
    model_id        TEXT NOT NULL,              -- Embedding 模型标识
    created_at      INTEGER NOT NULL,           -- 创建时间戳
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- 索引：按消息快速查找所有分块
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_message 
    ON vec_embeddings(message_id);

-- 索引：按模型筛选（模型更换时可清理旧向量）
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_model 
    ON vec_embeddings(model_id);
```

**字段设计说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT | 主键，UUID v4 格式 |
| `message_id` | TEXT | 外键关联消息，CASCADE 删除 |
| `chunk_idx` | INTEGER | 同一消息的多个分块按序编号 |
| `chunk_text` | TEXT | 保留原文用于高亮显示和调试 |
| `embedding` | BLOB | 向量二进制存储，节省空间 |
| `embedding_dim` | INTEGER | 维度校验，防止模型切换后维度不匹配 |
| `model_id` | TEXT | 记录生成向量的模型，支持多模型共存 |

### 4.2 向量二进制存储格式

采用 **Little-Endian f32 数组**直接序列化为 BLOB：

```rust
/// 向量序列化为 BLOB
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
```

**存储空间估算：**

| 模型 | 维度 | 单向量大小 | 1万条向量 |
|------|------|-----------|----------|
| text-embedding-v2 | 1536 | 6KB | ~60MB |
| BGE-small-zh | 512 | 2KB | ~20MB |
| text-embedding-3-small | 1536 | 6KB | ~60MB |

### 4.3 Rust 原生余弦相似度计算

```rust
/// 余弦相似度计算（带 SIMD 优化提示）
#[inline]
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len(), "向量维度必须一致");
    
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    
    // 编译器会自动向量化此循环（-C target-cpu=native）
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
    candidates: &[(String, Vec<f32>)],  // (id, embedding)
    k: usize,
    threshold: f32,
) -> Vec<(String, f32)> {
    use std::collections::BinaryHeap;
    use std::cmp::Ordering;
    
    #[derive(PartialEq)]
    struct ScoreItem(f32, String);
    
    impl Eq for ScoreItem {}
    impl Ord for ScoreItem {
        fn cmp(&self, other: &Self) -> Ordering {
            // 小顶堆：分数低的在顶部
            other.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
        }
    }
    impl PartialOrd for ScoreItem {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }
    
    let mut heap = BinaryHeap::with_capacity(k + 1);
    
    for (id, emb) in candidates {
        let score = cosine_similarity(query, emb);
        if score >= threshold {
            heap.push(ScoreItem(score, id.clone()));
            if heap.len() > k {
                heap.pop(); // 弹出最小的
            }
        }
    }
    
    heap.into_sorted_vec()
        .into_iter()
        .map(|item| (item.1, item.0))
        .collect()
}
```

**性能优化策略：**

1. **编译优化**：`Cargo.toml` 添加 `lto = true`，`-C target-cpu=native`
2. **分区检索**：按 session_id 分区，仅检索相关会话
3. **LRU 缓存**：热点向量缓存在内存，避免重复反序列化
4. **批量加载**：一次性加载候选向量，减少 SQLite 查询次数

## 5. Embedding 服务设计

### 5.1 EmbeddingProvider Trait 设计

```rust
// src-tauri/src/rag/embedder.rs

use async_trait::async_trait;

/// Embedding 错误类型
#[derive(Debug)]
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

/// Embedding Provider 接口
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    /// 生成单条文本的 Embedding
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError>;
    
    /// 批量生成 Embedding（API 模式下更高效）
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
    
    /// 模型标识符（用于存储时记录）
    fn model_id(&self) -> &str;
    
    /// 输出向量维度
    fn dimension(&self) -> usize;
}
```

### 5.2 API Embedding 实现

```rust
/// Qwen text-embedding-v2 实现
pub struct QwenEmbedding {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
}

#[async_trait]
impl EmbeddingProvider for QwenEmbedding {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let url = format!("{}/embeddings", self.base_url);
        let body = serde_json::json!({
            "model": "text-embedding-v2",
            "input": { "texts": [text] },
            "parameters": { "text_type": "query" }
        });
        
        let resp = self.client.post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| EmbedError::Network(e.to_string()))?;
        
        // 解析响应，提取 embedding...
        Ok(vec![]) // 简化示例
    }
    
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        // Qwen 支持单次最多 25 条文本
        let mut results = Vec::new();
        for chunk in texts.chunks(25) {
            let embeddings = self.embed_batch_internal(chunk).await?;
            results.extend(embeddings);
        }
        Ok(results)
    }
    
    fn model_id(&self) -> &str { "qwen-text-embedding-v2" }
    fn dimension(&self) -> usize { 1536 }
}
```

**支持的 API 模型：**

| Provider | 模型 | 维度 | 最大 Token |
|----------|------|------|-----------|
| Qwen | text-embedding-v2 | 1536 | 2048 |
| OpenAI | text-embedding-3-small | 1536 | 8191 |
| OpenAI | text-embedding-3-large | 3072 | 8191 |

### 5.3 本地 ONNX Embedding（可选扩展）

**推荐模型**：BGE-small-zh-v1.5（BAAI）
- 维度：512
- 模型大小：~90MB
- 推理速度：~50ms/条（CPU）

```rust
/// 本地 ONNX Embedding（需添加 ort 依赖）
pub struct LocalOnnxEmbedding {
    session: ort::Session,
    tokenizer: tokenizers::Tokenizer,
}

impl LocalOnnxEmbedding {
    pub fn load(model_path: &Path) -> Result<Self, EmbedError> {
        let session = ort::Session::builder()?
            .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
            .commit_from_file(model_path)?;
        // 加载 tokenizer...
        Ok(Self { session, tokenizer })
    }
}
```

**依赖配置**（Cargo.toml，作为 feature 可选）：

```toml
[features]
local-embedding = ["ort", "tokenizers"]

[dependencies]
ort = { version = "2.0", optional = true }
tokenizers = { version = "0.15", optional = true }
```

## 6. 文档分块策略

### 6.1 分块算法

```rust
// src-tauri/src/rag/chunker.rs

pub struct ChunkConfig {
    pub max_chunk_size: usize,      // 最大分块字符数，默认 512
    pub overlap_size: usize,        // 重叠窗口，默认 50
    pub min_chunk_size: usize,      // 最小分块，默认 100
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 512,
            overlap_size: 50,
            min_chunk_size: 100,
        }
    }
}

pub struct Chunk {
    pub text: String,
    pub start_char: usize,
    pub end_char: usize,
    pub chunk_type: ChunkType,
}

pub enum ChunkType {
    Text,
    Code { language: Option<String> },
    QaPair,
}

/// 智能分块器
pub fn chunk_message(content: &str, config: &ChunkConfig) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    
    // 1. 识别代码块，单独处理
    let code_blocks = extract_code_blocks(content);
    
    // 2. 非代码部分按语义边界分块
    let text_parts = split_by_code_blocks(content, &code_blocks);
    
    for part in text_parts {
        chunks.extend(split_text_semantically(&part, config));
    }
    
    // 3. 代码块作为独立分块
    for code in code_blocks {
        chunks.push(Chunk {
            text: code.content,
            start_char: code.start,
            end_char: code.end,
            chunk_type: ChunkType::Code { language: code.language },
        });
    }
    
    chunks
}
```

### 6.2 面试消息特殊处理

面试场景下，Q&A 对应保持完整性：

```rust
/// 识别 Q&A 对并合并为单个分块
pub fn merge_qa_pairs(messages: &[Message]) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut i = 0;
    
    while i < messages.len() {
        if messages[i].role == "user" && i + 1 < messages.len() 
           && messages[i + 1].role == "assistant" {
            // Q&A 对合并
            let qa_text = format!(
                "问题：{}\n\n回答：{}", 
                messages[i].content, 
                messages[i + 1].content
            );
            chunks.push(Chunk {
                text: qa_text,
                chunk_type: ChunkType::QaPair,
                ..Default::default()
            });
            i += 2;
        } else {
            // 单独处理
            chunks.extend(chunk_message(&messages[i].content, &ChunkConfig::default()));
            i += 1;
        }
    }
    
    chunks
}
```

## 7. 检索系统设计

### 7.1 向量检索

```rust
// src-tauri/src/rag/retriever.rs

pub struct SearchResult {
    pub message_id: String,
    pub chunk_text: String,
    pub score: f32,
    pub source: SearchSource,
}

pub enum SearchSource {
    Vector,
    Keyword,
    Hybrid,
}

/// 向量检索
pub async fn vector_search(
    store: &VectorStore,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    session_filter: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let candidates = store.load_embeddings(session_filter)?;
    let results = top_k_similar(query_embedding, &candidates, limit, threshold);
    
    Ok(results.into_iter().map(|(id, score)| SearchResult {
        message_id: id,
        score,
        source: SearchSource::Vector,
        chunk_text: String::new(), // 后续填充
    }).collect())
}
```

### 7.2 混合检索策略

```rust
/// BM25 关键词检索（基于 SQLite FTS5）
pub fn keyword_search(
    db: &Database,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    // 使用 SQLite LIKE 或 FTS5（如已启用）
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, content FROM messages 
         WHERE content LIKE '%' || ?1 || '%' 
         LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    
    // ... 执行查询
    Ok(vec![])
}

/// RRF（倒数排名融合）
pub fn reciprocal_rank_fusion(
    vector_results: Vec<SearchResult>,
    keyword_results: Vec<SearchResult>,
    k: usize,  // RRF 常数，通常为 60
) -> Vec<SearchResult> {
    use std::collections::HashMap;
    
    let mut scores: HashMap<String, f32> = HashMap::new();
    
    // 向量结果贡献
    for (rank, r) in vector_results.iter().enumerate() {
        let rrf_score = 1.0 / (k as f32 + rank as f32 + 1.0);
        *scores.entry(r.message_id.clone()).or_default() += rrf_score * 0.7; // 向量权重 70%
    }
    
    // 关键词结果贡献
    for (rank, r) in keyword_results.iter().enumerate() {
        let rrf_score = 1.0 / (k as f32 + rank as f32 + 1.0);
        *scores.entry(r.message_id.clone()).or_default() += rrf_score * 0.3; // 关键词权重 30%
    }
    
    let mut results: Vec<_> = scores.into_iter()
        .map(|(id, score)| SearchResult {
            message_id: id,
            score,
            source: SearchSource::Hybrid,
            chunk_text: String::new(),
        })
        .collect();
    
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    results
}
```

### 7.3 上下文增强（RAG Prompt 注入）

```rust
// src-tauri/src/rag/context_builder.rs

pub struct ContextConfig {
    pub max_tokens: usize,         // Token 预算，默认 2000
    pub max_results: usize,        // 最大引用条数，默认 5
    pub include_source: bool,      // 是否标注来源
}

/// 构建 RAG 增强 Prompt
pub fn build_rag_context(
    results: &[SearchResult],
    config: &ContextConfig,
) -> String {
    let mut context = String::from("【相关历史参考】\n\n");
    let mut token_count = 0;
    
    for (i, result) in results.iter().take(config.max_results).enumerate() {
        let entry = if config.include_source {
            format!("[{}] {}\n---\n", i + 1, result.chunk_text)
        } else {
            format!("{}\n---\n", result.chunk_text)
        };
        
        let entry_tokens = estimate_tokens(&entry);
        if token_count + entry_tokens > config.max_tokens {
            break;
        }
        
        context.push_str(&entry);
        token_count += entry_tokens;
    }
    
    context.push_str("\n请参考以上历史记录回答用户问题。\n");
    context
}

/// Token 估算（中文约 2 字符/token，英文约 4 字符/token）
fn estimate_tokens(text: &str) -> usize {
    let chinese_count = text.chars().filter(|c| c.is_ascii() == false).count();
    let ascii_count = text.chars().filter(|c| c.is_ascii()).count();
    (chinese_count / 2) + (ascii_count / 4) + 1
}
```

## 8. Tauri 命令接口设计

```rust
// src-tauri/src/commands.rs（新增命令）

/// 向量检索
#[tauri::command]
pub async fn rag_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    session_id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(10);
    let rag = state.rag.lock().await;
    let results = rag.search(&query, limit, session_id.as_deref()).await?;
    Ok(results.into_iter().map(|r| serde_json::json!({
        "message_id": r.message_id,
        "chunk_text": r.chunk_text,
        "score": r.score,
        "source": format!("{:?}", r.source)
    })).collect())
}

/// 手动触发消息向量化
#[tauri::command]
pub async fn rag_embed_message(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<bool, String> {
    let rag = state.rag.lock().await;
    rag.embed_message(&message_id).await
}

/// 获取 RAG 增强上下文
#[tauri::command]
pub async fn rag_get_context(
    state: State<'_, AppState>,
    query: String,
    max_tokens: Option<usize>,
) -> Result<String, String> {
    let rag = state.rag.lock().await;
    let config = ContextConfig {
        max_tokens: max_tokens.unwrap_or(2000),
        ..Default::default()
    };
    rag.build_context(&query, &config).await
}

/// 获取向量化统计
#[tauri::command]
pub async fn rag_stats(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let rag = state.rag.lock().await;
    let stats = rag.get_stats()?;
    Ok(serde_json::json!({
        "total_embeddings": stats.total,
        "total_messages": stats.messages,
        "storage_bytes": stats.storage_size,
        "model_id": stats.model_id
    }))
}
```

## 9. 前端集成方案

### 9.1 前端服务层

```typescript
// src/services/ragService.ts

export interface SearchResult {
  message_id: string;
  chunk_text: string;
  score: number;
  source: 'Vector' | 'Keyword' | 'Hybrid';
}

export const ragService = {
  async search(query: string, limit = 10, sessionId?: string): Promise<SearchResult[]> {
    return invoke('rag_search', { query, limit, sessionId });
  },
  
  async getContext(query: string, maxTokens = 2000): Promise<string> {
    return invoke('rag_get_context', { query, maxTokens });
  },
  
  async embedMessage(messageId: string): Promise<boolean> {
    return invoke('rag_embed_message', { messageId });
  },
  
  async getStats(): Promise<RagStats> {
    return invoke('rag_stats');
  }
};
```

### 9.2 状态管理扩展

```typescript
// src/store/rag.ts

interface RagState {
  isSearching: boolean;
  searchResults: SearchResult[];
  ragEnabled: boolean;
  embeddingProgress: number;
}

export const useRagStore = create<RagState>((set) => ({
  isSearching: false,
  searchResults: [],
  ragEnabled: true,
  embeddingProgress: 0,
  
  search: async (query: string) => {
    set({ isSearching: true });
    const results = await ragService.search(query);
    set({ searchResults: results, isSearching: false });
  },
}));
```

### 9.3 自动向量化触发时机

- **消息保存后**：在 `save_message` 成功后异步触发 `rag_embed_message`
- **会话切换时**：检查未向量化消息，后台批量处理
- **应用启动时**：扫描未处理消息队列，低优先级处理

## 10. 数据库迁移方案

### 10.1 迁移脚本 v6

```sql
-- migrations/v6.sql
-- 向量存储表

CREATE TABLE IF NOT EXISTS vec_embeddings (
    id              TEXT PRIMARY KEY,
    message_id      TEXT NOT NULL,
    chunk_idx       INTEGER NOT NULL DEFAULT 0,
    chunk_text      TEXT NOT NULL,
    embedding       BLOB NOT NULL,
    embedding_dim   INTEGER NOT NULL,
    model_id        TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vec_embeddings_message ON vec_embeddings(message_id);
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_model ON vec_embeddings(model_id);

PRAGMA user_version = 6;
```

### 10.2 Rust 迁移函数

```rust
fn migrate_v5_to_v6(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    
    if version < 6 {
        println!("执行数据库迁移 v5 -> v6...");
        
        let tx = conn.unchecked_transaction()?;
        
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS vec_embeddings (
                id              TEXT PRIMARY KEY,
                message_id      TEXT NOT NULL,
                chunk_idx       INTEGER NOT NULL DEFAULT 0,
                chunk_text      TEXT NOT NULL,
                embedding       BLOB NOT NULL,
                embedding_dim   INTEGER NOT NULL,
                model_id        TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_vec_embeddings_message ON vec_embeddings(message_id);
            CREATE INDEX IF NOT EXISTS idx_vec_embeddings_model ON vec_embeddings(model_id);"
        )?;
        
        tx.pragma_update(None, "user_version", 6)?;
        tx.commit()?;
        
        println!("数据库迁移 v5 -> v6 完成");
    }
    
    Ok(())
}
```

## 11. 性能设计

### 11.1 性能目标

| 数据规模 | 向量检索延迟 | Embedding 延迟 | 内存占用 |
|----------|-------------|---------------|---------|
| 1K 消息 | < 10ms | < 500ms | ~10MB |
| 10K 消息 | < 50ms | < 500ms | ~60MB |
| 50K 消息 | < 200ms | < 500ms | ~300MB |

### 11.2 优化策略

1. **分区检索**：按 session_id 过滤，仅加载相关会话向量
2. **LRU 向量缓存**：内存缓存最近访问的 1000 条向量
3. **批量 Embedding**：消息队列积累后批量调用 API
4. **延迟加载**：向量仅在检索时加载，不预加载全量
5. **索引预热**：应用启动时预加载高频会话的向量

## 12. 错误处理与容错

| 场景 | 处理策略 |
|------|---------|
| Embedding API 不可用 | 降级为关键词检索，任务入队待重试 |
| 向量维度不匹配 | 检测 model_id，清理旧模型向量后重新生成 |
| SQLite 写入失败 | 事务回滚，错误上报，不影响消息保存 |
| 内存不足 | 减少缓存大小，启用磁盘分页检索 |
| 网络超时 | 本地模式自动切换（如已启用） |

## 13. 实施计划

### Phase 1：基础向量存储（1周）

**文件变更：**
- `src-tauri/src/rag/mod.rs` - 模块入口
- `src-tauri/src/rag/vector_store.rs` - 向量 CRUD
- `src-tauri/src/rag/embedder.rs` - EmbeddingProvider trait
- `src-tauri/src/database.rs` - 添加 migrate_v5_to_v6

### Phase 2：检索与上下文（1周）

**文件变更：**
- `src-tauri/src/rag/chunker.rs` - 分块逻辑
- `src-tauri/src/rag/retriever.rs` - 混合检索
- `src-tauri/src/rag/context_builder.rs` - Prompt 构建
- `src-tauri/src/commands.rs` - 新增 RAG 命令

### Phase 3：前端集成（1周）

**文件变更：**
- `src/services/ragService.ts` - 前端服务
- `src/store/rag.ts` - 状态管理
- `src/services/aiChat.ts` - RAG 上下文注入

### 新增依赖

```toml
# Cargo.toml
[dependencies]
uuid = { version = "1.0", features = ["v4"] }  # 已有

[features]
local-embedding = ["ort", "tokenizers"]

[dependencies.ort]
version = "2.0"
optional = true

[dependencies.tokenizers]
version = "0.15"
optional = true
```

## 14. 风险评估

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| Embedding API 成本 | 高 | 中 | 限制自动向量化频率，优先本地模型 |
| 大数据量性能下降 | 中 | 低 | 分区索引 + 缓存，50K 内可接受 |
| 模型更换兼容性 | 中 | 中 | model_id 标记 + 增量重建机制 |
| SQLite 并发限制 | 低 | 低 | WAL 模式 + 写入队列串行化 |
| 本地 ONNX 包体积 | 中 | - | 作为可选 feature，按需启用 |

## 15. 附录

### A. Embedding 模型对比

| 模型 | 提供商 | 维度 | 中文支持 | 推荐场景 |
|------|--------|------|---------|---------|
| text-embedding-v2 | Qwen | 1536 | 优秀 | 中文面试首选 |
| text-embedding-3-small | OpenAI | 1536 | 良好 | 英文/通用 |
| BGE-small-zh-v1.5 | BAAI | 512 | 优秀 | 离线/隐私优先 |

### B. 关键文件清单

```
src-tauri/
├── src/
│   ├── rag/
│   │   ├── mod.rs              # 模块入口，导出公共接口
│   │   ├── vector_store.rs     # 向量存储 CRUD
│   │   ├── embedder.rs         # Embedding Provider trait + 实现
│   │   ├── chunker.rs          # 文本分块
│   │   ├── retriever.rs        # 混合检索
│   │   └── context_builder.rs  # RAG Prompt 构建
│   ├── database.rs             # 修改：添加 v6 迁移
│   ├── commands.rs             # 修改：添加 RAG 命令
│   └── lib.rs                  # 修改：注册 RAG 模块
src/
├── services/
│   └── ragService.ts           # 新增：RAG 前端服务
└── store/
    └── rag.ts                  # 新增：RAG 状态管理
```
