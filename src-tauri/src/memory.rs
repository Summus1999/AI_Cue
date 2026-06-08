use crate::ai::types::{ChatMessage, ProviderConfig};
use crate::ai::{ProviderRegistry, ProviderType};
use crate::database::{
    self, CreateMemoryInput, CreateMemoryWithEmbeddingInput, MemoryRecord, MemorySourceType,
    MemoryStatus, MemoryType, ReinforceMemoryInput,
};
use crate::rag::{create_embedding_provider, EmbeddingProvider, EmbeddingProviderConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MEMORY_EXTRACTION_SYSTEM_PROMPT: &str = r#"你是 AI_Cue 的个人面试记忆抽取器。
请从用户提供的内容中抽取值得长期保留的面试记忆。

只返回 JSON，不要输出任何解释：
{
  "memories": [
    {
      "memory_type": "episodic | semantic | profile | procedural",
      "content": "可直接注入 assistant prompt 的自然语言记忆正文",
      "structured_json": {"key": "value"},
      "importance": 1
    }
  ]
}

规则：
1. 只保留与面试题、项目经历、技术能力、复盘结论直接相关的信息。
2. 空泛寒暄、临时闲聊不要抽取。
3. importance 范围为 1 到 10，越重要分数越高。"#;

#[derive(Debug, Clone, PartialEq)]
pub struct MemoryCandidate {
    pub memory_type: MemoryType,
    pub source_type: MemorySourceType,
    pub content: String,
    pub structured_json: Value,
    pub importance: i32,
}

#[derive(Debug, Clone)]
pub struct ManualReviewInput {
    pub company: String,
    pub position: String,
    pub question: String,
    pub answer: String,
    pub outcome: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTurnMemoryExtractionRequest {
    pub session_id: String,
    pub provider: ProviderType,
    pub config: ProviderConfig,
    pub model: String,
    pub embedding_config: EmbeddingProviderConfig,
    pub source_text: String,
    pub similarity_threshold: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTurnMemoryExtractionSummary {
    pub candidate_count: usize,
    pub persisted_count: usize,
}

#[derive(Debug, Deserialize)]
struct AiMemoryExtractionResponse {
    memories: Vec<AiMemoryItem>,
}

#[derive(Debug, Deserialize)]
struct AiMemoryItem {
    memory_type: String,
    content: String,
    #[serde(default)]
    structured_json: Value,
    importance: i32,
}

/// 从 AI 回复中提取 JSON；复用 review 模块同类策略，兼容 fenced JSON。
fn extract_json(content: &str) -> &str {
    let trimmed = content.trim();

    if let Some(start) = trimmed.find("```json") {
        let json_start = start + 7;
        if let Some(end) = trimmed[json_start..].find("```") {
            return trimmed[json_start..json_start + end].trim();
        }
    }

    if let Some(start) = trimmed.find("```") {
        let json_start = start + 3;
        let actual_start = if let Some(newline) = trimmed[json_start..].find('\n') {
            json_start + newline + 1
        } else {
            json_start
        };
        if let Some(end) = trimmed[actual_start..].find("```") {
            return trimmed[actual_start..actual_start + end].trim();
        }
    }

    trimmed
}

fn parse_memory_type(value: &str) -> Result<MemoryType, String> {
    MemoryType::try_from(value).map_err(|_| format!("记忆类型不支持: {value}"))
}

fn validate_candidate(
    item: AiMemoryItem,
    source_type: MemorySourceType,
) -> Result<MemoryCandidate, String> {
    let content = item.content.trim().to_string();
    if content.is_empty() {
        return Err("记忆内容不能为空".to_string());
    }

    Ok(MemoryCandidate {
        memory_type: parse_memory_type(item.memory_type.trim())?,
        source_type,
        content,
        structured_json: if item.structured_json.is_null() {
            json!({})
        } else {
            item.structured_json
        },
        importance: item.importance.clamp(1, 10),
    })
}

pub fn extract_candidates_from_llm_response(
    response: &str,
    source_type: MemorySourceType,
) -> Result<Vec<MemoryCandidate>, String> {
    let json_str = extract_json(response);
    let parsed: AiMemoryExtractionResponse = serde_json::from_str(json_str)
        .map_err(|e| format!("解析记忆抽取结果失败: {e} (原始: {json_str})"))?;
    if parsed.memories.is_empty() {
        return Err("记忆抽取结果不能为空".to_string());
    }

    parsed
        .memories
        .into_iter()
        .map(|item| validate_candidate(item, source_type.clone()))
        .collect()
}

fn parse_provider_type(provider: &str) -> Result<ProviderType, String> {
    match provider.to_lowercase().as_str() {
        "qwen" => Ok(ProviderType::Qwen),
        "openai_compat" | "openaicompat" | "openai" => Ok(ProviderType::OpenAICompat),
        "claude" => Ok(ProviderType::Claude),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

fn provider_type_id(provider: &ProviderType) -> &'static str {
    match provider {
        ProviderType::Qwen => "qwen",
        ProviderType::OpenAICompat => "openai_compat",
        ProviderType::Claude => "claude",
    }
}

pub async fn extract_candidates_with_llm(
    providers: &ProviderRegistry,
    provider: &str,
    config: &ProviderConfig,
    model: &str,
    source_text: &str,
    source_type: MemorySourceType,
) -> Result<Vec<MemoryCandidate>, String> {
    let source_text = source_text.trim();
    if source_text.is_empty() {
        return Err("抽取来源内容不能为空".to_string());
    }

    let provider_type = parse_provider_type(provider)?;
    let response = providers
        .chat(
            &provider_type,
            config,
            model,
            vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: MEMORY_EXTRACTION_SYSTEM_PROMPT.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: source_text.to_string(),
                },
            ],
        )
        .await
        .map_err(|e| e.to_string())?;

    extract_candidates_from_llm_response(&response, source_type)
}

pub fn explicit_instruction_candidate(
    content: &str,
    structured_json: Value,
) -> Result<MemoryCandidate, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("显式记忆内容不能为空".to_string());
    }

    Ok(MemoryCandidate {
        memory_type: MemoryType::Semantic,
        source_type: MemorySourceType::Explicit,
        content: content.to_string(),
        structured_json,
        importance: 10,
    })
}

