/**
 * 友好错误卡片组件
 * 将技术性错误转换为用户可理解的友好提示 + 建议操作
 */

import { useState } from 'react';
import { Settings, Database, RefreshCw, Copy, X } from 'lucide-react';
import type { FriendlyError } from '../services/errorClassifier';

interface Props {
  /** 友好错误信息 */
  error: FriendlyError;
  /** 重试回调 */
  onRetry?: () => void;
  /** 前往设置回调 */
  onGoToSettings?: () => void;
  /** 前往知识库回调 */
  onGoToKnowledge?: () => void;
  /** 关闭回调 */
  onDismiss?: () => void;
  /** 原始错误信息（调试用） */
  originalError?: string;
  /** 错误发生时间 */
  timestamp?: number;
}

/**
 * 友好错误卡片
 * 显示非技术性的错误提示，并根据错误类型提供对应的操作按钮
 */
export function FriendlyErrorCard({
  error,
  onRetry,
  onGoToSettings,
  onGoToKnowledge,
  onDismiss,
  originalError,
  timestamp,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyDiagnostics = () => {
    const diagnostics = [
      `错误: ${error.title}`,
      `类型: ${error.userFacingKind}`,
      `分类: ${error.category}`,
      `时间: ${timestamp ? new Date(timestamp).toISOString() : '未知'}`,
      originalError ? `原始信息: ${originalError}` : '',
    ].filter(Boolean).join('\n');

    // Tauri 环境下 clipboard API 可能因权限问题失败，catch 中给用户反馈
    navigator.clipboard.writeText(diagnostics).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.warn('复制诊断信息失败:', err);
    });
  };

  const primaryAction = error.primaryAction;

  return (
    <div className="bg-red-50/90 backdrop-blur-sm border border-red-200 rounded-xl p-4 max-w-md shadow-sm">
      {/* 标题行 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{error.icon}</span>
          <span className="font-medium text-red-800">{error.title}</span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 友好提示 */}
      <p className="text-red-700 text-sm mb-2">{error.message}</p>

      {/* 建议操作 */}
      <p className="text-red-600 text-xs mb-3">
        <span className="inline-block mr-1">💡</span>
        {error.suggestion}
      </p>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 主要操作按钮 */}
        {primaryAction?.kind === 'settings' && onGoToSettings && (
          <button
            onClick={onGoToSettings}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs rounded-lg transition-colors"
          >
            <Settings className="w-3 h-3" />
            {primaryAction.label}
          </button>
        )}
        {primaryAction?.kind === 'knowledge' && onGoToKnowledge && (
          <button
            onClick={onGoToKnowledge}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs rounded-lg transition-colors"
          >
            <Database className="w-3 h-3" />
            {primaryAction.label}
          </button>
        )}
        {primaryAction?.kind === 'retry' && error.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs rounded-lg transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {primaryAction.label}
          </button>
        )}

        {/* 无 primaryAction 时显示通用重试按钮 */}
        {!primaryAction && error.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs rounded-lg transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        )}

        {/* 复制诊断信息 */}
        {(originalError || timestamp) && (
          <button
            onClick={handleCopyDiagnostics}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg transition-colors"
          >
            <Copy className="w-3 h-3" />
            {copied ? '已复制' : '复制诊断'}
          </button>
        )}

        {/* 展开原始错误（调试用） */}
        {originalError && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-700 underline ml-auto"
          >
            {expanded ? '收起详情' : '查看详情'}
          </button>
        )}
      </div>

      {/* 原始错误详情 */}
      {expanded && originalError && (
        <div className="mt-3 p-2 bg-gray-100 rounded text-xs text-gray-600 font-mono break-all max-h-32 overflow-y-auto">
          {originalError}
        </div>
      )}
    </div>
  );
}
