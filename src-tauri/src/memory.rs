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

// ==================== 反思与衰减 ====================

const MEMORY_REFLECTION_SYSTEM_PROMPT: &str = r#"你是 AI_Cue 的个人面试记忆反思器。
请从下面列出的多条用户面试情景与语义记忆中，归纳出用户的长期画像特征。

只返回 JSON，不要输出任何解释：
{
  "memories": [
    {
      "memory_type": "profile",
      "content": "画像记忆正文，描述用户的一项长期特征、强项或薄弱点",
      "structured_json": {},
      "importance": 7
    }
  ]
}

规则：
1. 从多条记忆中寻找反复出现的模式，归纳为稳定的画像特征。
2. 画像记忆应描述用户的技术强项、常见薄弱点、偏好的答题风格或反复遇到的知识盲区。
3. 每条画像记忆应高度凝练，避免长篇叙述。
4. importance 范围为 1 到 10，越稳定的特征分数越高。
5. 如果现有记忆不足以归纳出画像特征，返回空数组。"#;

/// 反思与衰减的配置参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMaintenanceRequest {
    pub provider: ProviderType,
    pub config: ProviderConfig,
    pub model: String,
    pub embedding_config: EmbeddingProviderConfig,
    /// active 情景 + 语义记忆达到此数量时触发反思（默认 10）
    pub reflection_threshold: Option<usize>,
    /// 衰减重要性上限，不高于此值的记忆可被衰减（默认 3）
    pub decay_importance_max: Option<i32>,
    /// 衰减天数阈值，超过此天数未被检索的记忆可被衰减（默认 30）
    pub decay_days_threshold: Option<i64>,
    /// 巩固去重相似度阈值（默认 0.92）
    pub similarity_threshold: Option<f32>,
}

/// 反思与衰减的执行结果摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMaintenanceSummary {
    /// 衰减归档的记忆条数
    pub decayed_count: usize,
    /// 是否触发了反思
    pub reflection_triggered: bool,
    /// 反思生成的画像记忆条数
    pub reflection_profile_count: usize,
    /// 当前 active 情景 + 语义记忆总数
    pub active_source_count: i64,
}

/// 构建反思用的记忆列表文本，供 LLM 分析。
fn build_reflection_memory_text(memories: &[database::MemoryRecord]) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(memories.len());
    for (i, memory) in memories.iter().enumerate() {
        let type_label = match memory.memory_type {
            MemoryType::Episodic => "情景",
            MemoryType::Semantic => "语义",
            MemoryType::Profile => "画像",
            MemoryType::Procedural => "程序",
        };
        let source_label = match memory.source_type {
            MemorySourceType::AssistantChat => "助手对话",
            MemorySourceType::Explicit => "显式指令",
            MemorySourceType::ManualReview => "复盘录入",
        };
        lines.push(format!(
            "{}. [{type_label}|{source_label}|重要性{}|出现{}次] {}",
            i + 1,
            memory.importance,
            memory.occurrence_count,
            memory.content,
        ));
    }
    lines.join("\n")
}

/// 执行衰减：将低重要性且长期未检索的情景记忆归档。
/// 显式指令与复盘录入来源被豁免。
fn run_decay(
    db: &database::Database,
    importance_max: i32,
    days_threshold: i64,
) -> Result<usize, String> {
    database::decay_episodic_memories(db, importance_max, days_threshold)
}

/// 执行反思：收集近期情景与语义记忆，调用 LLM 归纳画像特征并持久化。
async fn run_reflection(
    db: &database::Database,
    providers: &ProviderRegistry,
    provider: &ProviderType,
    config: &ProviderConfig,
    model: &str,
    embedder: &dyn EmbeddingProvider,
    similarity_threshold: f32,
    memory_limit: usize,
) -> Result<usize, String> {
    // 收集最近的情景与语义记忆作为反思素材
    let source_memories = database::list_active_memories_by_types(
        db,
        &[MemoryType::Episodic, MemoryType::Semantic],
        memory_limit,
    )?;

    if source_memories.is_empty() {
        return Ok(0);
    }

    let memory_text = build_reflection_memory_text(&source_memories);

    // 调用 LLM 进行反思归纳
    let response = providers
        .chat(
            provider,
            config,
            model,
            vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: MEMORY_REFLECTION_SYSTEM_PROMPT.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: format!("请分析以下面试记忆并归纳用户的画像特征：\n\n{memory_text}"),
                },
            ],
        )
        .await
        .map_err(|e| format!("反思 LLM 调用失败: {e}"))?;

    // 复用现有抽取链路：解析 JSON 候选并执行巩固去重入库
    let candidates = extract_candidates_from_llm_response(
        &response,
        MemorySourceType::AssistantChat, // 反思生成的画像记忆标记为 AssistantChat 来源
    )
    .map_err(|e| format!("反思结果解析失败: {e}"))?;

    // 只保留 profile 类型的候选
    let profile_candidates: Vec<_> = candidates
        .into_iter()
        .filter(|c| c.memory_type == MemoryType::Profile)
        .collect();

    let mut persisted_count = 0;
    for candidate in profile_candidates {
        persist_candidate_with_consolidation(db, embedder, candidate, None, similarity_threshold)
            .await?;
        persisted_count += 1;
    }

    Ok(persisted_count)
}