pub fn manual_review_candidate(input: ManualReviewInput) -> Result<MemoryCandidate, String> {
    let question = input.question.trim();
    let answer = input.answer.trim();
    if question.is_empty() || answer.is_empty() {
        return Err("复盘题目和回答不能为空".to_string());
    }

    let company = input.company.trim().to_string();
    let position = input.position.trim().to_string();
    let outcome = input.outcome.trim().to_string();
    let notes = input.notes.unwrap_or_default().trim().to_string();
    let content = format!(
        "复盘记录：{}{}面试中被问到“{}”，用户回答“{}”，结果为“{}”。{}",
        if company.is_empty() { "" } else { &company },
        if position.is_empty() {
            "".to_string()
        } else {
            format!(" {position}")
        },
        question,
        answer,
        if outcome.is_empty() {
            "未记录"
        } else {
            &outcome
        },
        if notes.is_empty() {
            "".to_string()
        } else {
            format!("备注：{notes}")
        }
    );

    Ok(MemoryCandidate {
        memory_type: MemoryType::Episodic,
        source_type: MemorySourceType::ManualReview,
        content,
        structured_json: json!({
            "company": company,
            "position": position,
            "question": question,
            "answer": answer,
            "outcome": outcome,
            "notes": notes,
        }),
        importance: 8,
    })
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.len() != b.len() || a.is_empty() {
        return None;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a = a.iter().map(|v| v * v).sum::<f32>().sqrt();
    let norm_b = b.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return None;
    }

    Some(dot / (norm_a * norm_b))
}

pub async fn persist_candidate_with_consolidation(
    db: &database::Database,
    embedder: &dyn EmbeddingProvider,
    candidate: MemoryCandidate,
    source_session_id: Option<String>,
    similarity_threshold: f32,
) -> Result<MemoryRecord, String> {
    let embedding = embedder
        .embed(&candidate.content)
        .await
        .map_err(|e| e.to_string())?;
    let model_id = embedder.model_id().to_string();
    let existing = database::list_memory_embedding_vectors(db, &model_id)?;

    let best_match = existing
        .iter()
        .filter(|item| {
            item.memory_type == candidate.memory_type && item.source_type == candidate.source_type
        })
        .filter_map(|item| {
            cosine_similarity(&embedding, &item.embedding)
                .map(|score| (item.memory_id.as_str(), score))
        })
        .max_by(|(_, left), (_, right)| {
            left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal)
        });

    if let Some((memory_id, score)) = best_match {
        if score >= similarity_threshold {
            return database::reinforce_memory(
                db,
                memory_id,
                ReinforceMemoryInput {
                    importance: candidate.importance,
                },
            );
        }
    }

    database::create_memory_with_embedding(
        db,
        CreateMemoryWithEmbeddingInput {
            memory: CreateMemoryInput {
                memory_type: candidate.memory_type,
                source_type: candidate.source_type,
                content: candidate.content,
                structured_json: candidate.structured_json,
                importance: candidate.importance,
                embedding_model_id: Some(model_id.clone()),
                source_session_id,
                occurrence_count: Some(1),
                decay_score: Some(0.0),
                status: Some(MemoryStatus::Active),
                last_retrieved_at: None,
            },
            embedding_dim: embedding.len(),
            embedding,
            model_id,
        },
    )
}

