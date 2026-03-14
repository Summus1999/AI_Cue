import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Minus, X, Settings, Mic, Square, Keyboard, Camera, ChevronDown } from "lucide-react";
import { SettingsPanel } from "./components/SettingsPanel";
import { ShortcutSettingsPanel } from "./components/ShortcutSettingsPanel";
import { MessageContent } from "./components/MessageContent";
import { invoke } from "@tauri-apps/api/core";
import { recognizeSpeech } from "./services/speechRecognition";
import {
  buildScreenshotFollowUpPrompt,
  SCREENSHOT_ANALYSIS_PROMPT,
  sendToQwenStream,
  sendToQwenStreamWithImage,
} from "./services/aiChat";
import { loadConfig } from "./store/config";
import { initializeShortcuts, setShortcutHandlers } from "./services/shortcutManager";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";

// 消息类型定义
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ScreenshotContext {
  imageBase64: string;
  debugPath: string;
  createdAt: number;
}

interface ScreenCaptureResult {
  source_path: string;
  screen_x: number;
  screen_y: number;
  logical_width: number;
  logical_height: number;
  physical_width: number;
  physical_height: number;
}

interface ScreenshotCompletePayload {
  imageData: number[];
  debugPath: string;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

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

  // 最近一次截图上下文
  const [latestScreenshotContext, setLatestScreenshotContext] = useState<ScreenshotContext | null>(null);
  
  // 当前视图：主界面 | 设置页面 | 快捷键设置
  const [currentView, setCurrentView] = useState<'main' | 'settings' | 'shortcuts'>('main');
  
  // 录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 滚动引用
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // 智能滚动控制：用户手动向上滚动时暂停自动滚动
  // 使用 ref 同步存储状态，避免 React 异步更新导致的竞态问题
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const scrollCooldownRef = useRef<number>(0); // 冷却时间戳
  
  // 同步更新 ref 和 state
  const updateAutoScroll = useCallback((enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled(enabled);
    // 禁用自动滚动时设置冷却时间（1秒内不自动恢复）
    if (!enabled) {
      scrollCooldownRef.current = Date.now() + 1000;
    }
  }, []);
  
  // 用于快捷键回调的函数引用
  const toggleRecordingRef = useRef<() => void>(() => {});
  const handleSendRef = useRef<() => void>(() => {});
  const handleScreenshotRef = useRef<() => void>(() => {});

