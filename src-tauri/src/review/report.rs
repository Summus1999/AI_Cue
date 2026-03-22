//! 报告组装模块 - 组装完整的复盘报告数据

use crate::database::{self, Database, InterviewContext};
use super::types::*;

/// 组装完整的复盘报告数据
pub fn build_review_report(db: &Database, session_id: &str) -> Result<ReviewReport, String> {
    // 1. 获取会话基本信息
    let session_info = get_session_info(db, session_id)?;
    
    // 2. 获取 message_scores 并转换类型
    let db_scores = database::get_message_scores(db, session_id)?;
    let message_scores: Vec<MessageScore> = db_scores
        .iter()
        .map(convert_db_message_score)
        .collect();
    
    // 3. 获取 session_insights 并转换类型
    let db_insights = database::get_session_insights(db, session_id)?;
    let insights: Vec<SessionInsight> = db_insights
        .iter()
        .map(convert_db_session_insight)
        .collect::<Result<Vec<_>, String>>()?;
    
    // 4. 计算 dimension_averages
    let dimension_averages = calculate_dimension_averages(&db_scores);
    
    // 5. 计算 message_count 和 scored_count
    // message_count 统计 user 消息数（因为评分对象是 user 消息）
    let messages = database::get_session_messages(db, session_id)?;
    let message_count = messages
        .iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        .count();
    let scored_count = message_scores.len();
    
    // 6. 组装 ReviewReport
    Ok(ReviewReport {
        session_id: session_id.to_string(),
        session_title: session_info.title,
        interview_context: session_info.interview_context,
        overall_score: session_info.overall_score.unwrap_or(0.0),
        dimension_averages,
        message_scores,
        insights,
        completed_at: session_info.completed_at.unwrap_or(0),
        message_count,
        scored_count,
    })
}

/// 会话基本信息（内部使用）
struct SessionInfo {
    title: String,
    interview_context: Option<InterviewContext>,
    overall_score: Option<f64>,
    completed_at: Option<i64>,
}

/// 获取会话基本信息
fn get_session_info(db: &Database, session_id: &str) -> Result<SessionInfo, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT title, interview_context, overall_score, completed_at 
         FROM sessions WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query(rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let ctx_json: Option<String> = row.get(1).map_err(|e| e.to_string())?;
        let interview_context = match ctx_json {
            Some(json) if !json.is_empty() => {
                serde_json::from_str::<InterviewContext>(&json).ok()
            },
            _ => None,
        };
        
        Ok(SessionInfo {
            title: row.get(0).map_err(|e| e.to_string())?,
            interview_context,
            overall_score: row.get(2).map_err(|e| e.to_string())?,
            completed_at: row.get(3).map_err(|e| e.to_string())?,
        })
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// 计算维度平均分（五个维度）
fn calculate_dimension_averages(scores: &[database::MessageScore]) -> DimensionAverages {
    if scores.is_empty() {
        return DimensionAverages {
            confidence: 0.0,
            professionalism: 0.0,
            depth: 0.0,
            theory_practice: 0.0,
            tech_sensitivity: 0.0,
        };
    }
    
    let count = scores.len() as f64;
    let confidence_sum: f64 = scores.iter().map(|s| s.confidence_score).sum();
    let professionalism_sum: f64 = scores.iter().map(|s| s.professionalism_score).sum();
    let depth_sum: f64 = scores.iter().map(|s| s.depth_score).sum();
    let theory_practice_sum: f64 = scores.iter().map(|s| s.theory_practice_score).sum();
    let tech_sensitivity_sum: f64 = scores.iter().map(|s| s.tech_sensitivity_score).sum();
    
    DimensionAverages {
        confidence: (confidence_sum / count * 100.0).round() / 100.0,
        professionalism: (professionalism_sum / count * 100.0).round() / 100.0,
        depth: (depth_sum / count * 100.0).round() / 100.0,
        theory_practice: (theory_practice_sum / count * 100.0).round() / 100.0,
        tech_sensitivity: (tech_sensitivity_sum / count * 100.0).round() / 100.0,
    }
}

/// 将 database::MessageScore 转换为 review::types::MessageScore
fn convert_db_message_score(db_score: &database::MessageScore) -> MessageScore {
    // database 中的 topic_tags 已经是 Vec<String>（在 get_message_scores 中已转换）
    MessageScore {
        id: db_score.id.clone(),
        session_id: db_score.session_id.clone(),
        message_id: db_score.message_id.clone(),
        confidence_score: db_score.confidence_score,
        professionalism_score: db_score.professionalism_score,
        depth_score: db_score.depth_score,
        theory_practice_score: db_score.theory_practice_score,
        tech_sensitivity_score: db_score.tech_sensitivity_score,
        overall_score: db_score.overall_score,
        feedback: db_score.feedback.clone(),
        topic_tags: db_score.topic_tags.clone(),
        created_at: db_score.created_at,
    }
}

/// 将 database::SessionInsight 转换为 review::types::SessionInsight
fn convert_db_session_insight(db_insight: &database::SessionInsight) -> Result<SessionInsight, String> {
    // insight_type: database 中是 String，types 中是 InsightType enum
    let insight_type = InsightType::from_str(&db_insight.insight_type)?;
    
    // related_message_ids: database 中已经是 Vec<String>（在 get_session_insights 中已转换）
    Ok(SessionInsight {
        id: db_insight.id.clone(),
        session_id: db_insight.session_id.clone(),
        insight_type,
        title: db_insight.title.clone(),
        detail: db_insight.detail.clone(),
        related_message_ids: db_insight.related_message_ids.clone(),
        priority: db_insight.priority,
        created_at: db_insight.created_at,
    })
}