pub async fn extract_assistant_turn_memories(
    db: &database::Database,
    providers: &ProviderRegistry,
    request: AssistantTurnMemoryExtractionRequest,
) -> Result<AssistantTurnMemoryExtractionSummary, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".to_string());
    }
    if request.source_text.trim().is_empty() {
        return Err("sourceText 不能为空".to_string());
    }

    let embedder = create_embedding_provider(&request.embedding_config)?;
    let candidates = extract_candidates_with_llm(
        providers,
        provider_type_id(&request.provider),
        &request.config,
        &request.model,
        &request.source_text,
        MemorySourceType::AssistantChat,
    )
    .await?;

    let candidate_count = candidates.len();
    let mut persisted_count = 0;
    for candidate in candidates {
        persist_candidate_with_consolidation(
            db,
            embedder.as_ref(),
            candidate,
            Some(session_id.to_string()),
            request.similarity_threshold.unwrap_or(0.92),
        )
        .await?;
        persisted_count += 1;
    }

    Ok(AssistantTurnMemoryExtractionSummary {
        candidate_count,
        persisted_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{self, CreateMemoryInput, MemorySourceType, MemoryStatus, MemoryType};
    use crate::rag::{EmbedError, EmbeddingProvider};
    use async_trait::async_trait;
    use serde_json::json;

    fn create_test_db() -> database::Database {
        let temp_dir =
            std::env::temp_dir().join(format!("memory_extract_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        database::init_database(&temp_dir).unwrap()
    }

    fn count_rows(db: &database::Database, table: &str) -> i64 {
        let conn = db.0.lock().unwrap();
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    struct StaticEmbeddingProvider {
        model_id: String,
        embedding: Vec<f32>,
    }

    #[async_trait]
    impl EmbeddingProvider for StaticEmbeddingProvider {
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

    #[test]
    fn parses_and_validates_ai_memory_json() {
        let response = r#"
```json
{
  "memories": [
    {
      "memory_type": "semantic",
      "content": "用户擅长 Rust 异步服务优化",
      "structured_json": {"skill": "Rust"},
      "importance": 12
    }
  ]
}
```
"#;

        let candidates =
            extract_candidates_from_llm_response(response, MemorySourceType::Explicit).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].memory_type, MemoryType::Semantic);
        assert_eq!(candidates[0].source_type, MemorySourceType::Explicit);
        assert_eq!(candidates[0].content, "用户擅长 Rust 异步服务优化");
        assert_eq!(candidates[0].structured_json["skill"], "Rust");
        assert_eq!(candidates[0].importance, 10);
    }

    #[test]
    fn rejects_invalid_ai_memory_json() {
        let err = extract_candidates_from_llm_response(
            r#"{"memories":[{"memory_type":"unknown","content":"","importance":5}]}"#,
            MemorySourceType::Explicit,
        )
        .unwrap_err();

        assert!(err.contains("记忆类型") || err.contains("记忆内容"));
    }

    #[test]
    fn builds_deterministic_candidates_for_explicit_and_manual_review_sources() {
        let explicit = explicit_instruction_candidate(
            "记住我擅长排查 Rust 生命周期和异步任务问题",
            json!({"skill": "Rust", "scenario": "async debugging"}),
        )
        .unwrap();
        assert_eq!(explicit.memory_type, MemoryType::Semantic);
        assert_eq!(explicit.source_type, MemorySourceType::Explicit);
        assert_eq!(explicit.importance, 10);
        assert_eq!(explicit.structured_json["scenario"], "async debugging");

        let manual = manual_review_candidate(ManualReviewInput {
            company: "腾讯".to_string(),
            position: "后端工程师".to_string(),
            question: "Redis AOF 重写如何避免阻塞主线程？".to_string(),
            answer: "我回答了 fork 子进程和增量缓冲区".to_string(),
            outcome: "二面通过".to_string(),
            notes: Some("下次补充 fsync 策略".to_string()),
        })
        .unwrap();

        assert_eq!(manual.memory_type, MemoryType::Episodic);
        assert_eq!(manual.source_type, MemorySourceType::ManualReview);
        assert_eq!(manual.structured_json["company"], "腾讯");
        assert_eq!(manual.structured_json["position"], "后端工程师");
        assert!(manual.content.contains("Redis AOF"));
    }

    #[tokio::test]
    async fn consolidates_similar_memory_before_insert() {
        let db = create_test_db();
        let embedder = StaticEmbeddingProvider {
            model_id: "test-model".to_string(),
            embedding: vec![1.0, 0.0, 0.0],
        };

        let first = persist_candidate_with_consolidation(
            &db,
            &embedder,
            explicit_instruction_candidate("我擅长 Rust 异步服务优化", json!({"skill": "Rust"}))
                .unwrap(),
            None,
            0.95,
        )
        .await
        .unwrap();

        let second = persist_candidate_with_consolidation(
            &db,
            &embedder,
            explicit_instruction_candidate(
                "我在 Rust 异步服务压测中做过优化",
                json!({"skill": "Rust"}),
            )
            .unwrap(),
            None,
            0.95,
        )
        .await
        .unwrap();

        assert_eq!(second.id, first.id);
        assert_eq!(second.occurrence_count, 2);
        assert_eq!(second.content, first.content);
        assert_eq!(count_rows(&db, "memories"), 1);
        assert_eq!(count_rows(&db, "memory_embeddings"), 1);
    }

    #[tokio::test]
    async fn does_not_consolidate_across_memory_source_types() {
        let db = create_test_db();
        let first = database::create_memory(
            &db,
            CreateMemoryInput {
                memory_type: MemoryType::Semantic,
                source_type: MemorySourceType::AssistantChat,
                content: "我擅长 Redis AOF 重写".to_string(),
                structured_json: json!({"skill": "Redis"}),
                importance: 10,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: Some(1),
                decay_score: Some(0.0),
                status: Some(MemoryStatus::Active),
                last_retrieved_at: None,
            },
        )
        .unwrap();
        database::insert_memory_embedding(
            &db,
            database::CreateMemoryEmbeddingInput {
                memory_id: first.id,
                embedding: vec![1.0, 0.0, 0.0],
                embedding_dim: 3,
                model_id: "test-model".to_string(),
            },
        )
        .unwrap();

        let embedder = StaticEmbeddingProvider {
            model_id: "test-model".to_string(),
            embedding: vec![1.0, 0.0, 0.0],
        };
        let manual = persist_candidate_with_consolidation(
            &db,
            &embedder,
            explicit_instruction_candidate("记住我擅长 Redis AOF 重写", json!({"skill": "Redis"}))
                .unwrap(),
            None,
            0.95,
        )
        .await
        .unwrap();

        assert_eq!(manual.memory_type, MemoryType::Semantic);
        assert_eq!(manual.source_type, MemorySourceType::Explicit);
        assert_eq!(count_rows(&db, "memories"), 2);
        assert_eq!(count_rows(&db, "memory_embeddings"), 2);
    }

    #[tokio::test]
    async fn creates_new_memory_when_embedding_is_not_similar() {
        let db = create_test_db();
        let first = database::create_memory(
            &db,
            CreateMemoryInput {
                memory_type: MemoryType::Semantic,
                source_type: MemorySourceType::Explicit,
                content: "我擅长 Rust".to_string(),
                structured_json: json!({"skill": "Rust"}),
                importance: 10,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: Some(1),
                decay_score: Some(0.0),
                status: Some(MemoryStatus::Active),
                last_retrieved_at: None,
            },
        )
        .unwrap();
        database::insert_memory_embedding(
            &db,
            database::CreateMemoryEmbeddingInput {
                memory_id: first.id,
                embedding: vec![1.0, 0.0, 0.0],
                embedding_dim: 3,
                model_id: "test-model".to_string(),
            },
        )
        .unwrap();

        let embedder = StaticEmbeddingProvider {
            model_id: "test-model".to_string(),
            embedding: vec![0.0, 1.0, 0.0],
        };
        let session = database::create_session(&db, None).unwrap();
        let session_id = session
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap()
            .to_string();
        let created = persist_candidate_with_consolidation(
            &db,
            &embedder,
            manual_review_candidate(ManualReviewInput {
                company: "阿里".to_string(),
                position: "后端工程师".to_string(),
                question: "MySQL 索引失效场景有哪些？".to_string(),
                answer: "我答了函数、隐式转换和最左前缀".to_string(),
                outcome: "待反馈".to_string(),
                notes: None,
            })
            .unwrap(),
            Some(session_id.clone()),
            0.95,
        )
        .await
        .unwrap();

        assert_ne!(created.content, "我擅长 Rust");
        assert_eq!(
            created.source_session_id.as_deref(),
            Some(session_id.as_str())
        );
        assert_eq!(count_rows(&db, "memories"), 2);
        assert_eq!(count_rows(&db, "memory_embeddings"), 2);
    }
}
