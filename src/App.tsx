import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Minus, X, Settings, Mic, Square, Keyboard, Camera, ChevronDown, Plus, History, Download, StopCircle, PlayCircle } from "lucide-react";
import { SettingsPanel } from "./components/SettingsPanel";
import { ShortcutSettingsPanel } from "./components/ShortcutSettingsPanel";
import SessionList from "./components/SessionList";
import CompactView from "./components/CompactView";
import { MessageContent } from "./components/MessageContent";
import { ExportDialog } from "./components/export/ExportDialog";
import { ReviewDialog } from "./components/review/ReviewDialog";
import { NetworkStatusIndicator } from "./components/NetworkStatusIndicator";
import { FriendlyErrorCard } from "./components/FriendlyErrorCard";
import { invoke } from "@tauri-apps/api/core";
import { recognizeSpeech, getSpeechErrorMessage } from "./services/speechRecognition";
import {
  buildScreenshotFollowUpPrompt,
  SCREENSHOT_ANALYSIS_PROMPT,
  sendToQwenStreamWithImage,
  sendStream,
  buildContextHistory,
  StreamResult,
} from "./services/aiChat";
import { loadConfig, PromptMode, getPromptMode } from "./store/config";
import { initializeShortcuts, setShortcutHandlers } from "./services/shortcutManager";
import { initWindowOpacity, enableHoverRestore, cleanupHoverRestore, togglePassthrough, cleanupPassthrough, toggleCompactMode, initCompactMode, setCompactMode } from './services/windowManager';
import { restoreWindowBounds, saveWindowBounds } from './services/windowManager';
import { saveMessage, updateSessionTitle, getLastActiveSession, getSessionMessages, listSessions, deleteSession, searchSessions, endInterview, Session } from './services/sessionManager';
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { errorClassifier } from './services/errorClassifier';
import { useNetworkResilience, getWaitingHint } from './store/networkResilience';
import { useCodeEditor } from './store/codeEditor';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { codeDetector } from './services/codeDetector';

// 消息类型定义
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** 新增：消息是否完整生成 */
  isComplete?: boolean;
  /** 新增：中断原因 */
  interruptReason?: 'user_abort' | 'error' | 'timeout' | 'network';
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

// 注意：getSpeechErrorMessage 现在从 speechRecognition.ts 导入

// 将 finishReason 转换为 interruptReason
function getInterruptReason(finishReason?: string): Message['interruptReason'] {
  if (!finishReason) return 'error';
  if (finishReason === 'timeout') return 'timeout';
  if (finishReason === 'interrupted') return 'network';
  if (finishReason === 'error') return 'error';
  return undefined;
}

