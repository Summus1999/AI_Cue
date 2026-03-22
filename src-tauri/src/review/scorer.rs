//! AI 评分引擎 - 对会话中的 user 消息（应聘者回答）进行评分

use crate::ai::types::{ChatMessage, ProviderConfig};
use crate::ai::{ProviderRegistry, ProviderType};
use crate::database::{self, Database};
use super::types::*;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use std::collections::HashSet;
use std::sync::Arc;
use futures_util::stream::{self, StreamExt};

/// 最大并发评分数
const MAX_CONCURRENT_SCORES: usize = 3;
/// 单条消息评分最大重试次数
const MAX_RETRY_COUNT: usize = 2;

/// 评分 System Prompt - 五个核心维度
const SCORE_SYSTEM_PROMPT: &str = r#"你是一位资深技术面试官。请从面试官的专业角度，对应聘者的以下回答进行评分。

请严格按照以下 JSON 格式返回评分结果（不要输出任何其他内容）:
{
  "confidence": <0-100 面试自信度: 回答时是否表现出自信，语气是否坚定>
  "professionalism": <0-100 技术专业度: 是否使用正确的技术术语，语言表达是否专业>
  "depth": <0-100 技术深度: 对技术问题的理解是否深入，是否能举一反三>
  "theory_practice": <0-100 理论与实践结合: 能否将理论知识与实际项目经验相结合>
  "tech_sensitivity": <0-100 技术敏感度: 对新技术、行业趋势的敏感程度>
  "feedback": "<50字以内的改进建议，从面试官角度给出>",
  "topic_tags": ["<话题标签1>", "<话题标签2>"]
}"#;

