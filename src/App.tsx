import { useState, useRef, useEffect } from "react";
import { Send, Minus, X, Settings, Mic, Square, Keyboard } from "lucide-react";
import { SettingsPanel } from "./components/SettingsPanel";
import { ShortcutSettingsPanel } from "./components/ShortcutSettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import { recognizeSpeech } from "./services/speechRecognition";
import { sendToQwenStream } from "./services/aiChat";
import { loadConfig } from "./store/config";
import { initializeShortcuts, setShortcutHandlers } from "./services/shortcutManager";

// 消息类型定义
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// 获取语音识别错误的友好提示
function getSpeechErrorMessage(error: unknown): string {
  const errStr = String(error);
  // 没有录到有效音频
  if (errStr.includes("NO_VALID_AUDIO_ERROR") || errStr.includes("NO_VALID_AUDIO")) {
    return "抱歉，我没有听清楚，请再试一次";
  }
  // 音频太短
  if (errStr.includes("AUDIO_TOO_SHORT") || errStr.includes("TOO_SHORT")) {
    return "录音时间太短了，请多说一些";
  }
  // 音频质量问题
  if (errStr.includes("AUDIO_QUALITY") || errStr.includes("QUALITY")) {
    return "音频质量不太好，请调整麦克风或环境后重试";
  }
  // 默认错误
  return "语音识别出现问题，请检查麦克风后重试";
}

