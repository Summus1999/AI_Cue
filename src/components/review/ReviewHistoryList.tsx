import { useState, useEffect } from 'react';
import { FileText, Trash2, RefreshCw, TrendingUp, AlertCircle } from 'lucide-react';
import * as reviewService from '../../services/reviewService';
import type { ReviewedSession } from '../../types/review';

interface ReviewHistoryListProps {
  onSelectReport: (sessionId: string) => void;
  onDeleteReport: (sessionId: string) => void;
  onViewTrend: () => void;
  activeSessionId?: string;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-500';
}

export function ReviewHistoryList({
  onSelectReport,
  onDeleteReport,
  onViewTrend,
  activeSessionId,
}: ReviewHistoryListProps) {
  const [reports, setReports] = useState<ReviewedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await reviewService.listReviewReports();
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载报告列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
        <span className="text-sm text-amber-600 mt-3">加载报告列表...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
        <p className="text-sm text-red-600 mb-3">{error}</p>
        <button
          onClick={loadReports}
          className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          重试
        </button>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-amber-600">
        <FileText className="w-12 h-12 text-amber-300 mb-3" />
        <p className="text-sm font-medium">暂无复盘报告</p>
        <p className="text-xs mt-1 text-amber-500">完成一次模拟面试后可以生成复盘报告</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-amber-700">
            {reports.length} 份复盘报告
          </span>
        </div>
        <button
          onClick={onViewTrend}
          className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors"
        >
          <TrendingUp className="w-3.5 h-3.5" />
          趋势对比
        </button>
      </div>

      {reports.map((report) => {
        const isActive = report.session_id === activeSessionId;
        return (
          <button
            key={report.session_id}
            type="button"
            onClick={() => onSelectReport(report.session_id)}
            className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              isActive
                ? 'border-amber-400 bg-amber-100/80'
                : 'border-amber-200 bg-white hover:bg-amber-50'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 flex-shrink-0 text-amber-500" />
                <p className="text-sm font-medium text-amber-900 truncate">
                  {report.title || '未命名面试'}
                </p>
              </div>
              <p className="mt-1 text-xs text-amber-600">
                {formatDate(report.completed_at)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-lg font-semibold ${scoreColor(report.overall_score)}`}>
                {Math.round(report.overall_score)}
              </span>
              <span className="text-xs text-amber-500">分</span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteReport(report.session_id);
                }}
                className="ml-2 p-1.5 rounded-lg hover:bg-red-100 text-amber-400 hover:text-red-500 transition-colors"
                title="删除报告"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default ReviewHistoryList;
