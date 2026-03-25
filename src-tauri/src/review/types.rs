use crate::database::InterviewContext;
use serde::{Deserialize, Serialize};

/// 面试评分维度定义
pub struct ScoreDimension {
    pub name: &'static str,
    pub weight: f64, // 权重 0.0-1.0
}

/// 五个核心评分维度及其权重
pub const SCORE_DIMENSIONS: &[ScoreDimension] = &[
    ScoreDimension {
        name: "confidence",
        weight: 0.15,
    }, // 面试自信度
    ScoreDimension {
        name: "professionalism",
        weight: 0.20,
    }, // 技术专业度
    ScoreDimension {
        name: "depth",
        weight: 0.25,
    }, // 技术深度
    ScoreDimension {
        name: "theory_practice",
        weight: 0.25,
    }, // 理论和实际项目结合
    ScoreDimension {
        name: "tech_sensitivity",
        weight: 0.15,
    }, // 技术敏感度
];

/// 单条消息的评分结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageScore {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    // 五个核心评分维度 (0-100)
    pub confidence_score: f64,       // 面试自信度
    pub professionalism_score: f64,  // 技术专业度
    pub depth_score: f64,            // 技术深度
    pub theory_practice_score: f64,  // 理论和实际项目结合程度
    pub tech_sensitivity_score: f64, // 技术敏感度
    pub overall_score: f64,          // 加权综合分
    pub feedback: String,            // AI 改进建议
    pub topic_tags: Vec<String>,     // 话题标签
    pub created_at: i64,
}

/// AI 返回的原始评分 JSON 结构(需校验)
#[derive(Debug, Deserialize)]
pub struct AIScoreResponse {
    pub confidence: f64,         // 面试自信度
    pub professionalism: f64,    // 技术专业度
    pub depth: f64,              // 技术深度
    pub theory_practice: f64,    // 理论和实际项目结合程度
    pub tech_sensitivity: f64,   // 技术敏感度
    pub feedback: String,        // 改进建议
    pub topic_tags: Vec<String>, // 话题标签
}

impl AIScoreResponse {
    /// 校验并 clamp 分数到 0-100 范围
    pub fn validate_and_clamp(&mut self) {
        self.confidence = self.confidence.clamp(0.0, 100.0);
        self.professionalism = self.professionalism.clamp(0.0, 100.0);
        self.depth = self.depth.clamp(0.0, 100.0);
        self.theory_practice = self.theory_practice.clamp(0.0, 100.0);
        self.tech_sensitivity = self.tech_sensitivity.clamp(0.0, 100.0);
    }

    /// 计算加权综合分
    pub fn calculate_overall(&self) -> f64 {
        let mut total = 0.0;
        for dim in SCORE_DIMENSIONS {
            let score = match dim.name {
                "confidence" => self.confidence,
                "professionalism" => self.professionalism,
                "depth" => self.depth,
                "theory_practice" => self.theory_practice,
                "tech_sensitivity" => self.tech_sensitivity,
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
    pub dimension_averages: DimensionAverages, // 五个维度平均分
    pub message_scores: Vec<MessageScore>,
    pub insights: Vec<SessionInsight>,
    pub completed_at: i64,
    pub message_count: usize, // 总消息数
    pub scored_count: usize,  // 已评分数
}

/// 维度平均分（五个维度）
#[derive(Debug, Serialize, Deserialize)]
pub struct DimensionAverages {
    pub confidence: f64,       // 面试自信度
    pub professionalism: f64,  // 技术专业度
    pub depth: f64,            // 技术深度
    pub theory_practice: f64,  // 理论和实际项目结合
    pub tech_sensitivity: f64, // 技术敏感度
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
    // 五个维度分数
    pub confidence: f64,
    pub professionalism: f64,
    pub depth: f64,
    pub theory_practice: f64,
    pub tech_sensitivity: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GapEvolution {
    pub resolved: Vec<String>,   // 已消除的盲点标题
    pub persistent: Vec<String>, // 持续存在的盲点
    pub new_gaps: Vec<String>,   // 新出现的盲点
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