/// 将字符串 provider 转换为 ProviderType
fn parse_provider_type(provider: &str) -> Result<ProviderType, String> {
    match provider.to_lowercase().as_str() {
        "qwen" => Ok(ProviderType::Qwen),
        "openai_compat" | "openaicompat" | "openai" => Ok(ProviderType::OpenAICompat),
        "claude" => Ok(ProviderType::Claude),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// 从 AI 返回内容中提取 JSON
fn extract_json(content: &str) -> &str {
    let trimmed = content.trim();
    
    // 尝试提取 ```json...``` 代码块
    if let Some(start) = trimmed.find("```json") {
        let json_start = start + 7;
        if let Some(end) = trimmed[json_start..].find("```") {
            return trimmed[json_start..json_start + end].trim();
        }
    }
    
    // 尝试提取 ```...``` 代码块
    if let Some(start) = trimmed.find("```") {
        let json_start = start + 3;
        // 跳过可能的语言标识行
        let actual_start = if let Some(newline) = trimmed[json_start..].find('\n') {
            json_start + newline + 1
        } else {
            json_start
        };
        if let Some(end) = trimmed[actual_start..].find("```") {
            return trimmed[actual_start..actual_start + end].trim();
        }
    }
    
    // 直接返回 trimmed 内容
    trimmed
}

/// Q&A 对结构
struct QAPair {
    message_id: String,  // user 消息的 ID（评分对象）
    question: String,    // assistant 消息内容（面试官提问）
    answer: String,      // user 消息内容（应聘者回答）
}

/// 从消息列表中提取 Q&A 对
/// 遍历消息列表，找到 assistant（面试官提问）后面紧跟的 user（应聘者回答）
fn extract_qa_pairs(messages: &[serde_json::Value], scored_ids: &HashSet<String>) -> Vec<QAPair> {
    let mut pairs = Vec::new();
    let mut i = 0;
    
    while i < messages.len() {
        let msg = &messages[i];
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        
        if role == "assistant" {
            // 找到 assistant 消息（面试官提问），寻找下一个 user 消息（应聘者回答）
            let question = msg.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            
            // 查找后续的 user 消息
            if i + 1 < messages.len() {
                let next_msg = &messages[i + 1];
                let next_role = next_msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
                
                if next_role == "user" {
                    // message_id 是 user 消息的 ID（评分对象）
                    let message_id = next_msg.get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    
                    // 跳过已评分的消息
                    if !scored_ids.contains(&message_id) {
                        let answer = next_msg.get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        
                        pairs.push(QAPair {
                            message_id,
                            question,
                            answer,
                        });
                    }
                    i += 2;
                    continue;
                }
            }
        }
        i += 1;
    }
    
    pairs
}

/// 对单条 Q&A 进行 AI 评分
async fn score_single_message(
    providers: &ProviderRegistry,
    provider_type: &ProviderType,
    config: &ProviderConfig,
    model: &str,
    question: &str,
    answer: &str,
    interview_context: Option<&str>,
) -> Result<AIScoreResponse, String> {
    let context_text = interview_context.unwrap_or("无");
    let user_message = format!(
        "面试背景: {}\n面试官提问: {}\n应聘者回答: {}",
        context_text, question, answer
    );
    
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: SCORE_SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];
    
    let mut last_error = String::new();
    
    for attempt in 0..=MAX_RETRY_COUNT {
        match providers.chat(provider_type, config, model, messages.clone()).await {
            Ok(response) => {
                let json_str = extract_json(&response);
                match serde_json::from_str::<AIScoreResponse>(json_str) {
                    Ok(mut score_response) => {
                        score_response.validate_and_clamp();
                        return Ok(score_response);
                    }
                    Err(e) => {
                        last_error = format!("JSON 解析失败: {} (原始: {})", e, json_str);
                        if attempt < MAX_RETRY_COUNT {
                            continue;
                        }
                    }
                }
            }
            Err(e) => {
                last_error = e.to_string();
                if attempt < MAX_RETRY_COUNT {
                    // 短暂延迟后重试
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
            }
        }
    }
    
    Err(last_error)
}

/// 将 review::types::MessageScore 转换为 database::MessageScore
fn to_db_message_score(score: &MessageScore) -> database::MessageScore {
    database::MessageScore {
        id: score.id.clone(),
        session_id: score.session_id.clone(),
        message_id: score.message_id.clone(),
        confidence_score: score.confidence_score,
        professionalism_score: score.professionalism_score,
        depth_score: score.depth_score,
        theory_practice_score: score.theory_practice_score,
        tech_sensitivity_score: score.tech_sensitivity_score,
        overall_score: score.overall_score,
        feedback: score.feedback.clone(),
        topic_tags: score.topic_tags.clone(),
        created_at: score.created_at,
    }
}

/// 评分引擎：对会话中的 user 消息（应聘者回答）进行 AI 评分
pub async fn score_session_messages(
    app: &AppHandle,
    db: &Database,
    providers: &ProviderRegistry,
    session_id: &str,
    provider: &str,
    config: &ProviderConfig,
    model: &str,
    interview_context: Option<&str>,
) -> Result<Vec<MessageScore>, String> {
    // 1. 解析 provider 类型
    let provider_type = parse_provider_type(provider)?;
    
    // 2. 从数据库加载所有消息
    let messages = database::get_session_messages(db, session_id)?;
    
    // 3. 获取已评分的 message_ids
    let scored_ids: HashSet<String> = database::get_scored_message_ids(db, session_id)?
        .into_iter()
        .collect();
    
    // 4. 提取 Q&A 对
    let qa_pairs = extract_qa_pairs(&messages, &scored_ids);
    let total = qa_pairs.len();
    
    if total == 0 {
        return Ok(Vec::new());
    }
    
    // 5. 推送初始进度
    let _ = app.emit("review-progress", ReviewProgress {
        phase: ReviewPhase::Scoring,
        current: 0,
        total,
        message: format!("开始评分，共 {} 条问答", total),
    });
    
    // 6. 使用 buffer_unordered 控制并发（最多 MAX_CONCURRENT_SCORES 个并发）
    // 使用 tokio::sync::Mutex 保证进度计数的线程安全
    use tokio::sync::Mutex;
    let progress_count = Arc::new(Mutex::new(0usize));
    let total_clone = total;
    
    let results: Vec<_> = stream::iter(qa_pairs.into_iter().enumerate())
        .map(|(index, qa)| {
            let provider_type = provider_type.clone();
            let config = config.clone();
            let progress_count = Arc::clone(&progress_count);
            let total_len = total_clone;
            let app_clone = app.clone();
            
            async move {
                let result = score_single_message(
                    providers,
                    &provider_type,
                    &config,
                    model,
                    &qa.question,
                    &qa.answer,
                    interview_context,
                ).await;
                
                // 线程安全地递增进度计数
                let current = {
                    let mut count = progress_count.lock().await;
                    *count += 1;
                    *count
                };
                
                // 推送进度（使用线程安全的计数）
                let message = match &result {
                    Ok(_) => format!("已完成 {}/{} 条评分", current, total_len),
                    Err(e) => format!("第 {} 条评分失败: {}", current, e),
                };
                let _ = app_clone.emit("review-progress", ReviewProgress {
                    phase: ReviewPhase::Scoring,
                    current,
                    total: total_len,
                    message,
                });
                
                (index, qa.message_id, result)
            }
        })
        .buffer_unordered(MAX_CONCURRENT_SCORES)
        .collect()
        .await;
    
    // 7. 收集结果（按原始索引顺序）
    let mut scores = Vec::new();
    
    for (index, message_id, result) in results {
        match result {
            Ok(ai_response) => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                
                let score = MessageScore {
                    id: Uuid::new_v4().to_string(),
                    session_id: session_id.to_string(),
                    message_id: message_id.clone(),
                    confidence_score: ai_response.confidence,
                    professionalism_score: ai_response.professionalism,
                    depth_score: ai_response.depth,
                    theory_practice_score: ai_response.theory_practice,
                    tech_sensitivity_score: ai_response.tech_sensitivity,
                    overall_score: ai_response.calculate_overall(),
                    feedback: ai_response.feedback,
                    topic_tags: ai_response.topic_tags,
                    created_at: now,
                };
                
                scores.push(score);
            }
            Err(e) => {
                // 单条评分失败，记录但不中断整体流程
                eprintln!("评分失败 (message_id: {}, index {}): {}", message_id, index, e);
            }
        }
    }
    
    // 8. 批量将评分结果写入数据库（使用事务保证原子性）
    if !scores.is_empty() {
        let db_scores: Vec<_> = scores.iter().map(to_db_message_score).collect();
        if let Err(e) = database::insert_message_scores_batch(db, &db_scores) {
            eprintln!("批量写入评分失败: {}, 尝试逐条写入", e);
            // 回退到逐条写入
            for score in &scores {
                let db_score = to_db_message_score(score);
                if let Err(e) = database::insert_message_score(db, &db_score) {
                    eprintln!("写入评分失败: {}", e);
                }
            }
        }
    }
    
    Ok(scores)
}

/// 获取已有评分（从数据库读取并转换类型）
pub fn get_existing_scores(db: &Database, session_id: &str) -> Result<Vec<MessageScore>, String> {
    let db_scores = database::get_message_scores(db, session_id)?;
    
    Ok(db_scores.into_iter().map(|s| MessageScore {
        id: s.id,
        session_id: s.session_id,
        message_id: s.message_id,
        confidence_score: s.confidence_score,
        professionalism_score: s.professionalism_score,
        depth_score: s.depth_score,
        theory_practice_score: s.theory_practice_score,
        tech_sensitivity_score: s.tech_sensitivity_score,
        overall_score: s.overall_score,
        feedback: s.feedback,
        topic_tags: s.topic_tags,
        created_at: s.created_at,
    }).collect())
}
