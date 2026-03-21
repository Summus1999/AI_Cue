use serde::{Deserialize, Serialize};
use crate::database::InterviewContext;


/// 评分维度权重(可配置化扩展)
pub struct ScoreDimension {
    pub name: &'static str,
    pub weight: f64, // 权重 0.0-1.0
}

pub const DEFAULT_DIMENSIONS: &[ScoreDimension] = &[
    ScoreDimension { name: "completeness", weight: 0.35 },
    ScoreDimension { name: "accuracy",     weight: 0.40 },
    ScoreDimension { name: "clarity",      weight: 0.25 },
];

/// 单条消息的评分结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageScore {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    pub completeness_score: f64,
    pub accuracy_score: f64,
    pub clarity_score: f64,
    pub overall_score: f64,
    pub feedback: String,
    pub topic_tags: Vec<String>,
    pub created_at: i64,
}

/// AI 返回的原始评分 JSON 结构(需校验)
#[derive(Debug, Deserialize)]
pub struct AIScoreResponse {
    pub completeness: f64,
    pub accuracy: f64,
    pub clarity: f64,
    pub feedback: String,
    pub topic_tags: Vec<String>,
}

impl AIScoreResponse {
    /// 校验并 clamp 分数到 0-100 范围
    pub fn validate_and_clamp(&mut self) {
        self.completeness = self.completeness.clamp(0.0, 100.0);
        self.accuracy = self.accuracy.clamp(0.0, 100.0);
        self.clarity = self.clarity.clamp(0.0, 100.0);
    }

    /// 计算加权综合分
    pub fn calculate_overall(&self) -> f64 {
        let mut total = 0.0;
        for dim in DEFAULT_DIMENSIONS {
            let score = match dim.name {
                "completeness" => self.completeness,
                "accuracy" => self.accuracy,
                "clarity" => self.clarity,
                _ => 0.0,
            };
            total += score * dim.weight;
        }
        (total * 100.0).round() / 100.0 // 保留2位小数
    }
}

/// 会话洞察
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInsight {
    pub id: String,
    pub session_id: String,
    pub insight_type: InsightType,
    pub title: String,
    pub detail: String,
    pub related_message_ids: Vec<String>,
    pub priority: i32,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InsightType {
    KnowledgeGap,
    Strength,
    Suggestion,
}

impl InsightType {
    pub fn as_str(&self) -> &'static str {
        match self {
            InsightType::KnowledgeGap => "knowledge_gap",
            InsightType::Strength => "strength",
            InsightType::Suggestion => "suggestion",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "knowledge_gap" => Ok(InsightType::KnowledgeGap),
            "strength" => Ok(InsightType::Strength),
            "suggestion" => Ok(InsightType::Suggestion),
            _ => Err(format!("Unknown insight type: {}", s)),
        }
    }
}

/// AI 返回的分析结果 JSON 结构
#[derive(Debug, Deserialize)]
pub struct AIAnalysisResponse {
    pub knowledge_gaps: Vec<AIInsightItem>,
    pub strengths: Vec<AIInsightItem>,
    pub suggestions: Vec<AIInsightItem>,
}

#[derive(Debug, Deserialize)]
pub struct AIInsightItem {
    pub title: String,
    pub detail: String,
    pub related_questions: Vec<usize>, // 问题序号（从1开始）
    pub priority: i32,
}

/// 复盘报告完整数据(用于前端展示和导出)
#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewReport {
    pub session_id: String,
    pub session_title: String,
    pub interview_context: Option<InterviewContext>,
    pub overall_score: f64,
    pub dimension_averages: DimensionAverages,
    pub message_scores: Vec<MessageScore>,
    pub insights: Vec<SessionInsight>,
    pub completed_at: i64,
    pub message_count: usize,  // 总消息数
    pub scored_count: usize,   // 已评分数
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DimensionAverages {
    pub completeness: f64,
    pub accuracy: f64,
    pub clarity: f64,
}

/// 趋势对比数据(跨会话)
#[derive(Debug, Serialize, Deserialize)]
pub struct TrendData {
    pub sessions: Vec<TrendPoint>,
    pub gap_evolution: GapEvolution,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrendPoint {
    pub session_id: String,
    pub session_title: String,
    pub completed_at: i64,
    pub overall_score: f64,
    pub completeness: f64,
    pub accuracy: f64,
    pub clarity: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GapEvolution {
    pub resolved: Vec<String>,    // 已消除的盲点标题
    pub persistent: Vec<String>,  // 持续存在的盲点
    pub new_gaps: Vec<String>,    // 新出现的盲点
}

/// 复盘进度事件(流式推送到前端)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewProgress {
    pub phase: ReviewPhase,
    pub current: usize,  // 当前进度
    pub total: usize,    // 总数
    pub message: String, // 进度描述
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ReviewPhase {
    Scoring,     // 逐条评分中
    Analyzing,   // 分析知识盲点中
    Summarizing, // 生成报告中
    Completed,   // 完成
    Failed,      // 失败
}

/// 已复盘的会话摘要（用于趋势分析查询）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewedSession {
    pub session_id: String,
    pub title: String,
    pub overall_score: f64,
    pub completed_at: i64,
}