function App() {
  // 网络韧性状态管理
  const networkResilience = useNetworkResilience();
  
  // 代码编辑器状态
  const codeEditor = useCodeEditor();

  // 穿透模式状态
  const [passthroughActive, setPassthroughActive] = useState(false);

  // 紧凑模式状态
  const [compactMode, setCompactModeState] = useState(false);

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
  
  // 当前会话 ID（延迟创建：首次发送消息时才创建）
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // 当前视图：主界面 | 设置页面 | 快捷键设置
  const [currentView, setCurrentView] = useState<'main' | 'settings' | 'shortcuts' | 'sessions'>('main');
  
  // 会话列表状态
  const [sessions, setSessions] = useState<Session[]>([]);
  
  // 导出对话框状态
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  
  // 复盘对话框状态
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewSessionTitle, setReviewSessionTitle] = useState('');
  
  // 面试状态
  const [isInterviewStarted, setIsInterviewStarted] = useState(false);
  const [isInterviewEnded, setIsInterviewEnded] = useState(false);
  
  // Prompt 模式状态
  const [promptMode, setPromptMode] = useState<PromptMode>('assistant');
  
  // 会话恢复/切换时间戳（用于上下文隔离）
  const [sessionResumeTimestamp, setSessionResumeTimestamp] = useState<number>(Date.now());
  
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
    // 在添加新消息之前，先捕获当前消息列表用于构建上下文历史
    const currentMessages = [...messages];

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
        isComplete: false, // 初始状态为未完成
      },
    ]);

    setIsGenerating(true);
    networkResilience.setWaiting(assistantId);

    // 捕获当前会话 ID，处理闭包问题
    let sessionId = currentSessionId;
    let isNewSession = false;

    // 保存用户消息到数据库（延迟创建会话）
    try {
      if (!sessionId) {
        // 创建新会话时传递 promptMode
        const newSession = await invoke<{ id: string }>('create_session', {
          metadata: {
            prompt_mode: promptMode,
          },
        });
        sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        isNewSession = true;
      }
      await saveMessage(sessionId, 'user', userContent, imageBase64);
      // 如果是新会话，用用户消息的前 20 个字符作为标题
      if (isNewSession) {
        await updateSessionTitle(sessionId, userContent.slice(0, 20));
      }
    } catch (dbError) {
      console.error('Failed to save user message:', dbError);
    }

    // 用于收集完整的 AI 回复
    let fullAssistantContent = '';

    try {
      const config = await loadConfig();
      let hasReceivedContent = false;

      const onChunk = (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => {
        if (!done && content) {
          hasReceivedContent = true;
          fullAssistantContent += content;
          appendAssistantChunk(assistantId, content);
        }
        // AI 回复完成时保存到数据库
        if (done) {
          // 更新消息完成状态
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    isComplete: isComplete ?? true,
                    interruptReason: isComplete ? undefined : getInterruptReason(finishReason),
                  }
                : msg
            )
          );
          // 面试官模式下自动开始面试
          if (promptMode === 'interviewer' && !isInterviewStarted) {
            setIsInterviewStarted(true);
          }
          // 保存到数据库
          if (sessionId && fullAssistantContent) {
            saveMessage(sessionId, 'assistant', fullAssistantContent).catch((err) => {
              console.error('Failed to save assistant message:', err);
            });
          }
          // 检测代码模式（自动展开编辑器）
          if (isComplete && codeEditor.codeModeAutoDetect && fullAssistantContent) {
            const detection = codeDetector.detect(fullAssistantContent);
            if (detection.suggestion === 'code_mode' && detection.codeBlocks.length > 0) {
              codeEditor.setShowEditor(true);
              // 预填充第一个代码块
              const firstBlock = detection.codeBlocks[0];
              codeEditor.insertCode(firstBlock.content, firstBlock.language, 'replace');
            }
          }
        }
      };

      // 构建上下文历史（只取本次打开/切换后的消息用于上下文）
      const recentMessages = currentMessages.filter(m => m.timestamp >= sessionResumeTimestamp);
      const contextHistory = buildContextHistory(
        recentMessages,
        config.contextWindowSize ?? 5,
      );

      const send = async () => {
        if (imageBase64) {
          // 截图识别仍使用千问专用接口
          await sendToQwenStreamWithImage(requestText, imageBase64, config, onChunk);
          return { isComplete: true } as StreamResult;
        }
        // 使用新的统一流式接口，传递上下文历史
        return sendStream(requestText, config, onChunk, contextHistory);
      };

      try {
        await send();
      } catch (error) {
        // 分类错误并显示友好提示
        const friendlyError = errorClassifier.classify(
          error instanceof Error ? error.message : String(error)
        );
        networkResilience.setError(assistantId, friendlyError);

        if (imageBase64 && !hasReceivedContent) {
          updateAssistantMessage(assistantId, "");
          fullAssistantContent = '';
          hasReceivedContent = false;
          try {
            await send();
            networkResilience.clearError(assistantId);
            return;
          } catch (retryError) {
            const retryFriendlyError = errorClassifier.classify(
              retryError instanceof Error ? retryError.message : String(retryError)
            );
            networkResilience.setError(assistantId, retryFriendlyError);
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
            friendlyError.message,
        );
      }
    } catch (error) {
      const friendlyError = errorClassifier.classify(
        error instanceof Error ? error.message : String(error)
      );
      networkResilience.setError(assistantId, friendlyError);
      updateAssistantMessage(
        assistantId,
        (imageBase64 ? "❌ 图片识别失败: " : "❌ AI 回答失败: ") +
          friendlyError.message,
      );
    } finally {
      setIsGenerating(false);
      networkResilience.setWaiting(null);
    }
  }, [appendAssistantChunk, updateAssistantMessage, currentSessionId, networkResilience, codeEditor]);

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

  // 启动时恢复上次会话
  useEffect(() => {
    async function restoreLastSession() {
      try {
        // 先加载 config 获取 promptMode
        const config = await loadConfig();
        const mode = getPromptMode(config);
        setPromptMode(mode);
        
        // 根据当前模式获取最近活跃会话
        const lastSession = await getLastActiveSession(mode);
        if (lastSession) {
          const msgs = await getSessionMessages(lastSession.id);
          setMessages(msgs.map(m => ({
            id: generateId(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.created_at || Date.now(),
          })));
          setCurrentSessionId(lastSession.id);
          // 记录恢复时间戳（用于上下文隔离）
          setSessionResumeTimestamp(Date.now());
          // 默认为"面试未开始"状态，每次打开应用都重置
          setIsInterviewStarted(false);
          setIsInterviewEnded(false);
        }
      } catch (error) {
        console.error('Failed to restore last session:', error);
      }
    }
    restoreLastSession();
  }, []);

  // 启动时恢复窗口透明度和悬停恢复功能
  useEffect(() => {
    async function restoreWindowOpacity() {
      try {
        const config = await loadConfig();
        // 同步更新 promptMode
        setPromptMode(getPromptMode(config));
        if (config.window?.opacity) {
          await initWindowOpacity(config.window.opacity);
        }
        // 初始化悬停恢复功能
        if (config.window?.hoverRestore?.enabled) {
          enableHoverRestore(true, config.window.opacity ?? 0.8);
        }
        // 恢复紧凑模式状态
        if (config.window?.compactMode?.enabled) {
          initCompactMode(true);
          setCompactModeState(true);
        }
      } catch (error) {
        console.error('Failed to restore window opacity:', error);
      }
    }
    restoreWindowOpacity();
    
    // 组件卸载时清理悬停恢复资源和穿透模式
    return () => {
      cleanupHoverRestore();
      cleanupPassthrough();
    };
  }, []);

  // 紧凑模式切换处理函数
  const handleToggleCompactMode = async () => {
    const newState = await toggleCompactMode();
    setCompactModeState(newState);
  };

  // 初始化快捷键
  useEffect(() => {
    const initShortcuts = async () => {
      try {
        // 设置快捷键处理器
        setShortcutHandlers({
          toggleRecording: () => toggleRecordingRef.current(),
          sendMessage: () => handleSendRef.current(),
          takeScreenshot: () => handleScreenshotRef.current(),
          togglePassthrough: async () => {
            const newState = await togglePassthrough();
            setPassthroughActive(newState);
          },
          toggleCompactMode: handleToggleCompactMode,
        });
        
        const config = await loadConfig();
        await initializeShortcuts(config.shortcutConfig);
        console.log('快捷键初始化完成');
        
        // 恢复窗口位置
        const mode = config.window?.compactMode?.enabled ? 'compact' : 'main';
        restoreWindowBounds(mode);
      } catch (err) {
        console.error('快捷键初始化失败:', err);
      }
    };
    initShortcuts();
  }, []);

  // 注册窗口移动/缩放事件，保存窗口位置
  useEffect(() => {
    const mainWindow = getCurrentWindow();
    
    const unlistenMove = mainWindow.onMoved(() => {
      saveWindowBounds(); // 根据 compactMode 状态自动传入正确的 mode
    });
    
    const unlistenResize = mainWindow.onResized(() => {
      saveWindowBounds();
    });
    
    return () => {
      unlistenMove.then(fn => fn());
      unlistenResize.then(fn => fn());
    };
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

  // 新建会话（清空消息并重置会话 ID，延迟创建）
  const handleClear = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setLatestScreenshotContext(null);
    setIsInterviewStarted(false);
    setIsInterviewEnded(false);
  };

  // 获取最新 AI 回答（用于紧凑模式显示）
  const latestAIMessage = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    // 从后往前找最新的 AI 消息
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i].content;
      }
    }
    return null;
  }, [messages]);

  // 打开会话列表（按当前模式筛选）
  const handleOpenSessions = async () => {
    try {
      const sessionList = await listSessions(promptMode);
      setSessions(sessionList);
      setCurrentView('sessions');
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  // 打开导出对话框
  const handleOpenExport = () => {
    if (currentSessionId && messages.length > 0) {
      setExportDialogOpen(true);
    }
  };

  // 关闭导出对话框
  const handleCloseExport = () => {
    setExportDialogOpen(false);
  };

  // 处理复盘
  const handleReview = (sessionId: string, sessionTitle: string) => {
    setReviewSessionId(sessionId);
    setReviewSessionTitle(sessionTitle);
    setReviewDialogOpen(true);
  };

  // 结束面试
  const handleEndInterview = async () => {
    if (promptMode !== 'interviewer') return;
    if (!currentSessionId || isGenerating) return;
    
    try {
      const completedAt = await endInterview(currentSessionId);
      
      // 更新本地 sessions 列表中的 completed_at
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? { ...s, completed_at: completedAt } : s
      ));
      
      // 设置面试结束状态
      setIsInterviewEnded(true);
      
      // 自动弹出复盘对话框
      const currentSession = sessions.find(s => s.id === currentSessionId);
      handleReview(currentSessionId, currentSession?.title || '当前会话');
    } catch (error) {
      console.error('结束面试失败:', error);
    }
  };

  // 关闭复盘对话框
  const handleCloseReview = () => {
    setReviewDialogOpen(false);
    setReviewSessionId(null);
    setReviewSessionTitle('');
  };

  // 打开设置页面（紧凑模式下自动切换回完整模式）
  const handleOpenSettings = async () => {
    if (compactMode) {
      await setCompactMode(false);
      setCompactModeState(false);
    }
    setCurrentView('settings');
  };

  // 打开快捷键设置（紧凑模式下自动切换回完整模式）
  const handleOpenShortcuts = async () => {
    if (compactMode) {
      await setCompactMode(false);
      setCompactModeState(false);
    }
    setCurrentView('shortcuts');
  };

  // 选择会话
  const handleSelectSession = async (session: Session) => {
    try {
      const msgs = await getSessionMessages(session.id);
      setMessages(msgs.map(m => ({
        id: generateId(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.created_at || Date.now(),
      })));
      setCurrentSessionId(session.id);
      // 同步 promptMode 到该会话的模式
      setPromptMode((session.prompt_mode as PromptMode) || 'assistant');
      // 记录切换时间戳（用于上下文隔离）
      setSessionResumeTimestamp(Date.now());
      // 默认为"面试未开始"状态
      setIsInterviewStarted(false);
      setIsInterviewEnded(false);
      setCurrentView('main');
    } catch (error) {
      console.error('Failed to load session messages:', error);
    }
  };

  // 删除会话
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      // 刷新列表（按当前模式筛选）
      const sessionList = await listSessions(promptMode);
      setSessions(sessionList);
      // 如果删的是当前活跃会话，重置
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  // 搜索会话（按当前模式筛选）
  const handleSearchSessions = async (keyword: string) => {
    try {
      if (keyword.trim()) {
        const results = await searchSessions(keyword, promptMode);
        setSessions(results);
      } else {
        const sessionList = await listSessions(promptMode);
        setSessions(sessionList);
      }
    } catch (error) {
      console.error('Failed to search sessions:', error);
    }
  };

  // 新建会话（从会话列表触发）
  const handleNewSessionFromList = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setLatestScreenshotContext(null);
    setIsInterviewStarted(false);
    setIsInterviewEnded(false);
    // 记录新建时间戳（用于上下文隔离）
    setSessionResumeTimestamp(Date.now());
    setCurrentView('main');
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
          const recognizingMsgId = messages[messages.length - 1]?.id || generateId();

          const text = await recognizeSpeech(audioData, config, {
            onRetry: (state) => {
              if (state.isRetrying) {
                setMessages(prev => prev.map(m =>
                  m.id === recognizingMsgId
                    ? {
                        ...m,
                        content: `🎤 识别失败，正在重试 (${state.attempt}/3)...\n${state.lastError || ''}`,
                      }
                    : m
                ));
              }
            },
          });

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

  // 继续生成功能
  const handleContinueGeneration = useCallback(async (messageId: string) => {
    const targetMessage = messages.find(m => m.id === messageId);
    if (!targetMessage || targetMessage.role !== 'assistant') return;

    const messageIndex = messages.findIndex(m => m.id === messageId);
    const historyMessages = messages.slice(0, messageIndex);

    setIsGenerating(true);
    networkResilience.setWaiting(messageId);

    try {
      const config = await loadConfig();

      // 构建续接 prompt
      const continuePrompt = buildContinuePrompt(targetMessage.content, historyMessages, 5);

      let continuedContent = '';

      await sendStream(continuePrompt, config, (content, done, isComplete) => {
        if (!done && content) {
          continuedContent += content;
          setMessages(prev => prev.map(m =>
            m.id === messageId
              ? { ...m, content: m.content + content }
              : m
          ));
        }
        if (done) {
          setMessages(prev => prev.map(m =>
            m.id === messageId
              ? { ...m, isComplete: isComplete ?? true, interruptReason: undefined }
              : m
          ));
          // 保存续接内容到数据库
          if (currentSessionId && continuedContent) {
            const finalContent = targetMessage.content + continuedContent;
            saveMessage(currentSessionId, 'assistant', finalContent).catch(console.error);
          }
        }
      }, buildContextHistory(historyMessages, config.contextWindowSize ?? 5));

    } catch (error) {
      console.error('Continue generation failed:', error);
      const friendlyError = errorClassifier.classify(
        error instanceof Error ? error.message : String(error)
      );
      networkResilience.setError(messageId, friendlyError);
    } finally {
      setIsGenerating(false);
      networkResilience.setWaiting(null);
    }
  }, [messages, currentSessionId, networkResilience]);

  // 构建续接 prompt
  const buildContinuePrompt = (
    lastContent: string,
    history: Message[],
    contextSize: number = 5
  ): string => {
    const contextMessages = history.slice(-(contextSize * 2)).map(m =>
      `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 500)}`
    ).join('\n---\n');

    return `这是之前的对话历史：\n${contextMessages}\n\n你的回答在这里中断了：\n"${lastContent.slice(-500)}"\n\n请继续完成这个回答，不要重复已说内容。`;
  };

  // 重试消息功能
  const handleRetryMessage = useCallback(async (messageId: string) => {
    // 找到对应的用户消息（在当前 assistant 消息之前）
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex <= 0) return;

    // 向前查找用户消息
    let userMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }
    if (userMessageIndex === -1) return;

    const userMessage = messages[userMessageIndex];

    // 清除错误状态
    networkResilience.clearError(messageId);

    // 更新 assistant 消息为初始状态
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, content: '', isComplete: false, interruptReason: undefined }
        : m
    ));

    // 重新发送请求
    await requestAssistantReply(
      userMessage.content,
      userMessage.content,
      undefined
    );
  }, [messages, networkResilience, requestAssistantReply]);

  // 最小化窗口
  const handleMinimize = () => {};

  // 关闭窗口
  const handleClose = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const mainWindow = getCurrentWindow();
    await mainWindow.close();
  };

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // 紧凑模式渲染
  if (compactMode && currentView === 'main') {
    return (
      <div className="relative flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
        <CompactView
          latestAIMessage={latestAIMessage}
          isStreaming={isGenerating}
          onExpand={handleToggleCompactMode}
          onClose={handleClose}
          passthroughActive={passthroughActive}
          onTogglePassthrough={async () => {
            const newState = await togglePassthrough();
            setPassthroughActive(newState);
          }}
        />
      </div>
    );
  }

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
          {/* 网络状态指示灯 */}
          <NetworkStatusIndicator className="ml-1" />
          {isRecording && (
            <span className="text-xs text-red-400 font-mono ml-2">
              ● {formatDuration(recordingDuration)}
            </span>
          )}
        </div>

        {/* 右侧：窗口控制按钮 */}
        <div className="flex items-center gap-1">
          {/* 新建会话按钮 */}
          <button
            onClick={handleClear}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="新建会话"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700" />
          </button>
          {/* 会话历史按钮 */}
          <button
            onClick={handleOpenSessions}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="会话历史"
          >
            <History className="w-3.5 h-3.5 text-amber-700" />
          </button>
          {/* 导出按钮 */}
          <button
            onClick={handleOpenExport}
            disabled={!currentSessionId || messages.length === 0}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
            title="导出当前会话"
          >
            <Download className="w-3.5 h-3.5 text-amber-700" />
          </button>
          {/* 面试官模式：开始面试按钮 */}
          {promptMode === 'interviewer' && !isInterviewStarted && !isInterviewEnded && currentSessionId && (
            <button
              onClick={() => setIsInterviewStarted(true)}
              className="flex items-center justify-center px-2 h-6 rounded hover:bg-green-200/50 transition-colors duration-150 gap-1"
              title="开始面试"
            >
              <PlayCircle className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs text-green-600 font-medium">开始</span>
            </button>
          )}
          {/* 面试官模式：结束面试按钮 */}
          {promptMode === 'interviewer' && isInterviewStarted && !isInterviewEnded && currentSessionId && (
            <button
              onClick={handleEndInterview}
              disabled={isGenerating}
              className="flex items-center justify-center px-2 h-6 rounded hover:bg-red-200/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 gap-1"
              title="结束面试"
            >
              <StopCircle className="w-3.5 h-3.5 text-red-600" />
              <span className="text-xs text-red-600 font-medium">结束</span>
            </button>
          )}
          {/* 面试官模式：面试已结束 */}
          {promptMode === 'interviewer' && isInterviewEnded && (
            <span className="text-xs text-amber-500 px-2">面试已结束</span>
          )}
          {/* 代码编辑器切换按钮 */}
          <button
            onClick={() => codeEditor.toggleEditor()}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors duration-150 ${
              codeEditor.showEditor 
                ? 'bg-amber-600 text-white' 
                : 'hover:bg-amber-200/50'
            }`}
            title={codeEditor.showEditor ? '关闭代码编辑器' : '打开代码编辑器'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-amber-700" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {/* 穿透模式切换按钮 */}
          <button
            onClick={async () => {
              const newState = await togglePassthrough();
              setPassthroughActive(newState);
            }}
            className={`p-1 rounded transition-colors ${
              passthroughActive 
                ? 'bg-amber-600 text-white' 
                : 'text-amber-700 hover:bg-amber-200/50'
            }`}
            title={passthroughActive ? '点击穿透：开启' : '点击穿透：关闭'}
          >
            {/* 鼠标指针图标 */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              {passthroughActive ? (
                // 虚线鼠标指针（穿透开启）
                <path d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.708A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" strokeDasharray="3 2" />
              ) : (
                // 实心鼠标指针（穿透关闭）
                <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.708A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" clipRule="evenodd" />
              )}
            </svg>
          </button>
          {/* 紧凑模式切换按钮 */}
          <button
            onClick={handleToggleCompactMode}
            className="p-1 rounded text-amber-700 hover:bg-amber-200/50 transition-colors"
            title={compactMode ? '展开为完整模式' : '切换为紧凑模式'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              {compactMode ? (
                // 展开图标：四角箭头向外扩展
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L5.414 15H7a1 1 0 010 2H3a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
              ) : (
                // 收缩图标：上下横线 + 中间向内收缩箭头
                <>
                  <path d="M4 3h12a1 1 0 110 2H4a1 1 0 110-2z" />
                  <path d="M7.293 7.707a1 1 0 011.414 0L10 9.0l1.293-1.293a1 1 0 111.414 1.414l-2 2a1 1 0 01-1.414 0l-2-2a1 1 0 010-1.414z" />
                  <path d="M7.293 12.293a1 1 0 011.414 0L10 11l1.293 1.293a1 1 0 01-1.414 1.414l-2-2a1 1 0 010-1.414z" transform="rotate(180 10 12)" />
                  <path d="M4 15h12a1 1 0 110 2H4a1 1 0 110-2z" />
                </>
              )}
            </svg>
          </button>
          {/* 快捷键设置按钮 */}
          <button
            onClick={handleOpenShortcuts}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors duration-150"
            title="快捷键设置"
          >
            <Keyboard className="w-3.5 h-3.5 text-amber-700" />
          </button>
          {/* 设置按钮 */}
          <button
            onClick={handleOpenSettings}
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

      {/* 主内容区域：消息列表 + 代码编辑器 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 消息列表区域 */}
        <div
          ref={scrollRef}
          data-interactive="true"
          className={`overflow-y-auto scrollbar-hide p-4 space-y-4 transition-all duration-300 ${codeEditor.showEditor ? 'w-[60%]' : 'flex-1'}`}
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
                isComplete={message.isComplete}
                interruptReason={message.interruptReason}
                isGenerating={isGenerating}
                onContinue={() => handleContinueGeneration(message.id)}
              />
              {/* 友好错误卡片 */}
              {networkResilience.activeErrors[message.id] && (
                <div className="mt-2">
                  <FriendlyErrorCard
                    error={networkResilience.activeErrors[message.id]}
                    onRetry={() => handleRetryMessage(message.id)}
                    onDismiss={() => networkResilience.clearError(message.id)}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
        
        {/* 生成中指示器 */}
        {isGenerating && (
          <div className="message-enter flex justify-start">
            <div className="flex flex-col gap-1 px-4 py-2.5 bg-amber-800 rounded-2xl rounded-bl-md">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              {/* 等待提示 */}
              {networkResilience.waitingMessageId && (
                <span className="text-[10px] text-amber-300/80">
                  {getWaitingHint(networkResilience.getWaitingSeconds())}
                </span>
              )}
            </div>
          </div>
        )}
        </div>

        {/* 代码编辑器侧栏 */}
        {codeEditor.showEditor && (
          <CodeEditorPanel
            className="w-[40%] h-full"
            onClose={() => codeEditor.setShowEditor(false)}
            onInsertToInput={(code) => {
              setInput((prev) => prev + '\n\n```\n' + code + '\n```\n');
            }}
          />
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
      <div data-interactive="true" className="p-4 bg-amber-100/50 border-t border-amber-200">
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
            placeholder={promptMode === 'interviewer' && isInterviewEnded ? "面试已结束" : isRecording ? "正在录音..." : "输入问题，按 Enter 发送..."}
            rows={1}
            disabled={isGenerating || (promptMode === 'interviewer' && isInterviewEnded)}
            className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 bg-white/80 text-amber-900 text-sm placeholder:text-amber-400 rounded-xl border border-amber-300 resize-none scrollbar-hide glow-focus transition-all duration-150 disabled:opacity-50"
            style={{ lineHeight: "1.5" }}
          />
          {/* 截图按钮 */}
          <button
            onClick={handleScreenshot}
            disabled={isRecording || isGenerating || (promptMode === 'interviewer' && isInterviewEnded)}
            className="flex items-center justify-center w-10 h-10 bg-amber-100 hover:bg-amber-200 disabled:opacity-30 disabled:cursor-not-allowed text-amber-700 rounded-xl border border-amber-300 transition-all duration-150"
            title="区域截图"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating || isRecording || (promptMode === 'interviewer' && isInterviewEnded)}
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
            onClose={async () => {
              setCurrentView('main');
              const config = await loadConfig();
              setPromptMode(getPromptMode(config));
            }}
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

      {/* 会话历史页面 - 全页面覆盖 */}
      {currentView === 'sessions' && (
        <div className="absolute inset-0 z-50">
          <SessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSessionFromList}
            onDeleteSession={handleDeleteSession}
            onSearch={handleSearchSessions}
            onBack={() => setCurrentView('main')}
            onReview={handleReview}
          />
        </div>
      )}

      {/* 导出对话框 */}
      {exportDialogOpen && currentSessionId && (
        <ExportDialog
          isOpen={exportDialogOpen}
          onClose={handleCloseExport}
          session={{
            id: currentSessionId,
            title: sessions.find(s => s.id === currentSessionId)?.title || '当前会话',
            created_at: Date.now(),
            updated_at: Date.now(),
          }}
          messageCount={messages.length}
        />
      )}

      {/* 复盘对话框 */}
      {promptMode === 'interviewer' && reviewDialogOpen && reviewSessionId && (
        <ReviewDialog
          isOpen={reviewDialogOpen}
          onClose={handleCloseReview}
          sessionId={reviewSessionId}
          sessionTitle={reviewSessionTitle}
        />
      )}
    </div>
  );
}

export default App;
