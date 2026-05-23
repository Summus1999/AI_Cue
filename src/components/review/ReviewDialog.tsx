import { useState, useCallback, useEffect } from 'react';
import { X, Play, RefreshCw, FileDown, AlertCircle } from 'lucide-react';
import { useReviewStore } from '../../store/review';
import { loadConfig, QuestionTiming } from '../../store/config';
import { ReviewReport as ReviewReportComponent } from './ReviewReport';
import { TrendComparison } from './TrendComparison';
import { ReviewHistoryList } from './ReviewHistoryList';
import { getSessionReviewStatus, getReviewReport, deleteReview } from '../../services/reviewService';
import { exportService } from '../../services/export/exportService';
import type { TimingStats } from '../../types/review';

interface ReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  sessionTitle: string;
  questionTimings?: QuestionTiming[];  // 每题用时数据
}

// 阶段描述映射
const phaseDescriptions: Record<string, string> = {
  scoring: '正在评分回答...',
  analyzing: '正在分析知识盲点...',
  summarizing: '正在生成报告...',
  completed: '复盘完成',
  failed: '复盘失败',
};

// 计算用时统计数据
function computeTimingStats(questionTimings?: QuestionTiming[]): TimingStats | undefined {
  if (!questionTimings || questionTimings.length === 0) {
    return undefined;
  }

  const durations = questionTimings.map(t => t.durationMs);
  const totalDurationMs = durations.reduce((a, b) => a + b, 0);
  const averageDurationMs = Math.round(totalDurationMs / durations.length);
  const fastestDurationMs = Math.min(...durations);
  const slowestDurationMs = Math.max(...durations);

  return {
    totalDurationMs,
    averageDurationMs,
    fastestDurationMs,
    slowestDurationMs,
    questionTimings: questionTimings.map(t => ({
      questionIndex: t.questionIndex,
      questionContent: t.questionContent,
      durationMs: t.durationMs,
    })),
  };
}

