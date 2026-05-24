import { useState, useRef, useEffect, useCallback, useMemo, lazy } from "react";
import { Send, Minus, X, Settings, Mic, Square, Keyboard, Camera, ChevronDown, Plus, History, Download, StopCircle, PlayCircle, Clock, Search, Database, Zap } from "lucide-react";
// 懒加载非核心面板
const SettingsPanel = lazy(() => 
  import("./components/SettingsPanel").then(m => ({ default: m.SettingsPanel }))
);
const ShortcutSettingsPanel = lazy(() => 
  import("./components/ShortcutSettingsPanel").then(m => ({ default: m.ShortcutSettingsPanel }))
);
const SessionList = lazy(() => 
  import("./components/SessionList").then(m => ({ default: m.default }))
);
const ExportDialog = lazy(() => 
  import("./components/export/ExportDialog").then(m => ({ default: m.ExportDialog }))
);
const ReviewDialog = lazy(() => 
  import("./components/review/ReviewDialog").then(m => ({ default: m.ReviewDialog }))
);
const CodeEditorPanel = lazy(() => 
  import("./components/CodeEditorPanel").then(m => ({ default: m.CodeEditorPanel }))
);
const KnowledgeBasePanel = lazy(() =>
  import("./components/KnowledgeBasePanel").then(m => ({ default: m.KnowledgeBasePanel }))
);
import CompactView from "./components/CompactView";
import { MessageContent } from "./components/MessageContent";
import { MessageCitations } from "./components/MessageCitations";
import { NetworkStatusIndicator } from "./components/NetworkStatusIndicator";
import { FriendlyErrorCard } from "./components/FriendlyErrorCard";
import WaveformVisualizer from "./components/WaveformVisualizer";
import { invoke } from "@tauri-apps/api/core";
import { recognizeSpeech, getSpeechErrorMessage } from "./services/speechRecognition";
import {
  buildScreenshotFollowUpPrompt,
  SCREENSHOT_ANALYSIS_PROMPT,
  cancelStreamRequest,
  sendToQwenStreamWithImage,
  sendStream,
  buildContextHistory,
} from "./services/aiChat";
import { loadConfig, saveConfig, PromptMode, getPromptMode, QuestionTiming } from "./store/config";
import { bootstrap } from "./bootstrap/bootstrapCoordinator";
import { InterviewSetupDialog } from './components/InterviewSetupDialog';
import { cleanupHoverRestore, togglePassthrough, cleanupPassthrough, toggleCompactMode, saveWindowBounds, setCompactMode, isCompactMode, isPassthroughEnabled, setPassthrough, minimizeToRightDock } from './services/windowManager';
import { saveMessage, updateSessionTitle, getSessionMessages, listSessions, deleteSession, searchSessions, endInterview, Session } from './services/sessionManager';
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { errorClassifier } from './services/errorClassifier';
import { useNetworkResilience, getWaitingHint } from './store/networkResilience';
import { useCodeEditor } from './store/codeEditor';
import { codeDetector } from './services/codeDetector';
import { buildInterviewerRequestText } from './services/interviewFlow';
import { MessageSearchBar } from './components/MessageSearchBar';
import { useMessageSearch } from './store/messageSearch';
import { useRagStore } from './store/rag';
import { ragService, type CitationMetadata } from './services/ragService';
import {
  resolveChatRetrievalContext,
} from './services/chatRetrieval';
import {
  buildContinueGenerationPlan,
  buildRetryMessagePlan,
  findSourceUserMessage,
  type ChatReplayMessage,
} from './services/chatReplay';
import {
  perfCoreUiReady,
  perfScreenshotStart,
  perfScreenshotCaptureDone,
  perfScreenshotWindowCreated,
  perfScreenshotComplete,
  perfScreenshotCancelled,
  perfScreenshotError,
} from "./services/perf/perfInstrumentation";

// 消息类型定义
interface Message extends ChatReplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** 新增：消息是否完整生成 */
  isComplete?: boolean;
  /** 新增：中断原因 */
  interruptReason?: 'user_abort' | 'error' | 'timeout' | 'network';
  /** 用户回答该问题所用时间 (ms)，仅用于面试官模式 */
  responseTimeMs?: number;
}

