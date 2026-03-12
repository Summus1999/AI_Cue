import { useState, useRef, useEffect } from "react";
import { Send, Minus, X, Settings } from "lucide-react";
import { SettingsPanel } from "./components/SettingsPanel";

// 消息类型定义
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

function App() {
  // 消息列表状态
  const [messages, setMessages] = useState<Message[]>([
    {
      id: generateId(),
      role: "assistant",
      content: "你好，我是你的面试助手。输入面试官的问题，我会帮你生成回答要点。",
      timestamp: Date.now(),
    },
  ]);
  
  // 输入框状态
  const [input, setInput] = useState("");
  
  // 是否正在生成回复
  const [isGenerating, setIsGenerating] = useState(false);
  
  // 设置面板开关状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // 滚动引用
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsGenerating(true);

    // TODO: 后续接入 AI API，目前模拟回复
    setTimeout(() => {
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: "收到你的问题。这是一个模拟回复，后续将接入千问 API 提供实时回答。",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsGenerating(false);
    }, 800);
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 最小化窗口
  const handleMinimize = () => {
    // TODO: 调用 Tauri API 最小化窗口
    console.log("最小化窗口");
  };

  // 关闭窗口
  const handleClose = () => {
    // TODO: 调用 Tauri API 关闭窗口
    console.log("关闭窗口");
  };

  return (
    <div className="relative flex flex-col w-full h-full bg-slate-950 text-cyan-400 overflow-hidden rounded-2xl">
      {/* 自定义标题栏 - 支持拖拽 */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-10 px-4 bg-slate-950/80 border-b border-cyan-900/20 select-none"
      >
        {/* 左侧：窗口标题 */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400/60" />
          <span className="text-xs font-medium text-cyan-400/80 tracking-wide">
            AI Cue
          </span>
        </div>

        {/* 右侧：窗口控制按钮 */}
        <div className="flex items-center gap-1">
          {/* 设置按钮 */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-cyan-900/20 transition-colors duration-150"
            title="设置"
          >
            <Settings className="w-3.5 h-3.5 text-cyan-400/60" />
          </button>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-cyan-900/20 transition-colors duration-150"
            title="最小化"
          >
            <Minus className="w-3 h-3 text-cyan-400/60" />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-red-900/30 transition-colors duration-150"
            title="关闭"
          >
            <X className="w-3 h-3 text-cyan-400/60 hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* 消息列表区域 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-4"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-enter flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[90%] px-4 py-2.5 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-cyan-900/30 text-cyan-300 rounded-2xl rounded-br-md"
                  : "bg-slate-900/60 text-cyan-100/90 rounded-2xl rounded-bl-md"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        
        {/* 生成中指示器 */}
        {isGenerating && (
          <div className="message-enter flex justify-start">
            <div className="flex items-center gap-1 px-4 py-2.5 bg-slate-900/60 rounded-2xl rounded-bl-md">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="p-4 bg-slate-950 border-t border-cyan-900/20">
        <div className="relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，按 Enter 发送..."
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 bg-slate-900/50 text-cyan-100 text-sm placeholder:text-cyan-600/50 rounded-xl border border-cyan-900/20 resize-none scrollbar-hide glow-focus transition-all duration-150"
            style={{ lineHeight: "1.5" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="flex items-center justify-center w-10 h-10 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-cyan-400 rounded-xl border border-cyan-900/20 transition-all duration-150"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 text-[10px] text-cyan-600/40 text-center">
          Shift + Enter 换行 · Enter 发送
        </div>
      </div>

      {/* 设置面板 */}
      <SettingsPanel 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
}

export default App;
