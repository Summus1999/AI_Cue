//! 趋势分析模块 - 计算多次面试的趋势对比数据

use super::types::*;
use crate::database::{self, Database};

/// 计算多次面试的趋势对比数据
pub fn calculate_trend(db: &Database) -> Result<TrendData, String> {
    // 1. 获取所有已完成复盘的会话
    let db_sessions = database::get_reviewed_sessions(db)?;

    // 2. 按 completed_at 升序排列（数据库返回的是 DESC，需要反转）
    let mut sessions: Vec<_> = db_sessions.into_iter().collect();
    sessions.sort_by(|a, b| a.completed_at.cmp(&b.completed_at));

    // 3. 对每个会话计算趋势点
    let mut trend_points = Vec::new();
    for session in &sessions {
        let (confidence, professionalism, depth, theory_practice, tech_sensitivity) =
            calculate_dimension_averages(db, &session.session_id)?;

        trend_points.push(TrendPoint {
            session_id: session.session_id.clone(),
            session_title: session.title.clone(),
            completed_at: session.completed_at,
            overall_score: session.overall_score,
            confidence,
            professionalism,
            depth,
            theory_practice,
            tech_sensitivity,
        });
    }

    // 4. 计算盲点演变
    let gap_evolution = calculate_gap_evolution(db, &sessions)?;

    Ok(TrendData {
        sessions: trend_points,
        gap_evolution,
    })
}

/// 计算会话的各维度平均分（五个维度）
fn calculate_dimension_averages(
    db: &Database,
    session_id: &str,
) -> Result<(f64, f64, f64, f64, f64), String> {
    let scores = database::get_message_scores(db, session_id)?;

    if scores.is_empty() {
        return Ok((0.0, 0.0, 0.0, 0.0, 0.0));
    }

    let count = scores.len() as f64;
    let confidence_sum: f64 = scores.iter().map(|s| s.confidence_score).sum();
    let professionalism_sum: f64 = scores.iter().map(|s| s.professionalism_score).sum();
    let depth_sum: f64 = scores.iter().map(|s| s.depth_score).sum();
    let theory_practice_sum: f64 = scores.iter().map(|s| s.theory_practice_score).sum();
    let tech_sensitivity_sum: f64 = scores.iter().map(|s| s.tech_sensitivity_score).sum();

    let confidence_avg = (confidence_sum / count * 100.0).round() / 100.0;
    let professionalism_avg = (professionalism_sum / count * 100.0).round() / 100.0;
    let depth_avg = (depth_sum / count * 100.0).round() / 100.0;
    let theory_practice_avg = (theory_practice_sum / count * 100.0).round() / 100.0;
    let tech_sensitivity_avg = (tech_sensitivity_sum / count * 100.0).round() / 100.0;

    Ok((
        confidence_avg,
        professionalism_avg,
        depth_avg,
        theory_practice_avg,
        tech_sensitivity_avg,
    ))
}

/// 计算盲点演变（对比最近两次面试）
fn calculate_gap_evolution(
    db: &Database,
    sessions: &[database::ReviewedSession],
) -> Result<GapEvolution, String> {
    // 如果少于 2 次面试，返回空的 GapEvolution
    if sessions.len() < 2 {
        return Ok(GapEvolution {
            resolved: Vec::new(),
            persistent: Vec::new(),
            new_gaps: Vec::new(),
        });
    }

    // 取最后两次面试（sessions 已按 completed_at 升序排列）
    let previous_session = &sessions[sessions.len() - 2];
    let current_session = &sessions[sessions.len() - 1];

    // 获取各自的 knowledge_gap 标题列表
    let previous_gaps = database::get_knowledge_gap_titles(db, &previous_session.session_id)?;
    let current_gaps = database::get_knowledge_gap_titles(db, &current_session.session_id)?;

    let mut resolved = Vec::new();
    let mut persistent = Vec::new();
    let mut new_gaps = Vec::new();

    // 检查 previous 中的每个盲点
    for prev_gap in &previous_gaps {
        if is_gap_in_list(prev_gap, &current_gaps) {
            // 两次都有 → persistent
            persistent.push(prev_gap.clone());
        } else {
            // previous 有但 current 无 → resolved
            resolved.push(prev_gap.clone());
        }
    }

    // 检查 current 中的新盲点
    for curr_gap in &current_gaps {
        if !is_gap_in_list(curr_gap, &previous_gaps) {
            // previous 无但 current 有 → new_gaps
            new_gaps.push(curr_gap.clone());
        }
    }

    Ok(GapEvolution {
        resolved,
        persistent,
        new_gaps,
    })
}

/// 检查盲点是否在列表中存在（使用简单的字符串相似度匹配）
/// 如果标题 A 包含标题 B 的某个关键词（长度>2的词），或反过来，则认为是同一个盲点
fn is_gap_in_list(gap: &str, list: &[String]) -> bool {
    let gap_lower = gap.to_lowercase();

    for item in list {
        let item_lower = item.to_lowercase();

        // 完全匹配
        if gap_lower == item_lower {
            return true;
        }

        // 子串匹配
        if gap_lower.contains(&item_lower) || item_lower.contains(&gap_lower) {
            return true;
        }

        // 关键词匹配：提取长度>2的词进行匹配
        if has_common_keyword(&gap_lower, &item_lower) {
            return true;
        }
    }

    false
}

/// 检查两个字符串是否有共同的关键词（长度>2）
fn has_common_keyword(a: &str, b: &str) -> bool {
    // 提取关键词（按空格、标点分割，过滤长度<=2的）
    let keywords_a: Vec<&str> = a
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
        .filter(|w| w.chars().count() > 2)
        .collect();

    let keywords_b: Vec<&str> = b
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
        .filter(|w| w.chars().count() > 2)
        .collect();

    for kw_a in &keywords_a {
        for kw_b in &keywords_b {
            if kw_a == kw_b {
                return true;
            }
        }
    }

    false
}