export function ReviewDialog({ isOpen, onClose, sessionId, sessionTitle, questionTimings }: ReviewDialogProps) {
  const {
    reviewStatus,
    progress,
    report,
    error,
    trend,
    startReview,
    loadReport,
    loadTrend,
    resetReview,
  } = useReviewStore();

  const [hasExistingReview, setHasExistingReview] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'report' | 'history' | 'trend'>('report');
  const [viewHistorySessionId, setViewHistorySessionId] = useState<string | null>(null);
  const [historyReport, setHistoryReport] = useState<typeof report>(null);

  // 打开时检查是否已有复盘
  useEffect(() => {
    if (!isOpen) return;

    const checkReviewStatus = async () => {
      setIsLoading(true);
      setStatusError(null);
      try {
        const status = await getSessionReviewStatus(sessionId);
        
        if (status === 'error') {
          setStatusError('检查复盘状态失败');
          setHasExistingReview(false);
          resetReview();
          return;
        }
        
        setHasExistingReview(status === 'completed');
        
        // 如果已有复盘，直接加载报告
        if (status === 'completed') {
          await loadReport(sessionId);
        } else {
          resetReview();
        }
      } catch (err) {
        console.error('检查复盘状态失败:', err);
        setStatusError('检查复盘状态失败');
        setHasExistingReview(false);
        resetReview();
      } finally {
        setIsLoading(false);
      }
    };

    checkReviewStatus();
  }, [isOpen, sessionId, loadReport, resetReview]);

  // 开始复盘
  const handleStartReview = useCallback(async () => {
    try {
      const config = await loadConfig();
      const providerConfig = config.providerConfigs[config.activeProvider];
      
      await startReview(
        sessionId,
        config.activeProvider,
        { apiKey: providerConfig.apiKey, baseUrl: providerConfig.baseUrl || null },
        providerConfig.model
      );
      setHasExistingReview(true);
    } catch (err) {
      console.error('启动复盘失败:', err);
    }
  }, [sessionId, startReview]);

  // 重新生成
  const handleRegenerate = useCallback(async () => {
    resetReview();
    setHasExistingReview(false);
    await handleStartReview();
  }, [resetReview, handleStartReview]);

  // 导出 PDF
  const handleExportPdf = useCallback(async () => {
    const targetReport = historyReport || report;
    if (!targetReport) return;
    try {
      await exportService.exportReviewReport(targetReport);
    } catch (err) {
      console.error('导出复盘 PDF 失败:', err);
    }
  }, [report, historyReport]);

  // 从历史列表选择报告
  const handleSelectHistoryReport = useCallback(async (sessionId: string) => {
    try {
      setViewHistorySessionId(sessionId);
      const reportData = await getReviewReport(sessionId);
      setHistoryReport(reportData);
    } catch (err) {
      console.error('加载历史报告失败:', err);
    }
  }, []);

  // 删除历史报告
  const handleDeleteHistoryReport = useCallback(async (sessionId: string) => {
    try {
      await deleteReview(sessionId);
      if (viewHistorySessionId === sessionId) {
        setViewHistorySessionId(null);
        setHistoryReport(null);
      }
    } catch (err) {
      console.error('删除报告失败:', err);
    }
  }, [viewHistorySessionId]);

  // 关闭时重置
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  // 计算进度百分比
  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-amber-50 rounded-xl shadow-xl w-[640px] max-h-[90vh] flex flex-col border border-amber-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-amber-200 flex-shrink-0">
          <div className="flex flex-col">
            <h3 className="text-sm font-medium text-amber-900">面试复盘</h3>
            <span className="text-xs text-amber-600 mt-0.5 truncate max-w-[400px]">{sessionTitle}</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-amber-100 rounded transition-colors"
          >
            <X className="w-4 h-4 text-amber-600" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[300px]">
          {/* 加载中 */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-8 h-8 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
              <span className="text-sm text-amber-600 mt-3">正在检查复盘状态...</span>
            </div>
          )}

          {/* 检查状态失败 */}
          {!isLoading && statusError && (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h4 className="text-base font-medium text-amber-900 mb-2">检查状态失败</h4>
              <p className="text-sm text-red-600 text-center max-w-[300px] mb-6">
                {statusError}
              </p>
              <button
                onClick={handleStartReview}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                开始复盘
              </button>
            </div>
          )}

          {/* 未开始复盘 - 显示开始按钮 */}
          {!isLoading && !statusError && !hasExistingReview && reviewStatus === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                <Play className="w-8 h-8 text-amber-600" />
              </div>
              <h4 className="text-base font-medium text-amber-900 mb-2">开始面试复盘</h4>
              <p className="text-sm text-amber-600 text-center max-w-[300px] mb-6">
                AI 将分析你的每一条回答，提供评分、知识盲点分析和改进建议
              </p>
              <button
                onClick={handleStartReview}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                开始复盘
              </button>
            </div>
          )}

          {/* 复盘进行中 - 显示进度 */}
          {!isLoading && reviewStatus === 'in_progress' && (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-full max-w-[400px]">
                {/* 进度条 */}
                <div className="h-2 bg-amber-200 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-amber-600 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* 阶段描述 */}
                <div className="text-center">
                  <p className="text-sm font-medium text-amber-900 mb-1">
                    {progress?.message || phaseDescriptions[progress?.phase || 'scoring']}
                  </p>
                  {progress && progress.phase === 'scoring' && (
                    <p className="text-xs text-amber-600">
                      正在评分第 {progress.current}/{progress.total} 条回答...
                    </p>
                  )}
                  {progress && progress.phase === 'analyzing' && (
                    <p className="text-xs text-amber-600">
                      正在分析知识盲点和优势...
                    </p>
                  )}
                  {progress && progress.phase === 'summarizing' && (
                    <p className="text-xs text-amber-600">
                      正在生成综合报告...
                    </p>
                  )}
                </div>

                {/* 动画指示器 */}
                <div className="flex justify-center mt-6">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-amber-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-amber-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-amber-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 复盘完成 - 显示报告或趋势 */}
          {!isLoading && (reviewStatus === 'completed' || activeTab === 'history' || activeTab === 'trend') && (
            <>
              {/* 选项卡 */}
              <div className="flex border-b border-amber-200/30 mb-4">
                {reviewStatus === 'completed' && report && (
                  <button
                    onClick={() => setActiveTab('report')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === 'report'
                        ? 'text-amber-900 border-b-2 border-amber-600'
                        : 'text-amber-600/60 hover:text-amber-700'
                    }`}
                  >
                    本次报告
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'history'
                      ? 'text-amber-900 border-b-2 border-amber-600'
                      : 'text-amber-600/60 hover:text-amber-700'
                  }`}
                >
                  历史报告
                </button>
                <button
                  onClick={() => {
                    setActiveTab('trend');
                    if (!trend) loadTrend();
                  }}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'trend'
                      ? 'text-amber-900 border-b-2 border-amber-600'
                      : 'text-amber-600/60 hover:text-amber-700'
                  }`}
                >
                  进步趋势
                </button>
              </div>

              {/* 历史报告列表 */}
              {activeTab === 'history' && (
                <ReviewHistoryList
                  onSelectReport={handleSelectHistoryReport}
                  onDeleteReport={handleDeleteHistoryReport}
                  onViewTrend={() => {
                    setActiveTab('trend');
                    if (!trend) loadTrend();
                  }}
                  activeSessionId={viewHistorySessionId ?? undefined}
                />
              )}

              {/* 从历史列表加载的报告详情 */}
              {activeTab === 'history' && historyReport && (
                <div className="mt-4">
                  <div className="border-t border-amber-200 pt-4">
                    <ReviewReportComponent
                      report={historyReport}
                      onExportPdf={handleExportPdf}
                    />
                  </div>
                </div>
              )}

              {/* 内容区域 */}
              {activeTab === 'report' && report && (
                <ReviewReportComponent
                  report={report}
                  onExportPdf={handleExportPdf}
                  timingStats={computeTimingStats(questionTimings)}
                />
              )}
              {activeTab === 'trend' && (
                trend ? (
                  <TrendComparison trend={trend} />
                ) : (
                  <div className="text-center text-amber-600/60 py-8">
                    <div className="w-6 h-6 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin mx-auto mb-3" />
                    <p>加载趋势数据中...</p>
                  </div>
                )
              )}
            </>
          )}

          {/* 错误状态 */}
          {!isLoading && reviewStatus === 'error' && (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h4 className="text-base font-medium text-amber-900 mb-2">复盘失败</h4>
              <p className="text-sm text-red-600 text-center max-w-[300px] mb-6">
                {error || '生成复盘报告时出现错误，请重试'}
              </p>
              <button
                onClick={handleStartReview}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮 - 仅在完成时显示 */}
        {!isLoading && reviewStatus === 'completed' && report && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-amber-200 flex-shrink-0">
            <button
              onClick={handleExportPdf}
              className="px-4 py-2 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <FileDown className="w-3.5 h-3.5" />
              导出 PDF
            </button>
            <button
              onClick={handleRegenerate}
              className="px-4 py-2 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新生成
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
