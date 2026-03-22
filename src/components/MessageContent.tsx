import { CodeBlock } from './CodeBlock';
import { useMessageSearch } from '../store/messageSearch';
import { MatchRange } from '../services/searchEngine';

interface MessageContentProps {
  content: string;
  variant: "user" | "assistant";
  /** 消息是否完整生成 */
  isComplete?: boolean;
  /** 中断原因 */
  interruptReason?: 'user_abort' | 'error' | 'timeout' | 'network';
  /** 继续生成回调 */
  onContinue?: () => void;
  /** 是否正在生成中 */
  isGenerating?: boolean;
  /** 搜索高亮：消息 ID */
  messageId?: string;
  /** 搜索高亮：是否启用高亮 */
  highlightEnabled?: boolean;
}

interface ContentSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

interface HighlightedTextProps {
  text: string;
  ranges: MatchRange[];
  segmentIndex: number;
  isCurrentHighlight: (rangeIndex: number) => boolean;
}

/**
 * 高亮文本渲染组件
 * 将文本按照高亮区间拆分为多个片段，分别渲染
 */
function HighlightedText({ 
  text, 
  ranges, 
  segmentIndex,
  isCurrentHighlight,
}: HighlightedTextProps) {
  // 无高亮区间时直接返回原文本
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const fragments: React.ReactNode[] = [];
  let lastEnd = 0;

  ranges.forEach((range, rangeIndex) => {
    // 高亮前的普通文本
    if (range.start > lastEnd) {
      fragments.push(
        <span key={`text-${segmentIndex}-${rangeIndex}-pre`}>
          {text.slice(lastEnd, range.start)}
        </span>
      );
    }

    // 判断是否为当前焦点
    const isCurrent = isCurrentHighlight(rangeIndex);

    // 高亮文本
    fragments.push(
      <mark
        key={`highlight-${segmentIndex}-${rangeIndex}`}
        className={isCurrent 
          ? 'bg-orange-400 text-orange-900 rounded px-0.5' 
          : 'bg-yellow-300 text-yellow-900 rounded px-0.5'
        }
        data-search-highlight={isCurrent ? 'current' : 'match'}
      >
        {text.slice(range.start, range.end)}
      </mark>
    );

    lastEnd = range.end;
  });

  // 最后的普通文本
  if (lastEnd < text.length) {
    fragments.push(
      <span key={`text-${segmentIndex}-end`}>{text.slice(lastEnd)}</span>
    );
  }

  return <>{fragments}</>;
}

function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of content.matchAll(codeBlockRegex)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, matchIndex),
      });
    }

    segments.push({
      type: "code",
      language: match[1] || undefined,
      content: match[2].replace(/^\n/, "").replace(/\n$/, ""),
    });

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      content: content.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

export function MessageContent({
  content,
  variant,
  isComplete = true,
  interruptReason,
  onContinue,
  isGenerating,
  messageId,
  highlightEnabled = false,
}: MessageContentProps) {
  const segments = parseContent(content);
  const { getHighlightRanges, isCurrentHighlight } = useMessageSearch();

  // 中断原因显示文本
  const getInterruptReasonText = (reason?: string): string => {
    switch (reason) {
      case 'timeout': return '超时';
      case 'network': return '网络中断';
      case 'error': return '出错';
      case 'user_abort': return '用户中断';
      default: return '';
    }
  };

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        // 获取该段的高亮区间
        const ranges = highlightEnabled && messageId 
          ? getHighlightRanges(messageId, index)
          : [];

        if (segment.type === "code") {
          return (
            <CodeBlock
              key={`code-${index}`}
              content={segment.content}
              language={segment.language}
              variant={variant}
              highlightRanges={ranges}
              isCurrentHighlight={(rangeIndex: number) => 
                messageId ? isCurrentHighlight(messageId, index, rangeIndex) : false
              }
            />
          );
        }

        const normalizedText = segment.content.trim();
        if (!normalizedText) {
          return null;
        }

        return (
          <div
            key={`text-${index}`}
            className="whitespace-pre-wrap break-words"
          >
            {ranges.length > 0 ? (
              <HighlightedText
                text={normalizedText}
                ranges={ranges}
                segmentIndex={index}
                isCurrentHighlight={(rangeIndex) => 
                  messageId ? isCurrentHighlight(messageId, index, rangeIndex) : false
                }
              />
            ) : (
              normalizedText
            )}
          </div>
        );
      })}

      {/* 未完成提示 + 继续生成按钮（仅对 assistant 消息显示） */}
      {variant === 'assistant' && !isComplete && !isGenerating && (
        <div className="mt-3 pt-3 border-t border-amber-200/30">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <span>⚠️ 回答未完成</span>
            {interruptReason && (
              <span className="text-amber-400">
                ({getInterruptReasonText(interruptReason)})
              </span>
            )}
          </div>
          {onContinue && (
            <button
              onClick={onContinue}
              disabled={isGenerating}
              className={`mt-2 flex items-center gap-1.5 px-3 py-1.5 text-white text-xs rounded-lg transition-colors ${
                isGenerating
                  ? 'bg-amber-400 cursor-not-allowed opacity-60'
                  : 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
              </svg>
              继续生成
            </button>
          )}
        </div>
      )}
    </div>
  );
}
