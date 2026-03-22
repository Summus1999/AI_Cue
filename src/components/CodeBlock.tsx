/**
 * 代码块组件
 * 带复制和插入到编辑器功能的代码块展示
 */

import { useState, useCallback } from 'react';
import { Copy, Check, ArrowUpToLine } from 'lucide-react';
import { copyService } from '../services/copyService';
import { useCodeEditor } from '../store/codeEditor';
import { MatchRange } from '../services/searchEngine';

interface CodeBlockProps {
  content: string;
  language?: string;
  variant: 'user' | 'assistant';
  /** 搜索高亮：匹配区间数组 */
  highlightRanges?: MatchRange[];
  /** 搜索高亮：判断是否为当前焦点 */
  isCurrentHighlight?: (rangeIndex: number) => boolean;
}

export function CodeBlock({ 
  content, 
  language, 
  variant,
  highlightRanges = [],
  isCurrentHighlight = () => false,
}: CodeBlockProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [insertStatus, setInsertStatus] = useState<'idle' | 'inserted'>('idle');
  const { showEditor, setShowEditor, insertMode, insertCode } = useCodeEditor();

  // 一键复制
  const handleCopy = useCallback(async () => {
    const result = await copyService.copyPlainCode(content);
    if (result.success) {
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }, [content]);

  // 插入到编辑器（使用 store 的 insertCode 方法避免竞态条件）
  const handleInsertToEditor = useCallback(() => {
    if (!showEditor) {
      setShowEditor(true);
    }
    
    // 使用 store 的 insertCode 方法，内部处理状态更新
    insertCode(content, language || 'plaintext', insertMode);
    
    // 显示插入成功反馈
    setInsertStatus('inserted');
    setTimeout(() => setInsertStatus('idle'), 2000);
  }, [content, language, showEditor, insertMode, setShowEditor, insertCode]);

  // 样式
  const wrapperClass = variant === 'assistant'
    ? 'bg-stone-50 text-stone-900 border border-stone-200'
    : 'bg-white/80 text-amber-900 border border-amber-300';

  return (
    <div className={`overflow-hidden rounded-xl ${wrapperClass} group`}>
      {/* 头部：语言标签 + 操作按钮 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-black/10">
        {language && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            {language}
          </span>
        )}
        <div className={`flex items-center gap-1 ${language ? '' : 'ml-auto'} opacity-60 group-hover:opacity-100 transition-opacity`}>
          {/* 插入到编辑器按钮 */}
          <button
            onClick={handleInsertToEditor}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-stone-600 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors"
            title="插入到编辑器"
          >
            {insertStatus === 'inserted' ? (
              <>
                <Check className="w-3 h-3 text-green-600" />
                已插入
              </>
            ) : (
              <>
                <ArrowUpToLine className="w-3 h-3" />
                插入
              </>
            )}
          </button>
          
          {/* 复制按钮 */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-stone-600 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors"
            title="复制代码"
          >
            {copyStatus === 'copied' ? (
              <>
                <Check className="w-3 h-3 text-green-600" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                复制
              </>
            )}
          </button>
        </div>
      </div>

      {/* 代码内容 */}
      <pre className="overflow-x-auto px-3 py-3 text-[13px] leading-6 font-mono">
        <code>
          {highlightRanges.length > 0 ? (
            highlightCodeContent(content, highlightRanges, isCurrentHighlight)
          ) : (
            content
          )}
        </code>
      </pre>
    </div>
  );
}

/**
 * 为代码内容应用高亮
 * 保持代码块的 pre/code 结构不变
 */
function highlightCodeContent(
  content: string,
  ranges: MatchRange[],
  isCurrentHighlight: (rangeIndex: number) => boolean
): React.ReactNode {
  if (ranges.length === 0) {
    return content;
  }

  const fragments: React.ReactNode[] = [];
  let lastEnd = 0;

  ranges.forEach((range, idx) => {
    // 高亮前的代码
    if (range.start > lastEnd) {
      fragments.push(content.slice(lastEnd, range.start));
    }

    const isCurrent = isCurrentHighlight(idx);

    // 高亮代码
    fragments.push(
      <span
        key={`code-hl-${idx}`}
        className={isCurrent 
          ? 'bg-orange-300 text-orange-900 rounded' 
          : 'bg-yellow-200 text-yellow-900 rounded'
        }
        data-search-highlight={isCurrent ? 'current' : 'match'}
      >
        {content.slice(range.start, range.end)}
      </span>
    );

    lastEnd = range.end;
  });

  // 剩余代码
  if (lastEnd < content.length) {
    fragments.push(content.slice(lastEnd));
  }

  return fragments;
}