  const updateAssistantMessage = useCallback((assistantId: string, content: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? { ...message, content } : message,
      ),
    );
  }, []);

  const appendAssistantChunk = useCallback((assistantId: string, content: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, content: message.content + content }
          : message,
      ),
    );
  }, []);

  const requestAssistantReply = useCallback(async (
    userContent: string,
    requestText: string,
    imageBase64?: string,
  ) => {
    const assistantId = generateId();
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: "user",
        content: userContent,
        timestamp: Date.now(),
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      },
    ]);

    setIsGenerating(true);

    try {
      const config = await loadConfig();
      let hasReceivedContent = false;

      const onChunk = (content: string, done: boolean) => {
        if (!done && content) {
          hasReceivedContent = true;
          appendAssistantChunk(assistantId, content);
        }
      };

      const send = async () => {
        if (imageBase64) {
          await sendToQwenStreamWithImage(requestText, imageBase64, config, onChunk);
          return;
        }
        await sendToQwenStream(requestText, config, onChunk);
      };

      try {
        await send();
      } catch (error) {
        if (imageBase64 && !hasReceivedContent) {
          updateAssistantMessage(assistantId, "");
          hasReceivedContent = false;
          try {
            await send();
            return;
          } catch (retryError) {
            updateAssistantMessage(
              assistantId,
              "❌ 图片识别失败: " + (retryError instanceof Error ? retryError.message : String(retryError)),
            );
            return;
          }
        }

        updateAssistantMessage(
          assistantId,
          (imageBase64 ? "❌ 图片识别失败: " : "❌ AI 回答失败: ") +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    } catch (error) {
      updateAssistantMessage(
        assistantId,
        (imageBase64 ? "❌ 图片识别失败: " : "❌ AI 回答失败: ") +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [appendAssistantChunk, updateAssistantMessage]);

  // 判断是否在底部附近
  const isNearBottom = useCallback((element: HTMLDivElement) => {
    const threshold = 100;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  }, []);

  // 处理滚动事件：滚动到底部时恢复自动滚动
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    
    // 冷却时间内不恢复自动滚动
    if (Date.now() < scrollCooldownRef.current) return;
    
    const nearBottom = isNearBottom(scrollRef.current);
    if (nearBottom && !autoScrollEnabledRef.current) {
      updateAutoScroll(true);
    }
  }, [isNearBottom, updateAutoScroll]);

  // 检测用户向上滚动：暂停自动滚动
  const handleWheel = useCallback((e: WheelEvent) => {
    // deltaY < 0 表示向上滚动
    if (e.deltaY < 0 && autoScrollEnabledRef.current) {
      updateAutoScroll(false);
    }
  }, [updateAutoScroll]);

  // 绑定 wheel 事件监听器
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.addEventListener('wheel', handleWheel);
      return () => scrollElement.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // 自动滚动到底部（使用 ref 检查，避免竞态）
  useEffect(() => {
    if (scrollRef.current && autoScrollEnabledRef.current) {
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
          takeScreenshot: () => handleScreenshotRef.current(),
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
    setInput("");
    const imageBase64 = latestScreenshotContext?.imageBase64;
    const requestText = imageBase64
      ? buildScreenshotFollowUpPrompt(question)
      : question;

    await requestAssistantReply(question, requestText, imageBase64);
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
            setMessages((prev) => prev.slice(0, -1));
            const imageBase64 = latestScreenshotContext?.imageBase64;
            const requestText = imageBase64
              ? buildScreenshotFollowUpPrompt(text)
              : text;

            await requestAssistantReply(`🎤 ${text}`, requestText, imageBase64);
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

  // 截图功能
  const handleScreenshot = async () => {
    if (isRecording || isGenerating) return;
    
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const mainWindow = getCurrentWindow();
    const existingScreenshotWindow = await WebviewWindow.getByLabel("screenshot");
    let activeSourcePath: string | null = null;
    let cleanupListeners = () => {};

    const restoreMainWindow = async () => {
      await mainWindow.show();
      await mainWindow.setFocus();
    };
    
    try {
      if (existingScreenshotWindow) {
        await existingScreenshotWindow.close();
      }

      await mainWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const capture = await invoke<ScreenCaptureResult>('capture_full_screen');
      activeSourcePath = capture.source_path;
      const cleanupCallbacks: Array<() => void> = [];
      cleanupListeners = () => {
        cleanupCallbacks.forEach((callback) => callback());
        cleanupCallbacks.length = 0;
      };

      const unlistenComplete = await listen<ScreenshotCompletePayload>('screenshot-complete', (event) => {
        cleanupListeners();
        void (async () => {
          try {
            await restoreMainWindow();

            const bytes = new Uint8Array(event.payload.imageData);
            const imageBase64 = bytesToBase64(bytes);
            setLatestScreenshotContext({
              imageBase64,
              debugPath: event.payload.debugPath,
              createdAt: Date.now(),
            });
            await requestAssistantReply("📷 [已发送截图]", SCREENSHOT_ANALYSIS_PROMPT, imageBase64);
          } catch (error) {
            await restoreMainWindow();
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "assistant",
                content: "❌ 截图识别失败: " + (error instanceof Error ? error.message : String(error)),
                timestamp: Date.now(),
              },
            ]);
          }
        })();
      });
      cleanupCallbacks.push(unlistenComplete);

      const unlistenCancel = await listen('screenshot-cancelled', () => {
        cleanupListeners();
        void restoreMainWindow();
      });
      cleanupCallbacks.push(unlistenCancel);

      const screenshotUrl = `/screenshot.html?sourcePath=${encodeURIComponent(capture.source_path)}&logicalWidth=${capture.logical_width}&logicalHeight=${capture.logical_height}&physicalWidth=${capture.physical_width}&physicalHeight=${capture.physical_height}`;

      new WebviewWindow('screenshot', {
        url: screenshotUrl,
        x: capture.screen_x,
        y: capture.screen_y,
        width: capture.logical_width,
        height: capture.logical_height,
        decorations: false,
        transparent: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: true,
        resizable: false,
      });
    } catch (err) {
      cleanupListeners();
      if (activeSourcePath) {
        try {
          await invoke("cancel_screenshot", { sourcePath: activeSourcePath });
        } catch {
          // Ignore cleanup failure.
        }
      }
      try {
        await restoreMainWindow();
      } catch {
        // Ignore restore failure.
      }

      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: "❌ 截图失败: " + (err instanceof Error ? err.message : String(err)),
          timestamp: Date.now(),
        },
      ]);
    }
  };

  // 更新快捷键回调的函数引用
  useEffect(() => {
    toggleRecordingRef.current = toggleRecording;
    handleSendRef.current = handleSend;
    handleScreenshotRef.current = handleScreenshot;
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
        onScroll={handleScroll}
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
              <MessageContent
                content={message.content}
                variant={message.role}
              />
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

      {/* 滚动到底部提示按钮 - 仅在自动滚动被暂停且正在生成时显示 */}
      {!autoScrollEnabled && isGenerating && (
        <button
          onClick={() => {
            updateAutoScroll(true);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
          className="absolute bottom-28 right-4 flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-full text-xs shadow-lg transition-colors z-40"
        >
          <ChevronDown className="w-3 h-3" />
          滚动到底部
        </button>
      )}

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
          {/* 截图按钮 */}
          <button
            onClick={handleScreenshot}
            disabled={isRecording || isGenerating}
            className="flex items-center justify-center w-10 h-10 bg-amber-100 hover:bg-amber-200 disabled:opacity-30 disabled:cursor-not-allowed text-amber-700 rounded-xl border border-amber-300 transition-all duration-150"
            title="区域截图"
          >
            <Camera className="w-4 h-4" />
          </button>
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
            "Shift + Enter 换行 · Enter 发送 · 🎤 录音 · 📷 截图"
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
