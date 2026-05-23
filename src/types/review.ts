/**
 * 面试复盘报告类型定义
 * 与 Rust 端 src-tauri/src/review/types.rs 对应
 */

import type { InterviewContext } from './export';

/**
 * 单条消息的多维度评分 - 五个核心维度
 */
export interface MessageScore {
  id: string;
  session_id: string;
  message_id: string;
  // 五个核心评分维度
  confidence_score: number;           // 面试自信度 0-100
  professionalism_score: number;     // 技术专业度 0-100
  depth_score: number;              // 技术深度 0-100
  theory_practice_score: number;    // 理论和实际项目结合程度 0-100
  tech_sensitivity_score: number;    // 技术敏感度 0-100
  overall_score: number;            // 加权综合分
  feedback: string;                  // AI 改进建议
  topic_tags: string[];              // 话题标签
  response_time_ms?: number;         // 回答用时（毫秒）
  created_at: number;
}

/**
 * 会话洞察类型
 */
export type InsightType = 'knowledge_gap' | 'strength' | 'suggestion';

/**
 * 会话洞察（知识盲点/优势/改进建议）
 */
export interface SessionInsight {
  id: string;
  session_id: string;
  insight_type: InsightType;
  title: string;
  detail: string;
  related_message_ids: string[];
  priority: number;
  created_at: number;
}

/**
 * 维度平均分 - 五个维度
 */
export interface DimensionAverages {
  confidence: number;           // 面试自信度
  professionalism: number;      // 技术专业度
  depth: number;                // 技术深度
  theory_practice: number;      // 理论和实际项目结合
  tech_sensitivity: number;     // 技术敏感度
}

/**
 * 回答用时统计
 */
export interface TimingStats {
  totalDurationMs: number;       // 总面试时长
  averageDurationMs: number;     // 平均每题用时
  fastestDurationMs: number;     // 最快回答
  slowestDurationMs: number;     // 最慢回答
  questionTimings: Array<{
    questionIndex: number;
    questionContent: string;
    durationMs: number;
  }>;
}

/**
 * 复盘报告完整数据
 */
export interface ReviewReport {
  session_id: string;
  session_title: string;
  interview_context?: InterviewContext;
  overall_score: number;
  dimension_averages: DimensionAverages;
  message_scores: MessageScore[];
  insights: SessionInsight[];
  completed_at: number;
  message_count: number;
  scored_count: number;
  timing_stats?: TimingStats;    // 回答用时统计（可选）
}

/**
 * 趋势对比中的单个数据点 - 五个维度
 */
export interface TrendPoint {
  session_id: string;
  session_title: string;
  completed_at: number;
  overall_score: number;
  // 五个维度
  confidence: number;
  professionalism: number;
  depth: number;
  theory_practice: number;
  tech_sensitivity: number;
}

/**
 * 知识盲点演变
 */
export interface GapEvolution {
  resolved: string[];     // 已消除的盲点
  persistent: string[];   // 持续存在的盲点
  new_gaps: string[];     // 新出现的盲点
}

/**
 * 趋势对比数据（跨会话）
 */
export interface TrendData {
  sessions: TrendPoint[];
  gap_evolution: GapEvolution;
}

/**
 * 复盘进度阶段
 */
export type ReviewPhase = 'scoring' | 'analyzing' | 'summarizing' | 'completed' | 'failed';

/**
 * 复盘进度事件（从后端推送）
 */
export interface ReviewProgress {
  phase: ReviewPhase;
  current: number;
  total: number;
  message: string;
}

/**
 * 复盘状态
 */
export type ReviewStatus = 'idle' | 'in_progress' | 'completed' | 'error';

/**
 * 已复盘的会话摘要（用于历史列表）
 */
export interface ReviewedSession {
  session_id: string;
  title: string;
  overall_score: number;
  completed_at: number;
  review_status: string;
}
