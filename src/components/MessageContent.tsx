import { CodeBlock } from './CodeBlock';

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
}

interface ContentSegment {
  type: "text" | "code";
  content: string;
  language?: string;
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
}: MessageContentProps) {
  const segments = parseContent(content);

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
        if (segment.type === "code") {
          return (
            <CodeBlock
              key={`code-${index}`}
              content={segment.content}
              language={segment.language}
              variant={variant}
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
            {normalizedText}
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