/// 综合记忆维护：先衰减后反思。
/// - 衰减先执行，清理已无价值的陈旧记忆。
/// - 反思在衰减后判断：若剩余 active 情景 + 语义记忆仍达阈值则触发。
pub async fn run_memory_maintenance(
    db: &database::Database,
    providers: &ProviderRegistry,
    request: MemoryMaintenanceRequest,
) -> Result<MemoryMaintenanceSummary, String> {
    let reflection_threshold = request.reflection_threshold.unwrap_or(10);
    let decay_importance_max = request.decay_importance_max.unwrap_or(3).clamp(1, 10);
    let decay_days_threshold = request.decay_days_threshold.unwrap_or(30).max(1);
    let similarity_threshold = request.similarity_threshold.unwrap_or(0.92);

    // 1. 先执行衰减
    let decayed_count = run_decay(db, decay_importance_max, decay_days_threshold)?;

    // 2. 统计衰减后的 active 情景 + 语义记忆数量
    let active_source_count = database::count_active_memories_by_types(
        db,
        &[MemoryType::Episodic, MemoryType::Semantic],
    )?;

    // 3. 判断是否需要触发反思
    let (reflection_triggered, reflection_profile_count) =
        if active_source_count >= reflection_threshold as i64 {
            let embedder = create_embedding_provider(&request.embedding_config)?;
            let count = run_reflection(
                db,
                providers,
                &request.provider,
                &request.config,
                &request.model,
                embedder.as_ref(),
                similarity_threshold,
                50, // 最多取 50 条近期记忆作为反思素材
            )
            .await?;
            (true, count)
        } else {
            (false, 0)
        };

    Ok(MemoryMaintenanceSummary {
        decayed_count,
        reflection_triggered,
        reflection_profile_count,
        active_source_count,
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

    // ==================== Reflection & Decay tests ====================

    #[test]
    fn builds_reflection_memory_text_with_type_and_source_labels() {
        let memories = vec![
            database::MemoryRecord {
                id: "m1".to_string(),
                memory_type: MemoryType::Episodic,
                source_type: MemorySourceType::AssistantChat,
                content: "Redis AOF 重写相关问答".to_string(),
                structured_json: json!({}),
                importance: 5,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: 2,
                decay_score: 0.0,
                status: MemoryStatus::Active,
                created_at: 1,
                updated_at: 2,
                last_seen_at: 3,
                last_retrieved_at: None,
            },
            database::MemoryRecord {
                id: "m2".to_string(),
                memory_type: MemoryType::Semantic,
                source_type: MemorySourceType::Explicit,
                content: "用户擅长 Rust 异步优化".to_string(),
                structured_json: json!({"skill": "Rust"}),
                importance: 10,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: 1,
                decay_score: 0.0,
                status: MemoryStatus::Active,
                created_at: 4,
                updated_at: 5,
                last_seen_at: 6,
                last_retrieved_at: None,
            },
        ];

        let text = build_reflection_memory_text(&memories);

        assert!(text.contains("Redis AOF"));
        assert!(text.contains("情景|助手对话|重要性5|出现2次"));
        assert!(text.contains("Rust 异步优化"));
        assert!(text.contains("语义|显式指令|重要性10|出现1次"));
    }

    #[test]
    fn run_decay_archives_stale_episodic_memories() {
        let db = create_test_db();

        // 创建应被衰减的记忆
        let old_time = database::current_timestamp_ms() - 40 * 86_400_000;
        database::create_memory(
            &db,
            database::CreateMemoryInput {
                memory_type: MemoryType::Episodic,
                source_type: MemorySourceType::AssistantChat,
                content: "旧的低重要性记忆".to_string(),
                structured_json: json!({}),
                importance: 2,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: Some(1),
                decay_score: Some(0.0),
                status: Some(MemoryStatus::Active),
                last_retrieved_at: Some(old_time),
            },
        )
        .unwrap();

        // 不应被衰减：importance 高
        database::create_memory(
            &db,
            database::CreateMemoryInput {
                memory_type: MemoryType::Episodic,
                source_type: MemorySourceType::AssistantChat,
                content: "高重要性记忆".to_string(),
                structured_json: json!({}),
                importance: 8,
                embedding_model_id: Some("test-model".to_string()),
                source_session_id: None,
                occurrence_count: Some(1),
                decay_score: Some(0.0),
                status: Some(MemoryStatus::Active),
                last_retrieved_at: Some(old_time),
            },
        )
        .unwrap();

        let decayed = run_decay(&db, 3, 30).unwrap();
        assert_eq!(decayed, 1);

        // 验证衰减结果
        let remaining = database::list_memories(
            &db,
            database::MemoryListFilter {
                status: Some(MemoryStatus::Active),
            },
        )
        .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].content, "高重要性记忆");
    }

    #[test]
    fn parses_reflection_response_and_filters_to_profile_only() {
        let response = r#"```json
{
  "memories": [
    {
      "memory_type": "profile",
      "content": "用户在系统设计面试中反复表现出对高并发场景经验的不足",
      "structured_json": {"weakness": "high concurrency system design"},
      "importance": 8
    },
    {
      "memory_type": "semantic",
      "content": "这条不应该被保留，因为反射只应产出 profile 记忆",
      "structured_json": {},
      "importance": 5
    }
  ]
}
```"#;

        let candidates =
            extract_candidates_from_llm_response(response, MemorySourceType::AssistantChat)
                .unwrap();

        // 两条都在候选列表中
        assert_eq!(candidates.len(), 2);

        // 过滤到只有 profile
        let profile_only: Vec<_> = candidates
            .into_iter()
            .filter(|c| c.memory_type == MemoryType::Profile)
            .collect();
        assert_eq!(profile_only.len(), 1);
        assert!(profile_only[0].content.contains("高并发"));
        assert_eq!(profile_only[0].importance, 8);
    }

    #[test]
    fn reflection_prompt_accepts_empty_memories_array() {
        let response = r#"{"memories":[]}"#;

        let err = extract_candidates_from_llm_response(response, MemorySourceType::AssistantChat)
            .unwrap_err();
        assert!(err.contains("不能为空"));
    }
}
