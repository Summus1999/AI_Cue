import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReviewReport, TrendData, ReviewProgress, ReviewStatus } from '../types/review';
import * as reviewService from '../services/reviewService';

/**
 * 复盘状态管理 Hook
 */
export function useReviewStore() {
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('idle');
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 使用 ref 存储 unlisten 函数和卸载标志，确保异步安全访问
  const unlistenRef = useRef<(() => void) | null>(null);
  const isUnmountedRef = useRef(false);

  // 监听进度事件
  useEffect(() => {
    isUnmountedRef.current = false;

    // 异步注册事件监听
    reviewService.onReviewProgress((prog) => {
      // 组件已卸载，忽略事件
      if (isUnmountedRef.current) return;

      setProgress(prog);
      if (prog.phase === 'completed') {
        setReviewStatus('completed');
      } else if (prog.phase === 'failed') {
        setReviewStatus('error');
        setError(prog.message);
      }
    }).then((unlisten) => {
      // 注册完成后才存储 unlisten 函数
      unlistenRef.current = unlisten;
    });

    // 清理函数
    return () => {
      isUnmountedRef.current = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // 启动复盘
  const startReview = useCallback(async (
    sessionId: string,
    provider: string,
    config: { apiKey: string; baseUrl: string | null },
    model: string,
  ) => {
    try {
      setReviewStatus('in_progress');
      setProgress(null);
      setError(null);
      setReport(null);
      await reviewService.startReview(sessionId, provider, config, model);
      // 完成后自动加载报告
      const reportData = await reviewService.getReviewReport(sessionId);
      setReport(reportData);
    } catch (err) {
      setReviewStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 加载已有报告
  const loadReport = useCallback(async (sessionId: string) => {
    try {
      const reportData = await reviewService.getReviewReport(sessionId);
      setReport(reportData);
      setReviewStatus('completed');
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 加载趋势数据
  const loadTrend = useCallback(async () => {
    try {
      const trendData = await reviewService.getReviewTrend();
      setTrend(trendData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 删除复盘
  const removeReview = useCallback(async (sessionId: string) => {
    try {
      await reviewService.deleteReview(sessionId);
      setReport(null);
      setReviewStatus('idle');
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 重置状态
  const resetReview = useCallback(() => {
    setReviewStatus('idle');
    setProgress(null);
    setReport(null);
    setError(null);
  }, []);

  return {
    reviewStatus,
    progress,
    report,
    trend,
    error,
    startReview,
    loadReport,
    loadTrend,
    removeReview,
    resetReview,
  };
}
