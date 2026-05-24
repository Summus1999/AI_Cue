// 紧凑模式视图组件
import { X, Maximize2 } from 'lucide-react';
import type { PromptMode } from '../store/config';

interface CompactViewProps {
  latestAIMessage: string | null;    // 最新一条 AI 回答的内容
  isStreaming: boolean;               // 是否正在流式输出
  onExpand: () => void;               // 展开回完整模式
  onClose: () => void;                // 关闭应用
  passthroughActive: boolean;         // 穿透模式状态
  onTogglePassthrough: () => void;    // 切换穿透模式
  promptMode?: PromptMode;            // 当前 Prompt 模式，cheat 模式使用特殊渲染
}

/**
 * 截断内容，替换代码块为占位符
 */
function truncateContent(content: string, maxLength: number = 200): { text: string; isTruncated: boolean } {
  // 替换代码块为占位符
  let processed = content.replace(/```[\s\S]*?```/g, '[代码块]');

  if (processed.length <= maxLength) {
    return { text: processed, isTruncated: false };
  }
  return { text: processed.slice(0, maxLength) + '...', isTruncated: true };
}

// cheat 模式下解析 AI 输出：首行为摘要，- 开头为要点，【】内为高亮
function parseCheatContent(content: string): { summary: string; bullets: string[] } | null {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const summary = lines[0].trim();
  const bullets = lines.slice(1)
    .filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'))
    .map(l => l.replace(/^[-•]\s*/, '').trim());

  if (bullets.length === 0) return null;
  return { summary, bullets };
}

// 渲染【】包裹的关键术语为高亮span
function renderHighlightedText(text: string): React.ReactNode {
  const parts = text.split(/(【[^】]*】)/g);
  return parts.map((part, i) => {
    if (part.startsWith('【') && part.endsWith('】')) {
      return <span key={i} className="text-amber-600 font-semibold">{part.slice(1, -1)}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function CompactView({
  latestAIMessage,
  isStreaming,
  onExpand,
  onClose,
  passthroughActive,
  onTogglePassthrough,
  promptMode,
}: CompactViewProps) {
  const isCheat = promptMode === 'cheat';
  const maxLen = isCheat ? 300 : 200;
  const { text, isTruncated } = latestAIMessage
    ? truncateContent(latestAIMessage, maxLen)
    : { text: '', isTruncated: false };

  const cheatParsed = isCheat && latestAIMessage ? parseCheatContent(latestAIMessage) : null;

  const handleDoubleClick = () => {
    onExpand();
  };

  return (
    <div className="compact-view flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      {/* 精简标题栏 */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-7 px-2 bg-amber-100/80 border-b border-amber-200 select-none shrink-0"
      >
        {/* 左侧拖拽区域 */}
        <div data-tauri-drag-region className="flex-1 h-full flex items-center">
          <span className="text-[10px] text-amber-600/60 ml-1">紧凑模式</span>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-0.5">
          {/* 展开按钮 */}
          <button
            onClick={onExpand}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="展开为完整模式"
          >
            <Maximize2 className="w-3 h-3 text-amber-700" />
          </button>

          {/* 穿透模式开关 */}
          <button
            onClick={onTogglePassthrough}
            className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
              passthroughActive 
                ? 'bg-amber-600 text-white' 
                : 'text-amber-700 hover:bg-amber-200/50'
            }`}
            title={passthroughActive ? '点击穿透：开启' : '点击穿透：关闭'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              {passthroughActive ? (
                <path d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.708A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" strokeDasharray="3 2" />
              ) : (
                <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.708A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" clipRule="evenodd" />
              )}
            </svg>
          </button>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-red-900/30 transition-colors duration-150"
            title="关闭"
          >
            <X className="w-3 h-3 text-amber-700 hover:text-red-500" />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div
        data-interactive="true"
        className="compact-content flex-1 overflow-y-auto p-3 scrollbar-hide"
        onDoubleClick={handleDoubleClick}
      >
        {latestAIMessage ? (
          <div className="text-sm leading-relaxed text-amber-900">
            {cheatParsed ? (
              // cheat 模式：摘要 + 要点列表，【】内高亮
              <div className="space-y-1.5">
                <p className="font-semibold text-amber-950">
                  {renderHighlightedText(cheatParsed.summary)}
                </p>
                <ul className="space-y-1">
                  {cheatParsed.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-amber-500 mt-0.5 text-xs">&#8226;</span>
                      <span className="text-amber-800">{renderHighlightedText(bullet)}</span>
                    </li>
                  ))}
                </ul>
                {isStreaming && <span className="streaming-cursor" />}
              </div>
            ) : (
              <span>{text}</span>
            )}
            {!cheatParsed && isStreaming && <span className="streaming-cursor" />}
            {isTruncated && (
              <span
                onClick={onExpand}
                className="ml-1 text-amber-600 hover:text-amber-700 cursor-pointer underline underline-offset-2"
              >
                展开查看完整回答
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-amber-600/70">
            {isStreaming ? (
              <span className="streaming-cursor">正在生成...</span>
            ) : (
              '等待 AI 回答...'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
