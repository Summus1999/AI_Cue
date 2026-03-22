/**
 * 消息搜索栏组件
 * 位于消息列表上方，提供搜索输入和导航功能
 */

import { useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useMessageSearch } from '../store/messageSearch';

interface MessageSearchBarProps {
  className?: string;
}

/**
 * 消息搜索栏组件
 * 位于消息列表上方，提供搜索输入和导航功能
 */
export function MessageSearchBar({ className = '' }: MessageSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  
  const {
    isSearchOpen,
    keyword,
    results,
    currentIndex,
    setKeyword,
    closeSearch,
    nextResult,
    prevResult,
  } = useMessageSearch();

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (isSearchOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isSearchOpen]);

  // 键盘快捷键处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        prevResult();
      } else {
        nextResult();
      }
    }
    if (e.key === 'Escape') {
      closeSearch();
    }
  }, [nextResult, prevResult, closeSearch]);

  // 不显示时返回 null
  if (!isSearchOpen) {
    return null;
  }

  // 计算显示文本
  const matchCount = results?.totalMatches || 0;
  const displayIndex = matchCount > 0 ? currentIndex + 1 : 0;

  return (
    <div 
      className={`flex items-center gap-2 px-3 py-2 bg-amber-100/90 border-b border-amber-200 animate-slideDown ${className}`}
    >
      {/* 搜索图标 */}
      <Search className="w-4 h-4 text-amber-500 flex-shrink-0" />
      
      {/* 搜索输入框 */}
      <input
        ref={inputRef}
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索消息..."
        maxLength={200}
        className="flex-1 bg-white/80 border border-amber-300 rounded-lg px-3 py-1.5 text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
      />
      
      {/* 结果计数器 */}
      <span className="text-xs text-amber-600 whitespace-nowrap min-w-[60px] text-center">
        {keyword ? (
          matchCount > 0 
            ? `${displayIndex} / ${matchCount}`
            : '无匹配'
        ) : ''}
      </span>
      
      {/* 导航按钮 */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={prevResult}
          disabled={matchCount === 0}
          className="p-1 rounded hover:bg-amber-200/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp className="w-4 h-4 text-amber-700" />
        </button>
        <button
          onClick={nextResult}
          disabled={matchCount === 0}
          className="p-1 rounded hover:bg-amber-200/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="下一个 (Enter)"
        >
          <ChevronDown className="w-4 h-4 text-amber-700" />
        </button>
      </div>
      
      {/* 关闭按钮 */}
      <button
        onClick={closeSearch}
        className="p-1 rounded hover:bg-amber-200/50 transition-colors"
        title="关闭 (Esc)"
      >
        <X className="w-4 h-4 text-amber-700" />
      </button>
    </div>
  );
}
