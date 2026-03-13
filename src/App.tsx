import { useState, useRef, useEffect } from "react";
import { Send, Minus, X, Settings, Mic, Square } from "lucide-react";
import { SettingsPanel } from "./components/SettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import { recognizeSpeech } from "./services/speechRecognition";
import { sendToQwen } from "./services/aiChat";
import { loadConfig } from "./store/config";

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
      content: "你好，我是你的面试助手。输入面试官的问题，我会帮你生成回答要点。\n\n点击 🎤 按钮可以录制电脑播放的音频。",
      timestamp: Date.now(),
    },
  ]);
  
  // 输入框状态
  const [input, setInput] = useState("");
  
  // 是否正在生成回复
  const [isGenerating, setIsGenerating] = useState(false);
  
  // 设置面板开关状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // 录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 滚动引用
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const answer = await sendToQwen(question, config);
      
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: answer,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
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
              const answer = await sendToQwen(text, config);
              setMessages(prev => [...prev, {
                id: generateId(),
                role: "assistant",
                content: answer,
                timestamp: Date.now(),
              }]);
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
            content: "❌ 语音识别失败: " + String(err),
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
    <div className="relative flex flex-col w-full h-full bg-slate-950 text-cyan-400 overflow-hidden rounded-2xl">
      {/* 自定义标题栏 - 支持拖拽 */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-10 px-4 bg-slate-950/80 border-b border-cyan-900/20 select-none"
      >
        {/* 左侧：窗口标题 */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-cyan-400/60'}`} />
          <span className="text-xs font-medium text-cyan-400/80 tracking-wide">
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
          {/* 语音输入按钮 */}
          <button
            onClick={toggleRecording}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-150 ${
              isRecording
                ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                : 'bg-slate-800/50 text-cyan-400/60 border-cyan-900/20 hover:bg-cyan-900/20 hover:text-cyan-400'
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
            className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 bg-slate-900/50 text-cyan-100 text-sm placeholder:text-cyan-600/50 rounded-xl border border-cyan-900/20 resize-none scrollbar-hide glow-focus transition-all duration-150 disabled:opacity-50"
            style={{ lineHeight: "1.5" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating || isRecording}
            className="flex items-center justify-center w-10 h-10 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-cyan-400 rounded-xl border border-cyan-900/20 transition-all duration-150"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 text-[10px] text-cyan-600/40 text-center">
          {isRecording ? (
            <span className="text-red-400/60">正在录制电脑音频... 点击 🎤 停止</span>
          ) : (
            "Shift + Enter 换行 · Enter 发送 · 🎤 录制电脑音频"
          )}
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