function App() {
  // 消息列表状态
  const [messages, setMessages] = useState<Message[]>([
    {
      id: generateId(),
      role: "assistant",
      content: "你好，我是你的面试助手。输入面试官的问题，我会帮你生成回答要点。\n\n点击 🎤 按钮可以录制电脑播放的音频。",
      timestamp: Date.now(),
    },
  ]);
  
  // 输入框状态
  const [input, setInput] = useState("");
  
  // 是否正在生成回复
  const [isGenerating, setIsGenerating] = useState(false);
  
  // 当前视图：主界面 | 设置页面 | 快捷键设置
  const [currentView, setCurrentView] = useState<'main' | 'settings' | 'shortcuts'>('main');
  
  // 录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 滚动引用
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // 用于快捷键回调的函数引用
  const toggleRecordingRef = useRef<() => void>(() => {});
  const handleSendRef = useRef<() => void>(() => {});

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 录音状态轮询
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 0.1);
      }, 100);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecordingDuration(0);
    }
    
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording]);

  // 初始化快捷键
  useEffect(() => {
    const initShortcuts = async () => {
      try {
        // 设置快捷键处理器
        setShortcutHandlers({
          toggleRecording: () => toggleRecordingRef.current(),
          sendMessage: () => handleSendRef.current(),
        });
        
        const config = await loadConfig();
        await initializeShortcuts(config.shortcutConfig);
        console.log('快捷键初始化完成');
      } catch (err) {
        console.error('快捷键初始化失败:', err);
      }
    };
    initShortcuts();
  }, []);

  // 发送消息并调用 AI 生成回答
  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    const question = input.trim();
    
    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: question,
      timestamp: Date.now(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsGenerating(true);

    try {
      const config = await loadConfig();
      
      // 创建 AI 消息占位
      const assistantId = generateId();
      setMessages((prev) => [...prev, {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      }]);

      // 流式接收 AI 回答
      await sendToQwenStream(question, config, (content, done) => {
        if (!done && content) {
          setMessages((prev) => prev.map(msg => 
            msg.id === assistantId 
              ? { ...msg, content: msg.content + content }
              : msg
          ));
        }
        if (done) {
          setIsGenerating(false);
        }
      });
    } catch (err) {
      const errorMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: "❌ AI 回答失败: " + (err instanceof Error ? err.message : String(err)),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 开始/停止录音
  const toggleRecording = async () => {
    if (isRecording) {
      // 停止录音
      try {
        const wavData: number[] = await invoke("stop_audio_recording");
        setIsRecording(false);
        
        // 将 number[] 转换为 Uint8Array
        const audioData = new Uint8Array(wavData);
        
        // 添加系统消息
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "assistant",
          content: `🎤 录音完成！音频大小: ${(audioData.length / 1024).toFixed(1)}KB\n\n正在识别语音...`,
          timestamp: Date.now(),
        }]);

        try {
          const config = await loadConfig();
          const text = await recognizeSpeech(audioData, config);
          if (text.trim()) {
            // 显示识别结果并自动调用 AI
            setMessages(prev => prev.slice(0, -1).concat([{
              id: generateId(),
              role: "user",
              content: `🎤 ${text}`,
              timestamp: Date.now(),
            }]));
            
            // 自动调用千问 AI 生成回答
            setIsGenerating(true);
            try {
              // 创建 AI 消息占位
              const assistantId = generateId();
              setMessages(prev => [...prev, {
                id: assistantId,
                role: "assistant",
                content: "",
                timestamp: Date.now(),
              }]);

              // 流式接收 AI 回答
              await sendToQwenStream(text, config, (content, done) => {
                if (!done && content) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantId 
                      ? { ...msg, content: msg.content + content }
                      : msg
                  ));
                }
                if (done) {
                  setIsGenerating(false);
                }
              });
            } catch (aiErr) {
              setMessages(prev => [...prev, {
                id: generateId(),
                role: "assistant",
                content: "❌ AI 回答失败: " + (aiErr instanceof Error ? aiErr.message : String(aiErr)),
                timestamp: Date.now(),
              }]);
            } finally {
              setIsGenerating(false);
            }
          } else {
            setMessages(prev => prev.slice(0, -1).concat([{
              id: generateId(),
              role: "assistant",
              content: "未识别到有效语音，请重试",
              timestamp: Date.now(),
            }]));
          }
        } catch (err) {
          setMessages(prev => prev.slice(0, -1).concat([{
            id: generateId(),
            role: "assistant",
            content: getSpeechErrorMessage(err),
            timestamp: Date.now(),
          }]));
        }
        
      } catch (err) {
        console.error("停止录音失败:", err);
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "assistant",
          content: "❌ 录音失败: " + String(err),
          timestamp: Date.now(),
        }]);
        setIsRecording(false);
      }
    } else {
      // 开始录音
      try {
        await invoke("start_audio_recording");
        setIsRecording(true);
        
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "assistant",
          content: "🎤 正在聆听电脑音频...\n再次点击 🎤 停止录音",
          timestamp: Date.now(),
        }]);
        
      } catch (err) {
        console.error("开始录音失败:", err);
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "assistant",
          content: "❌ 无法开始录音: " + String(err),
          timestamp: Date.now(),
        }]);
      }
    }
  };

  // 更新快捷键回调的函数引用
  useEffect(() => {
    toggleRecordingRef.current = toggleRecording;
    handleSendRef.current = handleSend;
  });

  // 最小化窗口
  const handleMinimize = () => {};

  // 关闭窗口
  const handleClose = () => {};

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="relative flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      {/* 自定义标题栏 - 支持拖拽 */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-10 px-4 bg-amber-100/80 border-b border-amber-200 select-none"
      >
        {/* 左侧：窗口标题 */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-amber-600/60'}`} />
          <span className="text-xs font-medium text-amber-800 tracking-wide">
            AI Cue
          </span>
          {isRecording && (
            <span className="text-xs text-red-400 font-mono ml-2">
              ● {formatDuration(recordingDuration)}
            </span>
          )}
        </div>

        {/* 右侧：窗口控制按钮 */}
        <div className="flex items-center gap-1">
          {/* 快捷键设置按钮 */}
          <button
            onClick={() => setCurrentView('shortcuts')}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="快捷键设置"
          >
            <Keyboard className="w-3.5 h-3.5 text-amber-700" />
          </button>
          {/* 设置按钮 */}
          <button
            onClick={() => setCurrentView('settings')}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="设置"
          >
            <Settings className="w-3.5 h-3.5 text-amber-700" />
          </button>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="最小化"
          >
            <Minus className="w-3 h-3 text-amber-700" />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-red-900/30 transition-colors duration-150"
            title="关闭"
          >
            <X className="w-3 h-3 text-amber-700 hover:text-red-500" />
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
                  ? "bg-amber-200/60 text-amber-900 rounded-2xl rounded-br-md"
                  : "bg-amber-800 text-amber-50 rounded-2xl rounded-bl-md"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        
        {/* 生成中指示器 */}
        {isGenerating && (
          <div className="message-enter flex justify-start">
            <div className="flex items-center gap-1 px-4 py-2.5 bg-amber-800 rounded-2xl rounded-bl-md">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="p-4 bg-amber-100/50 border-t border-amber-200">
        <div className="relative flex items-end gap-2">
          {/* 语音输入按钮 */}
          <button
            onClick={toggleRecording}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-150 ${
              isRecording
                ? 'bg-red-100 text-red-500 border-red-300 animate-pulse'
                : 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200 hover:text-amber-800'
            }`}
            title={isRecording ? "停止录音" : "语音输入（录制电脑音频）"}
          >
            {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? "正在录音..." : "输入问题，按 Enter 发送..."}
            rows={1}
            disabled={isRecording}
            className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 bg-white/80 text-amber-900 text-sm placeholder:text-amber-400 rounded-xl border border-amber-300 resize-none scrollbar-hide glow-focus transition-all duration-150 disabled:opacity-50"
            style={{ lineHeight: "1.5" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating || isRecording}
            className="flex items-center justify-center w-10 h-10 bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl border border-amber-700 transition-all duration-150"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 text-[10px] text-amber-600 text-center">
          {isRecording ? (
            <span className="text-red-400/60">正在录制电脑音频... 点击 🎤 停止</span>
          ) : (
            "Shift + Enter 换行 · Enter 发送 · 🎤 录制电脑音频"
          )}
        </div>
      </div>

      {/* 设置页面 - 全页面覆盖 */}
      {currentView === 'settings' && (
        <div className="absolute inset-0 z-50">
          <SettingsPanel
            isOpen={true}
            onClose={() => setCurrentView('main')}
          />
        </div>
      )}

      {/* 快捷键设置页面 - 全页面覆盖 */}
      {currentView === 'shortcuts' && (
        <div className="absolute inset-0 z-50">
          <ShortcutSettingsPanel
            isOpen={true}
            onClose={() => setCurrentView('main')}
          />
        </div>
      )}
    </div>
  );
}

export default App;
