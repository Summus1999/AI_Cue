import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ReviewReport, TrendData, ReviewProgress } from '../types/review';

/**
 * 启动复盘
 * @param sessionId 会话 ID
 * @param provider AI 提供商
 * @param config Provider 配置 (apiKey, baseUrl) - 必须使用 camelCase 以匹配后端 serde
 * @param model 模型名称
 */
export async function startReview(
  sessionId: string,
  provider: string,
  config: { apiKey: string; baseUrl: string | null },
  model: string,
): Promise<void> {
  await invoke('start_review', {
    sessionId,
    provider,
    config,
    model,
  });
}

/**
 * 获取复盘报告
 */
export async function getReviewReport(sessionId: string): Promise<ReviewReport> {
  return await invoke('get_review_report', { sessionId });
}

/**
 * 获取趋势对比数据
 */
export async function getReviewTrend(): Promise<TrendData> {
  return await invoke('get_review_trend');
}

/**
 * 删除复盘数据
 */
export async function deleteReview(sessionId: string): Promise<void> {
  await invoke('delete_review', { sessionId });
}

/**
 * 获取会话复盘状态
 * @returns 'completed' | 'none' | 'error'
 */
export async function getSessionReviewStatus(sessionId: string): Promise<'completed' | 'none' | 'error'> {
  try {
    const report = await getReviewReport(sessionId);
    return report ? 'completed' : 'none';
  } catch (err) {
    console.error('获取复盘状态失败:', err);
    return 'error';
  }
}

/**
 * 监听复盘进度事件
 * @returns unlisten 函数
 */
export async function onReviewProgress(
  callback: (progress: ReviewProgress) => void,
): Promise<() => void> {
  const unlisten = await listen<ReviewProgress>('review-progress', (event) => {
    callback(event.payload);
  });
  return unlisten;
}
