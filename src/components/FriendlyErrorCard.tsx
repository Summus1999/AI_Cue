/**
 * 友好错误卡片组件
 * 将技术性错误转换为用户可理解的友好提示 + 建议操作
 */

import { useState } from 'react';
import { FriendlyError } from '../services/errorClassifier';

interface Props {
  /** 友好错误信息 */
  error: FriendlyError;
  /** 重试回调 */
  onRetry?: () => void;
  /** 关闭回调 */
  onDismiss?: () => void;
  /** 是否显示原始错误（调试用） */
  showOriginalError?: boolean;
  /** 原始错误信息 */
  originalError?: string;
}

/**
 * 友好错误卡片
 * 显示非技术性的错误提示和建议操作
 */
export function FriendlyErrorCard({
  error,
  onRetry,
  onDismiss,
  showOriginalError = false,
  originalError,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-red-50/90 backdrop-blur-sm border border-red-200 rounded-xl p-4 max-w-md shadow-sm">
      {/* 标题行 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{error.icon}</span>
        <span className="font-medium text-red-800">{error.title}</span>
      </div>

      {/* 友好提示 */}
      <p className="text-red-700 text-sm mb-2">{error.message}</p>

      {/* 建议操作 */}
      <p className="text-red-600 text-xs mb-3">
        <span className="inline-block mr-1">💡</span>
        {error.suggestion}
      </p>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        {error.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs rounded-lg transition-colors"
          >
            重试
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded-lg transition-colors"
          >
            取消
          </button>
        )}

        {/* 展开原始错误（调试用） */}
        {showOriginalError && originalError && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-700 ml-auto underline"
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