interface RequestAssistantReplyOptions {
  assistantId?: string;
  userMessageId?: string;
  imageBase64?: string;
  responseTimeMs?: number;
  baseMessages?: Message[];
  persistUserMessage?: boolean;
  sessionId?: string | null;
  retrievalQuery?: string;
  fallbackCitations?: CitationMetadata[];
  existingAssistantContentPrefix?: string;
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

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${generateId()}`;
}

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
  if (finishReason === 'user_abort') return 'user_abort';
  if (finishReason === 'timeout') return 'timeout';
  if (finishReason === 'interrupted') return 'network';
  if (finishReason === 'error') return 'error';
  return undefined;
}

async function getKnowledgeReadyState(): Promise<boolean | null> {
  try {
    const knowledgeBases = await ragService.listKnowledgeBases();
    const candidateBases = knowledgeBases.filter((base) => base.documentCount > 0);
    if (candidateBases.length === 0) {
      return false;
    }

    const documentLists = await Promise.all(
      candidateBases.map((base) => ragService.listKnowledgeDocuments(base.id)),
    );

    return documentLists.some((documents) =>
      documents.some((document) => document.indexState === 'ready'),
    );
  } catch (error) {
    console.warn('[RAG] 检查知识库索引状态失败，将按未知状态降级:', error);
    return null;
  }
}

function App() {
  // 网络韧性状态管理
  const networkResilience = useNetworkResilience();
  
  // 消息搜索状态管理
  const messageSearch = useMessageSearch();
  
  // 代码编辑器状态
  const codeEditor = useCodeEditor();
  const {
    refreshKnowledgeBases,
    clearError: clearRagError,
  } = useRagStore();

  // 穿透模式状态
  const [passthroughActive, setPassthroughActive] = useState(false);

  // 紧凑模式状态
  const [compactMode, setCompactModeState] = useState(false);

  // 记录核心UI渲染完成
  useEffect(() => {
    perfCoreUiReady();
  }, []);

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
  
  // 当前视图：主界面 | 设置页面 | 快捷键设置 | 会话历史 | 知识库
  const [currentView, setCurrentView] = useState<'main' | 'settings' | 'shortcuts' | 'sessions' | 'knowledge'>('main');
  
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
  
  // 面试设置对话框
  const [showInterviewSetup, setShowInterviewSetup] = useState(false);
  // 当前面试的 JD 和简历（用于复盘功能）
  const [_interviewJd, setInterviewJd] = useState('');
  const [_interviewResume, setInterviewResume] = useState('');
  const [_interviewCompany, setInterviewCompany] = useState('');
  const [_interviewPosition, setInterviewPosition] = useState('');
  // 每题计时（用于复盘功能）
  const [questionTimings, setQuestionTimings] = useState<QuestionTiming[]>([]);
  const [currentQuestionAskedAt, setCurrentQuestionAskedAt] = useState<number | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // 实时计时器显示
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  // Prompt 模式状态
  const [promptMode, setPromptMode] = useState<PromptMode>('assistant');
  
  // 会话恢复/切换时间戳（用于上下文隔离）
  const [sessionResumeTimestamp, setSessionResumeTimestamp] = useState<number>(Date.now());
  
  // 最近一条 AI 消息完成的标记（用于触发面试计时等 side effect）
  const [lastCompletedMessageId, setLastCompletedMessageId] = useState<string | null>(null);
  
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
  // 智能路由：session 级降级模型集合，key = `${provider}:${model}`
  const [degradedModels, setDegradedModels] = useState<Set<string>>(new Set());
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
  const activeStreamRequestRef = useRef<{ requestId: string; assistantId: string } | null>(null);
  const locallyCancelledRequestIdsRef = useRef<Set<string>>(new Set());

  // 紧凑模式切换处理函数
  const handleToggleCompactMode = useCallback(async () => {
    const newState = await toggleCompactMode();
    setCompactModeState(newState);
  }, []);

  const updateAssistantMessage = useCallback((assistantId: string, content: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? { ...message, content } : message,
      ),
    );
  }, []);

  const updateAssistantCitations = useCallback(
    (assistantId: string, citations?: CitationMetadata[]) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, citations } : message,
        ),
      );
    },
    [],
  );

  const appendAssistantChunk = useCallback((assistantId: string, content: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, content: message.content + content }
          : message,
      ),
    );
  }, []);

  const buildRequestTextByMode = useCallback((
    answer: string,
    baseMessages: Message[],
  ) => {
    if (promptMode !== 'interviewer' || isInterviewEnded) {
      return answer;
    }
    return buildInterviewerRequestText({
      answer,
      questionIndex: currentQuestionIndex,
      history: baseMessages.map((item) => ({
        role: item.role,
        content: item.content,
      })),
    });
  }, [promptMode, isInterviewEnded, currentQuestionIndex]);

  const stopActiveResponse = useCallback(async () => {
    const activeRequest = activeStreamRequestRef.current;
    if (!activeRequest) {
      return false;
    }

    activeStreamRequestRef.current = null;
    locallyCancelledRequestIdsRef.current.add(activeRequest.requestId);
    setIsGenerating(false);
    networkResilience.setWaiting(null);

    setMessages((prev) =>
      prev.map((message) =>
        message.id === activeRequest.assistantId && message.role === 'assistant'
          ? {
              ...message,
              isComplete: false,
              interruptReason: 'user_abort',
              citations: message.content.trim() ? message.citations : undefined,
            }
          : message,
      ),
    );

    await cancelStreamRequest(activeRequest.requestId);
    return true;
  }, [networkResilience]);

  const requestAssistantReply = useCallback(async (
    userContent: string,
    requestText: string,
    imageBase64?: string,
    responseTimeMs?: number,
    options: RequestAssistantReplyOptions = {},
  ) => {
    const assistantId = options.assistantId ?? generateId();
    const userMessageId = options.userMessageId ?? generateId();
    const requestId = generateRequestId();
    const assistantPrefixContent = options.existingAssistantContentPrefix ?? '';
    const retrievalQuery = options.retrievalQuery ?? userContent;
    const persistUserMessage = options.persistUserMessage ?? !options.assistantId;
    const fallbackCitations = options.fallbackCitations;
    // 在写入新消息前，先捕获用于上下文构建的历史切片。
    const currentMessages = options.baseMessages ? [...options.baseMessages] : [...messages];

    if (options.assistantId) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: assistantPrefixContent,
                timestamp: Date.now(),
                isComplete: false,
                interruptReason: undefined,
                citations: fallbackCitations,
                sourceUserMessageId: options.userMessageId ?? message.sourceUserMessageId,
                requestText,
                requestImageBase64: imageBase64,
                retrievalQuery,
                requestContentPrefix: assistantPrefixContent,
              }
            : message,
        ),
      );
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: "user",
          content: userContent,
          timestamp: Date.now(),
          responseTimeMs,
        },
        {
          id: assistantId,
          role: "assistant",
          content: assistantPrefixContent,
          timestamp: Date.now(),
          isComplete: false,
          citations: fallbackCitations,
          sourceUserMessageId: userMessageId,
          requestText,
          requestImageBase64: imageBase64,
          retrievalQuery,
          requestContentPrefix: assistantPrefixContent,
        },
      ]);
    }

    activeStreamRequestRef.current = {
      requestId,
      assistantId,
    };
    setIsGenerating(true);
    networkResilience.setWaiting(assistantId);

    let sessionId = options.sessionId ?? currentSessionId;
    let isNewSession = false;

    try {
      if (persistUserMessage) {
        if (!sessionId) {
          const newSession = await invoke<{ id: string }>('create_session', {
            metadata: {
              prompt_mode: promptMode,
            },
          });
          sessionId = newSession.id;
          setCurrentSessionId(sessionId);
          isNewSession = true;
        }

        if (sessionId) {
          await saveMessage(sessionId, 'user', userContent, imageBase64);
          if (isNewSession) {
            await updateSessionTitle(sessionId, userContent.slice(0, 20));
          }
        }
      }
    } catch (dbError) {
      console.error('Failed to save user message:', dbError);
    }

    let fullAssistantContent = '';

    try {
      const config = await loadConfig();
      let hasReceivedContent = false;
      const isLocallyCancelled = () =>
        locallyCancelledRequestIdsRef.current.has(requestId);
      const preserveAssistantContentOnFailure = () => {
        if (fullAssistantContent) {
          return;
        }
        if (assistantPrefixContent) {
          updateAssistantMessage(assistantId, assistantPrefixContent);
        }
      };

      const onChunk = (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => {
        if (isLocallyCancelled() && !done) {
          return;
        }

        if (!done && content) {
          hasReceivedContent = true;
          fullAssistantContent += content;
          appendAssistantChunk(assistantId, content);
        }

        if (done) {
          const finalAssistantContent = assistantPrefixContent + fullAssistantContent;

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    isComplete: isComplete ?? true,
                    interruptReason: isComplete ? undefined : getInterruptReason(finishReason),
                  }
                : msg,
            ),
          );

          if (isComplete) {
            setLastCompletedMessageId(assistantId);
          }

          if (sessionId && fullAssistantContent) {
            saveMessage(sessionId, 'assistant', finalAssistantContent).catch((err) => {
              console.error('Failed to save assistant message:', err);
            });
          }

          if (isComplete && codeEditor.codeModeAutoDetect && finalAssistantContent) {
            const detection = codeDetector.detect(finalAssistantContent);
            if (detection.suggestion === 'code_mode' && detection.codeBlocks.length > 0) {
              codeEditor.setShowEditor(true);
              const firstBlock = detection.codeBlocks[0];
              codeEditor.insertCode(firstBlock.content, firstBlock.language, 'replace');
            }
          }
        }
      };

      const recentMessages = currentMessages.filter(m => m.timestamp >= sessionResumeTimestamp);
      const contextHistory = buildContextHistory(
        recentMessages,
        config.contextWindowSize ?? 5,
      );
      const retrievalPayload = !imageBase64
        ? await resolveChatRetrievalContext(
            config,
            promptMode,
            retrievalQuery,
            sessionId ?? undefined,
            {
              retrieveWithCitations: ragService.retrieveWithCitations,
              getKnowledgeReadyState,
            },
          )
        : undefined;
      updateAssistantCitations(assistantId, retrievalPayload?.citations ?? fallbackCitations);

      const send = async () => {
        if (imageBase64) {
          return sendToQwenStreamWithImage(requestText, imageBase64, config, onChunk, requestId);
        }
        return sendStream(requestText, config, onChunk, requestId, contextHistory, {
          retrievalContext: retrievalPayload?.promptContext,
        }, degradedModels);
      };

      // 用于在 catch 路径获取 sendStream 返回的路由信息
      let streamResult: Awaited<ReturnType<typeof send>> = undefined;

      try {
        streamResult = await send();
        // 智能路由：流失败时标记当前模型为降级，后续请求自动切换到备选模型
        if (streamResult && !streamResult.isComplete && streamResult.finishReason !== 'user_abort') {
          if (config?.smartRouting?.enabled && streamResult.usedProvider && streamResult.usedModel) {
            const entryId = `${streamResult.usedProvider}:${streamResult.usedModel}`;
            setDegradedModels((prev) => new Set([...prev, entryId]));
          }
        }
      } catch (error) {
        if (isLocallyCancelled()) {
          return;
        }

        // 智能路由：sendStream 异常抛出时也标记降级，防止下次请求再次选中故障模型
        if (config?.smartRouting?.enabled && streamResult?.usedProvider && streamResult?.usedModel) {
          const entryId = `${streamResult.usedProvider}:${streamResult.usedModel}`;
          setDegradedModels((prev) => new Set([...prev, entryId]));
        }

        const friendlyError = errorClassifier.classify(
          error instanceof Error ? error.message : String(error)
        );
        networkResilience.setError(assistantId, friendlyError);

        if (imageBase64 && !hasReceivedContent) {
          updateAssistantMessage(assistantId, assistantPrefixContent);
          fullAssistantContent = '';
          hasReceivedContent = false;
          try {
            await send();
            if (isLocallyCancelled()) {
              return;
            }
            networkResilience.clearError(assistantId);
            return;
          } catch (retryError) {
            if (isLocallyCancelled()) {
              return;
            }
            const retryFriendlyError = errorClassifier.classify(
              retryError instanceof Error ? retryError.message : String(retryError)
            );
            networkResilience.setError(assistantId, retryFriendlyError);
            if (assistantPrefixContent || fullAssistantContent) {
              preserveAssistantContentOnFailure();
            } else {
              updateAssistantMessage(
                assistantId,
                "❌ 图片识别失败: " + (retryError instanceof Error ? retryError.message : String(retryError)),
              );
            }
            updateAssistantCitations(assistantId, fallbackCitations);
            return;
          }
        }

        if (assistantPrefixContent || fullAssistantContent) {
          preserveAssistantContentOnFailure();
        } else {
          updateAssistantMessage(
            assistantId,
            (imageBase64 ? "❌ 图片识别失败: " : "❌ AI 回答失败: ") +
              friendlyError.message,
          );
        }
        updateAssistantCitations(assistantId, fallbackCitations);
      }
    } catch (error) {
      if (locallyCancelledRequestIdsRef.current.has(requestId)) {
        return;
      }

      const friendlyError = errorClassifier.classify(
        error instanceof Error ? error.message : String(error)
      );
      networkResilience.setError(assistantId, friendlyError);
      if (assistantPrefixContent || fullAssistantContent) {
        if (!fullAssistantContent) {
          updateAssistantMessage(assistantId, assistantPrefixContent);
        }
      } else {
        updateAssistantMessage(
          assistantId,
          (imageBase64 ? "❌ 图片识别失败: " : "❌ AI 回答失败: ") +
            friendlyError.message,
        );
      }
      updateAssistantCitations(assistantId, fallbackCitations);
    } finally {
      locallyCancelledRequestIdsRef.current.delete(requestId);
      if (activeStreamRequestRef.current?.requestId === requestId) {
        activeStreamRequestRef.current = null;
        setIsGenerating(false);
        networkResilience.setWaiting(null);
      }
    }
  }, [
    appendAssistantChunk,
    updateAssistantCitations,
    updateAssistantMessage,
    currentSessionId,
    degradedModels,
    networkResilience,
    codeEditor,
    messages,
    promptMode,
    sessionResumeTimestamp,
  ]);

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

  // 会话切换时清空降级模型列表，确保新会话重新探测所有模型
  useEffect(() => {
    setDegradedModels(new Set());
  }, [currentSessionId]);

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

  // 实时计时器：面试官模式下显示思考用时
  useEffect(() => {
    if (!currentQuestionAskedAt || !isInterviewStarted || isInterviewEnded) {
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - currentQuestionAskedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentQuestionAskedAt, isInterviewStarted, isInterviewEnded]);

  // 面试模式：AI 消息完成时的处理（独立 useEffect 避免闭包过期）
  useEffect(() => {
    if (!lastCompletedMessageId) return;
    
    if (promptMode === 'interviewer' && !isInterviewEnded) {
      if (!isInterviewStarted) {
        // 首次 AI 回复：标记面试开始
        setIsInterviewStarted(true);
      }
      // 无论是首次还是后续，都开始计时（因为 AI 完成了一个提问）
      setCurrentQuestionAskedAt(Date.now());
      setElapsedSeconds(0);
    }
    
    // 重置标记，避免重复触发
    setLastCompletedMessageId(null);
  }, [lastCompletedMessageId, promptMode, isInterviewStarted, isInterviewEnded]);

  // 启动时执行统一编排
  useEffect(() => {
    // 定义快捷键处理器
    const shortcutHandlers = {
      toggleRecording: () => toggleRecordingRef.current(),
      sendMessage: () => handleSendRef.current(),
      takeScreenshot: () => handleScreenshotRef.current(),
      togglePassthrough: async () => {
        const newState = await togglePassthrough();
        setPassthroughActive(newState);
      },
      toggleCompactMode: handleToggleCompactMode,
      panicHide: async () => {
        try {
          const win = getCurrentWindow();
          // 使用 document.hidden 没有直接 API，维护本地状态
          const hidden = (window as any).__aiCueHidden;
          if (hidden) {
            await win.show();
            await win.setFocus();
            (window as any).__aiCueHidden = false;
          } else {
            await win.hide();
            (window as any).__aiCueHidden = true;
          }
        } catch (e) {
          console.warn('紧急隐藏失败:', e);
        }
      },
    };

    // 执行启动编排
    async function runBootstrap() {
      try {
        const { snapshot, lastSession } = await bootstrap(shortcutHandlers);

        // 同步 promptMode 状态
        setPromptMode(snapshot.promptMode);

        // 同步紧凑模式状态
        setCompactModeState(snapshot.compactModeEnabled);

        // 如果有最近会话，恢复消息
        if (lastSession) {
          const msgs = await getSessionMessages(lastSession.id);
          setMessages(msgs.map(m => ({
            id: generateId(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.created_at || Date.now(),
          })));
          setCurrentSessionId(lastSession.id);
          setSessionResumeTimestamp(Date.now());
          setIsInterviewStarted(false);
          setIsInterviewEnded(false);
        }
      } catch (error) {
        console.error('[Bootstrap] 启动编排失败:', error);
      }
    }

    runBootstrap();

    // 组件卸载时清理资源
    return () => {
      cleanupHoverRestore();
      cleanupPassthrough();
    };
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
    if (!input.trim()) return;

    if (isGenerating) {
      await stopActiveResponse();
    }

    const question = input.trim();
    setInput("");
    
    // 面试官模式：用户发送消息时停止计时并记录
    let responseTimeMs: number | undefined = undefined;
    if (promptMode === 'interviewer' && isInterviewStarted && !isInterviewEnded && currentQuestionAskedAt) {
      const now = Date.now();
      const durationMs = now - currentQuestionAskedAt;
      responseTimeMs = durationMs;
      const lastAIMessage = messages.filter(m => m.role === 'assistant').pop();
      setQuestionTimings(prev => [...prev, {
        questionIndex: currentQuestionIndex,
        questionContent: lastAIMessage?.content?.substring(0, 100) || '',
        askedAt: currentQuestionAskedAt,
        answeredAt: now,
        durationMs,
      }]);
      setCurrentQuestionIndex(prev => prev + 1);
      setCurrentQuestionAskedAt(null);
    }
    
    const imageBase64 = latestScreenshotContext?.imageBase64;
    const requestText = imageBase64
      ? buildScreenshotFollowUpPrompt(question)
      : buildRequestTextByMode(question, messages);

    await requestAssistantReply(question, requestText, imageBase64, responseTimeMs);
  };

  // 新建会话（清空消息并重置会话 ID，延迟创建）
  const handleClear = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setLatestScreenshotContext(null);
    setIsInterviewStarted(false);
    setIsInterviewEnded(false);
    // 清理计时状态
    setQuestionTimings([]);
    setCurrentQuestionAskedAt(null);
    setCurrentQuestionIndex(0);
    setElapsedSeconds(0);
    setInterviewJd('');
    setInterviewResume('');
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

  // 面试官模式：手动推进到下一题（用于卡题兜底）
  const handleForceNextQuestion = async () => {
    if (promptMode !== 'interviewer' || !isInterviewStarted || isInterviewEnded || isGenerating) {
      return;
    }

    let responseTimeMs: number | undefined = undefined;
    if (currentQuestionAskedAt) {
      const now = Date.now();
      const durationMs = now - currentQuestionAskedAt;
      responseTimeMs = durationMs;
      const lastAIMessage = messages.filter(m => m.role === 'assistant').pop();
      setQuestionTimings(prev => [...prev, {
        questionIndex: currentQuestionIndex,
        questionContent: lastAIMessage?.content?.substring(0, 100) || '',
        askedAt: currentQuestionAskedAt,
        answeredAt: now,
        durationMs,
      }]);
      setCurrentQuestionIndex(prev => prev + 1);
      setCurrentQuestionAskedAt(null);
    }

    const fallbackAnswer = '这题我先回答到这里，请直接进入下一题。';
    const requestText = buildRequestTextByMode(fallbackAnswer, messages);
    await requestAssistantReply(fallbackAnswer, requestText, undefined, responseTimeMs);
  };

  // 面试设置提交处理
  const handleInterviewSetupSubmit = async (jd: string, resume: string, company: string, position: string) => {
    setInterviewJd(jd);
    setInterviewResume(resume);
    setInterviewCompany(company);
    setInterviewPosition(position);
    setShowInterviewSetup(false);
    setIsInterviewStarted(true);
    setQuestionTimings([]);
    setCurrentQuestionIndex(0);
    setCurrentQuestionAskedAt(null);
    setElapsedSeconds(0);

    // 先清空历史消息，确保新面试不受旧消息影响
    setMessages([]);
    setCurrentSessionId(null);
    setSessionResumeTimestamp(Date.now());

    // 更新 config 的 interviewBackground，company + position 用于个性化 prompt
    const config = await loadConfig();
    await saveConfig({
      ...config,
      interviewBackground: {
        ...config.interviewBackground,
        enabled: true,
        jd,
        resume,
        company,
        position,
      }
    });
    
    // 自动发送面试开始消息，触发 AI 面试官的开场白
    const triggerMessage = "你好面试官，我已准备好，请开始面试。";
    await requestAssistantReply(triggerMessage, triggerMessage, undefined);
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

  const handleOpenKnowledgeBases = async () => {
    if (compactMode) {
      await setCompactMode(false);
      setCompactModeState(false);
    }
    clearRagError();
    setCurrentView('knowledge');
    try {
      await refreshKnowledgeBases();
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
    }
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
      // 默认为“面试未开始”状态
      setIsInterviewStarted(false);
      setIsInterviewEnded(false);
      // 清理计时状态
      setQuestionTimings([]);
      setCurrentQuestionAskedAt(null);
      setCurrentQuestionIndex(0);
      setElapsedSeconds(0);
      setInterviewJd('');
      setInterviewResume('');
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
    // 清理计时状态
    setQuestionTimings([]);
    setCurrentQuestionAskedAt(null);
    setCurrentQuestionIndex(0);
    setElapsedSeconds(0);
    setInterviewJd('');
    setInterviewResume('');
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

          const result = await recognizeSpeech(audioData, config, {
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
          const text = result.text;

          if (text.trim()) {
            setMessages((prev) => prev.slice(0, -1));
            const imageBase64 = latestScreenshotContext?.imageBase64;
            const requestText = imageBase64
              ? buildScreenshotFollowUpPrompt(text)
              : buildRequestTextByMode(text, messages);

            // 面试官模式：语音输入时停止计时并记录
            let responseTimeMs: number | undefined = undefined;
            if (promptMode === 'interviewer' && isInterviewStarted && !isInterviewEnded && currentQuestionAskedAt) {
              const now = Date.now();
              const durationMs = now - currentQuestionAskedAt;
              responseTimeMs = durationMs;
              const lastAIMessage = messages.filter(m => m.role === 'assistant').pop();
              setQuestionTimings(prev => [...prev, {
                questionIndex: currentQuestionIndex,
                questionContent: lastAIMessage?.content?.substring(0, 100) || '',
                askedAt: currentQuestionAskedAt,
                answeredAt: now,
                durationMs,
              }]);
              setCurrentQuestionIndex(prev => prev + 1);
              setCurrentQuestionAskedAt(null);
            }

            await requestAssistantReply(text, requestText, imageBase64, responseTimeMs);
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
        // 面试官模式使用麦克风，其他模式使用系统音频
        const audioSource = promptMode === 'interviewer' ? 'microphone' : 'system';
        // 使用带事件发射的录音命令，用于波形可视化
        await invoke("start_audio_recording_with_events", { audioSource });
        setIsRecording(true);

        const listeningText = promptMode === 'interviewer' 
          ? "🎤 正在聆听麦克风...\n再次点击 🎤 停止录音"
          : "🎤 正在聆听电脑音频...\n再次点击 🎤 停止录音";
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "assistant",
          content: listeningText,
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
    
    // 记录截图开始
    perfScreenshotStart();
    
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const mainWindow = getCurrentWindow();
    const existingScreenshotWindow = await WebviewWindow.getByLabel("screenshot");
    let activeSourcePath: string | null = null;
    let cleanupListeners = () => {};

    // 截图前临时关闭穿透模式（穿透模式下无法接收截图窗口的鼠标事件）
    const wasPassthroughEnabled = isPassthroughEnabled();
    if (wasPassthroughEnabled) {
      await setPassthrough(false);
    }

    const restoreMainWindow = async () => {
      await mainWindow.show();
      await mainWindow.setFocus();
      // 截图结束后恢复穿透模式
      if (wasPassthroughEnabled) {
        await setPassthrough(true);
      }
    };
    
    try {
      if (existingScreenshotWindow) {
        await existingScreenshotWindow.close();
      }

      await mainWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const capture = await invoke<ScreenCaptureResult>('capture_full_screen');
      activeSourcePath = capture.source_path;
      
      // 记录截图捕获完成
      perfScreenshotCaptureDone({
        logicalWidth: capture.logical_width,
        logicalHeight: capture.logical_height,
        physicalWidth: capture.physical_width,
        physicalHeight: capture.physical_height,
      });
      
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
            // 记录截图完成
            perfScreenshotComplete();
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
        // 记录截图取消
        perfScreenshotCancelled();
        void restoreMainWindow();
      });
      cleanupCallbacks.push(unlistenCancel);

      const screenshotUrl = `/screenshot.html?` +
        `transportType=disk` +
        `&payloadRef=${encodeURIComponent(capture.source_path)}` +
        `&logicalWidth=${capture.logical_width}` +
        `&logicalHeight=${capture.logical_height}` +
        `&physicalWidth=${capture.physical_width}` +
        `&physicalHeight=${capture.physical_height}`;

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
      
      // 记录截图窗口创建
      perfScreenshotWindowCreated();
    } catch (err) {
      cleanupListeners();
      // 记录截图错误
      perfScreenshotError(err instanceof Error ? err.message : String(err));
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
    const continuePlan = buildContinueGenerationPlan(messages, messageId);
    if (!continuePlan) return;

    await requestAssistantReply(
      continuePlan.userContent,
      continuePlan.requestText,
      continuePlan.requestImageBase64,
      undefined,
      {
        assistantId: messageId,
        userMessageId: continuePlan.userMessageId,
        baseMessages: continuePlan.baseMessages,
        persistUserMessage: false,
        sessionId: currentSessionId,
        retrievalQuery: continuePlan.retrievalQuery,
        fallbackCitations: continuePlan.fallbackCitations,
        existingAssistantContentPrefix: continuePlan.existingAssistantContentPrefix,
      },
    );
  }, [messages, currentSessionId, requestAssistantReply]);

  // 重试消息功能
  const handleRetryMessage = useCallback(async (messageId: string) => {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex <= 0) return;
    const targetMessage = messages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant') return;
    const sourceUser = findSourceUserMessage(messages, messageIndex, targetMessage.sourceUserMessageId);
    if (!sourceUser) return;

    const fallbackRequestText = targetMessage.requestImageBase64
      ? SCREENSHOT_ANALYSIS_PROMPT
      : buildRequestTextByMode(sourceUser.message.content, messages.slice(0, sourceUser.index));
    const retryPlan = buildRetryMessagePlan(
      messages,
      messageId,
      fallbackRequestText,
      latestScreenshotContext?.imageBase64,
    );
    if (!retryPlan) return;

    networkResilience.clearError(messageId);
    await requestAssistantReply(
      retryPlan.userContent,
      retryPlan.requestText,
      retryPlan.requestImageBase64,
      undefined,
      {
        assistantId: messageId,
        userMessageId: retryPlan.userMessageId,
        baseMessages: retryPlan.baseMessages,
        persistUserMessage: false,
        sessionId: currentSessionId,
        retrievalQuery: retryPlan.retrievalQuery,
        fallbackCitations: retryPlan.fallbackCitations,
        existingAssistantContentPrefix: retryPlan.existingAssistantContentPrefix,
      },
    );
  }, [
    messages,
    networkResilience,
    requestAssistantReply,
    buildRequestTextByMode,
    latestScreenshotContext,
    currentSessionId,
  ]);

  // 搜索功能：Ctrl+F 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F 或 Cmd+F 打开搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (messageSearch.isSearchOpen) {
          // 已打开时聚焦输入框
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus();
        } else {
          messageSearch.openSearch();
        }
      }
      // ESC 关闭搜索
      if (e.key === 'Escape' && messageSearch.isSearchOpen) {
        messageSearch.closeSearch();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messageSearch]);

  // 搜索功能：关键词变化时执行搜索（防抖）
  useEffect(() => {
    if (!messageSearch.keyword) return;
    
    const timer = setTimeout(() => {
      messageSearch.executeSearch(messages);
    }, 200);
    
    return () => clearTimeout(timer);
  }, [messageSearch.keyword, messages, messageSearch]);

  // 搜索功能：当前焦点变化时滚动
  useEffect(() => {
    if (!messageSearch.isSearchOpen) return;
    
    const messageId = messageSearch.getCurrentMessageId();
    if (messageId) {
      // 暂停自动滚动
      updateAutoScroll(false);
      
      // 滚动到目标消息
      const element = document.querySelector(`[data-message-id="${messageId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      // 设置冷却时间，避免立即恢复自动滚动
      scrollCooldownRef.current = Date.now() + 2000;
    }
  }, [messageSearch.currentIndex, messageSearch.isSearchOpen, messageSearch]);

  // 最小化窗口
  const handleMinimize = async () => {
    await minimizeToRightDock();
    setCompactModeState(isCompactMode());
  };

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

  // 格式化思考用时（面试官模式）
  const formatThinkingDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}分${secs.toString().padStart(2, '0')}秒`;
    }
    return `${secs}秒`;
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
          promptMode={promptMode}
          isRecording={isRecording}
          recordingDuration={recordingDuration}
          targetPosition={_interviewPosition || undefined}
          targetCompany={_interviewCompany || undefined}
          isInterviewMode={isInterviewStarted}
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
          {/* 搜索按钮 */}
          <button
            onClick={() => messageSearch.openSearch()}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors duration-150 ${
              messageSearch.isSearchOpen 
                ? 'bg-amber-600 text-white' 
                : 'hover:bg-amber-200/50'
            }`}
            title="搜索消息 (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5 text-amber-700" />
          </button>
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
          <button
            onClick={handleOpenKnowledgeBases}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors duration-150 ${
              currentView === 'knowledge'
                ? 'bg-amber-600 text-white'
                : 'hover:bg-amber-200/50'
            }`}
            title="知识库"
          >
            <Database className="w-3.5 h-3.5 text-amber-700" />
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
          {promptMode === 'interviewer' && !isInterviewStarted && !isInterviewEnded && (
            <button
              onClick={() => setShowInterviewSetup(true)}
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
              onClick={handleForceNextQuestion}
              disabled={isGenerating}
              className="flex items-center justify-center px-2 h-6 rounded hover:bg-amber-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 gap-1"
              title="下一题（卡题时使用）"
            >
              <PlayCircle className="w-3.5 h-3.5 text-amber-700" />
              <span className="text-xs text-amber-700 font-medium">下一题</span>
            </button>
          )}
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
          {/* 极速模式快捷切换 */}
          <button
            onClick={async () => {
              const config = await loadConfig();
              const isCheat = config.promptTemplateId === 'cheat';
              // 切回时恢复为 tech 模板
              const newTemplateId = isCheat ? 'tech' : 'cheat';
              const newMode = getPromptMode({ ...config, promptTemplateId: newTemplateId });
              setPromptMode(newMode);
              config.promptTemplateId = newTemplateId;
              await saveConfig(config);
            }}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors duration-150 ${
              promptMode === 'cheat'
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'hover:bg-amber-200/50'
            }`}
            title={promptMode === 'cheat' ? '极速模式 · 点击切回' : '切换到极速模式'}
          >
            <Zap className={`w-3.5 h-3.5 ${promptMode === 'cheat' ? 'text-white' : 'text-amber-700'}`} />
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
            title="最小化到右侧"
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
          className={`flex-1 flex flex-col overflow-hidden`}
          onScroll={handleScroll}
        >
          {/* 搜索栏 */}
          <MessageSearchBar />
          
          {/* 消息列表 */}
          <div
            className={`flex-1 overflow-y-auto scrollbar-hide p-4 space-y-4 transition-all duration-300 ${codeEditor.showEditor ? 'w-[60%]' : 'flex-1'}`}
          >
          {messages.map((message) => (
            <div
              key={message.id}
              data-message-id={message.id}
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
                  messageId={message.id}
                  highlightEnabled={messageSearch.isSearchOpen}
                />
              {message.role === 'assistant' && message.content.trim() && message.citations && message.citations.length > 0 && (
                <MessageCitations citations={message.citations} />
              )}
              {/* 面试官模式：用户消息显示回答用时 */}
              {message.role === 'user' && message.responseTimeMs && promptMode === 'interviewer' && (
                <div className="mt-1 text-[10px] text-amber-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>用时 {formatThinkingDuration(Math.floor(message.responseTimeMs / 1000))}</span>
                </div>
              )}
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
        
        {/* 面试官模式：实时思考计时器 */}
        {promptMode === 'interviewer' && isInterviewStarted && !isInterviewEnded && currentQuestionAskedAt && !isGenerating && (
          <div className="flex items-center gap-2 px-4 py-2 text-amber-400 text-sm">
            <Clock className="w-4 h-4 animate-pulse" />
            <span>思考用时: {formatThinkingDuration(elapsedSeconds)}</span>
          </div>
        )}
        </div>
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
            disabled={promptMode === 'interviewer' && isInterviewEnded}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-150 ${
              isRecording
                ? 'bg-red-100 text-red-500 border-red-300 animate-pulse'
                : 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200 hover:text-amber-800'
            } ${promptMode === 'interviewer' && isInterviewEnded ? 'opacity-30 cursor-not-allowed' : ''}`}
            title={isRecording ? "停止录音" : (promptMode === 'interviewer' ? "语音输入（录制麦克风）" : "语音输入（录制电脑音频）")}
          >
            {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* 音量波形可视化 */}
          <WaveformVisualizer
            mode="bar"
            width={120}
            height={36}
            isActive={isRecording}
            sensitivity={2.0}
            className="rounded-lg"
          />
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              promptMode === 'interviewer' && isInterviewEnded
                ? "面试已结束"
                : isRecording
                  ? "正在录音..."
                  : isGenerating
                    ? "AI 正在回答，你可以直接输入新问题..."
                    : "输入问题，按 Enter 发送..."
            }
            rows={1}
            disabled={promptMode === 'interviewer' && isInterviewEnded}
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
          {isGenerating && (
            <button
              onClick={() => {
                void stopActiveResponse();
              }}
              disabled={isRecording}
              className="flex items-center justify-center w-10 h-10 bg-red-100 hover:bg-red-200 disabled:opacity-30 disabled:cursor-not-allowed text-red-600 rounded-xl border border-red-300 transition-all duration-150"
              title="停止当前回答"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || isRecording || (promptMode === 'interviewer' && isInterviewEnded)}
            className="flex items-center justify-center w-10 h-10 bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl border border-amber-700 transition-all duration-150"
            title={isGenerating ? "停止当前回答并发送新问题" : "发送问题"}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 text-[10px] text-amber-600 text-center">
          {isRecording ? (
            <span className="text-red-400/60">正在录制{promptMode === 'interviewer' ? '麦克风' : '电脑音频'}... 点击 🎤 停止</span>
          ) : isGenerating ? (
            "AI 正在回答 · 可点击 ■ 停止，或直接输入新问题后点发送"
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
            onOpenKnowledgeBase={handleOpenKnowledgeBases}
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

      {currentView === 'knowledge' && (
        <div className="absolute inset-0 z-50">
          <KnowledgeBasePanel onBack={() => setCurrentView('main')} />
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
          questionTimings={questionTimings}
        />
      )}

      {/* 面试设置对话框 */}
      <InterviewSetupDialog
        isOpen={showInterviewSetup}
        onClose={() => setShowInterviewSetup(false)}
        onSubmit={handleInterviewSetupSubmit}
      />
    </div>
  );
}

export default App;
