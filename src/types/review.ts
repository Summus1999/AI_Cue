/**
 * 面试复盘报告类型定义
 * 与 Rust 端 src-tauri/src/review/types.rs 对应
 */

import type { InterviewContext } from './export';

/**
 * 单条消息的多维度评分
 */
export interface MessageScore {
  id: string;
  session_id: string;
  message_id: string;
  completeness_score: number;  // 完整性 0-100
  accuracy_score: number;      // 准确性 0-100
  clarity_score: number;       // 表达清晰度 0-100
  overall_score: number;       // 加权综合分
  feedback: string;            // AI 改进建议
  topic_tags: string[];        // 话题标签
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
 * 维度平均分
 */
export interface DimensionAverages {
  completeness: number;
  accuracy: number;
  clarity: number;
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
}

/**
 * 趋势对比中的单个数据点
 */
export interface TrendPoint {
  session_id: string;
  session_title: string;
  completed_at: number;
  overall_score: number;
  completeness: number;
  accuracy: number;
  clarity: number;
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
