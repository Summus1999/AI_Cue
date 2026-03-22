//! 知识盲点分析器 - 分析会话中的知识盲点、优势和改进建议

use crate::ai::types::{ChatMessage, ProviderConfig};
use crate::ai::{ProviderRegistry, ProviderType};
use crate::database::{self, Database};
use super::types::*;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// 分析 System Prompt
const ANALYSIS_SYSTEM_PROMPT: &str = r#"你是一位资深技术面试官。以下是应聘者本次面试中各题的作答评分摘要。
请从面试官角度分析应聘者的技术能力表现。

请分析并严格按以下 JSON 格式返回（不要输出任何其他内容）:
{
  "knowledge_gaps": [
    {"title": "<应聘者的知识盲点>", "detail": "<具体表现和不足描述>", "related_questions": [1, 3], "priority": 1}
  ],
  "strengths": [
    {"title": "<应聘者的技术优势>", "detail": "<具体表现和亮点描述>", "related_questions": [2, 5], "priority": 1}
  ],
  "suggestions": [
    {"title": "<给应聘者的改进建议>", "detail": "<具体学习方向和行动建议>", "priority": 1}
  ]
}
其中 related_questions 是问题编号（从1开始），priority 数值越大越重要。"#;

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

/// 构建评分摘要文本（五个维度）
fn build_score_summary(
    message_scores: &[MessageScore],
    messages: &[(String, String, String)], // (message_id, question, answer) - message_id 是 user 消息 ID
) -> String {
    let mut summary = String::from("编号 | 话题标签 | 自信度 | 专业度 | 技术深度 | 理论实践 | 技术敏感 | 综合分\n");
    
    // 建立 message_id 到序号的映射
    for (index, (message_id, _question, _answer)) in messages.iter().enumerate() {
        // 查找对应的评分
        if let Some(score) = message_scores.iter().find(|s| &s.message_id == message_id) {
            let tags = if score.topic_tags.is_empty() {
                "无".to_string()
            } else {
                format!("[{}]", score.topic_tags.join(", "))
            };
            
            summary.push_str(&format!(
                "{} | {} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} | {:.1}\n",
                index + 1,
                tags,
                score.confidence_score,
                score.professionalism_score,
                score.depth_score,
                score.theory_practice_score,
                score.tech_sensitivity_score,
                score.overall_score
            ));
        }
    }
    
    summary
}

/// 将 AIInsightItem 转换为 SessionInsight
fn convert_insights(
    session_id: &str,
    items: Vec<AIInsightItem>,
    insight_type: InsightType,
    message_id_map: &[String], // 序号(index+1) -> message_id
) -> Vec<SessionInsight> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    
    items.into_iter().map(|item| {
        // 将问题序号映射为 message_id
        let related_message_ids: Vec<String> = item.related_questions
            .iter()
            .filter_map(|&q| {
                if q > 0 && q <= message_id_map.len() {
                    Some(message_id_map[q - 1].clone())
                } else {
                    None
                }
            })
            .collect();
        
        SessionInsight {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            insight_type: insight_type.clone(),
            title: item.title,
            detail: item.detail,
            related_message_ids,
            priority: item.priority,
            created_at: now,
        }
    }).collect()
}

/// 将 review::types::SessionInsight 转换为 database::SessionInsight
fn to_db_insight(insight: &SessionInsight) -> database::SessionInsight {
    database::SessionInsight {
        id: insight.id.clone(),
        session_id: insight.session_id.clone(),
        insight_type: insight.insight_type.as_str().to_string(),
        title: insight.title.clone(),
        detail: insight.detail.clone(),
        related_message_ids: insight.related_message_ids.clone(),
        priority: insight.priority,
        created_at: insight.created_at,
    }
}

/// 分析会话中的知识盲点、优势和改进建议
/// messages 的结构是 (assistant_question, user_answer) 的配对，message_id 指向 user 消息
pub async fn analyze_session(
    app: &AppHandle,
    db: &Database,
    providers: &ProviderRegistry,
    session_id: &str,
    provider: &str,
    config: &ProviderConfig,
    model: &str,
    message_scores: &[MessageScore],
    messages: &[(String, String, String)], // (message_id, question, answer)
) -> Result<Vec<SessionInsight>, String> {
    // 1. 解析 provider 类型
    let provider_type = parse_provider_type(provider)?;
    
    // 2. 推送进度：Analyzing 阶段
    let _ = app.emit("review-progress", ReviewProgress {
        phase: ReviewPhase::Analyzing,
        current: 0,
        total: 1,
        message: "正在分析知识盲点和优势...".to_string(),
    });
    
    // 3. 构建评分摘要文本
    let summary = build_score_summary(message_scores, messages);
    let user_message = format!("评分摘要：\n{}", summary);
    
    // 4. 构建消息
    let chat_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: ANALYSIS_SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];
    
    // 5. 调用 AI 进行全局分析
    let response = providers.chat(&provider_type, config, model, chat_messages)
        .await
        .map_err(|e| e.to_string())?;
    
    // 6. 解析 AIAnalysisResponse
    let json_str = extract_json(&response);
    let analysis: AIAnalysisResponse = serde_json::from_str(json_str)
        .map_err(|e| format!("解析分析结果失败: {} (原始: {})", e, json_str))?;
    
    // 7. 构建 message_id 映射 (序号 -> message_id)
    let message_id_map: Vec<String> = messages.iter()
        .map(|(id, _, _)| id.clone())
        .collect();
    
    // 8. 转换为 SessionInsight 列表
    let mut insights = Vec::new();
    
    insights.extend(convert_insights(
        session_id,
        analysis.knowledge_gaps,
        InsightType::KnowledgeGap,
        &message_id_map,
    ));
    
    insights.extend(convert_insights(
        session_id,
        analysis.strengths,
        InsightType::Strength,
        &message_id_map,
    ));
    
    insights.extend(convert_insights(
        session_id,
        analysis.suggestions,
        InsightType::Suggestion,
        &message_id_map,
    ));
    
    // 9. 先清除旧的 insights
    database::delete_session_insights(db, session_id)?;
    
    // 10. 写入新的 insights
    let db_insights: Vec<database::SessionInsight> = insights.iter()
        .map(to_db_insight)
        .collect();
    database::insert_session_insights(db, &db_insights)?;
    
    // 11. 推送分析阶段完成进度（进入报告生成阶段）
    let _ = app.emit("review-progress", ReviewProgress {
        phase: ReviewPhase::Summarizing,
        current: 1,
        total: 1,
        message: format!("分析完成，发现 {} 条洞察", insights.len()),
    });
    
    Ok(insights)
}

/// 获取已有洞察（从数据库读取并转换类型）
pub fn get_existing_insights(db: &Database, session_id: &str) -> Result<Vec<SessionInsight>, String> {
    let db_insights = database::get_session_insights(db, session_id)?;
    
    db_insights.into_iter().map(|i| {
        let insight_type = InsightType::from_str(&i.insight_type)?;
        Ok(SessionInsight {
            id: i.id,
            session_id: i.session_id,
            insight_type,
            title: i.title,
            detail: i.detail,
            related_message_ids: i.related_message_ids,
            priority: i.priority,
            created_at: i.created_at,
        })
    }).collect()
}
