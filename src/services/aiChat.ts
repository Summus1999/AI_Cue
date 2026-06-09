import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppConfig, ProviderType, ProviderConfig, InterviewBackground, PromptMode } from '../store/config';
import { PROMPT_TEMPLATES, getPromptMode } from '../store/config';
import { getTemplateById } from './interviewTemplates';
import { ensureRagRuntimeConfigured } from './ragRuntimeConfig';
import { selectProvider, getTopPriorityEntry } from './smartRouter';
import type { RouteSelection } from './smartRouter';
import { createLogger } from './logger';
import { useNetworkResilience, type DegradationReason } from '../store/networkResilience';

const log = createLogger('AIChat');

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * 从消息列表中提取最近 N 轮对话作为上下文
 * @param messages  当前会话的全部消息（按时间升序）
 * @param windowSize  上下文窗口大小（轮数），1轮 = 1条user + 1条assistant
 * @returns 用于传递给 AI 的 ChatMessage 数组
 */
export function buildContextHistory(
  messages: Array<{ role: string; content: string }>,
  windowSize: number,
): ChatMessage[] {
  if (windowSize <= 0 || messages.length === 0) {
    log.debug(`上下文窗口已禁用或无历史消息 (windowSize=${windowSize}, messages=${messages.length})`);
    return [];
  }

  // 排除 system 消息，只保留 user 和 assistant
  const validMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  
  // 取最近 windowSize 轮 = windowSize * 2 条消息
  const maxMessages = windowSize * 2;
  const history = validMessages.slice(-maxMessages);

  log.debug(`构建上下文历史: windowSize=${windowSize}, 可用消息=${validMessages.length}, 提取历史=${history.length}条`);

  return history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

interface StreamEvent {
  content: string;
  done: boolean;
  /** 新增：流是否正常完成 */
  isComplete?: boolean;
  /** 新增：完成原因 */
  finishReason?: string;
}

interface StreamRequestOptions {
  requestId: string;
  eventPrefix?: 'ai-stream' | 'qwen-stream';
}

export interface ChatRequestOptions {
  retrievalContext?: string;
}

export const SCREENSHOT_ANALYSIS_PROMPT =
  '请识别截图中的算法题，并直接给出最终可提交的 C++ 解法。如果题面不完整，请做合理假设。';

function parseRepoUrls(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function buildScreenshotFollowUpPrompt(question: string): string {
  return [
    '请基于这张截图继续处理用户的问题。',
    '如果截图中同时包含题面和现有代码，请先识别题目，再指出当前代码中的问题，然后给出最终可提交的 C++ 代码。',
    '如果题面信息不完整，请明确你的合理假设。',
    `用户问题：${question}`,
  ].join('\n');
}

function buildInterviewBackgroundPrompt(bg: InterviewBackground, mode: PromptMode): string {
  const parts: string[] = ['---', '## 本次面试背景信息'];

  if (bg.company) parts.push('### 目标公司\n' + bg.company);
  if (bg.position) parts.push('### 应聘岗位\n' + bg.position);
  if (bg.jd) parts.push('### 岗位JD\n' + bg.jd);
  if (bg.resume) {
    parts.push('### 候选人简历\n' + bg.resume);
    parts.push('');
    parts.push('【简历驱动指令 - 必须严格遵守】');

    if (mode === 'interviewer') {
      parts.push('你是面试官。请将简历作为"考察清单"：为每个项目准备技术选型、架构、量化结果、个人贡献、失败反思五类追问；');
      parts.push('对简历中每个技术关键词至少追问一个深度验证题；模糊描述（如"优化了性能"）必须追问具体指标。');
    } else if (mode === 'cheat') {
      parts.push('你是面试助手。每条要点须锚定简历中的项目或技术名词，关键数据用【】包裹。');
    } else {
      parts.push('你是面试助手。回答技术问题时优先引用简历项目作为实例，用简历中的具体数据支撑观点，');
      parts.push('确保回答中的技术水平声明与简历经历一致——不夸大不缩小。');
    }
  }

  parts.push('');

  if (mode === 'interviewer') {
    parts.push('请根据以上JD和简历，设计有针对性的面试问题，优先考察JD强调的技术并结合简历项目进行交叉验证式追问。');
  } else {
    parts.push('请根据以上JD和简历，给出个性化回答并结合候选人项目经历作为实例支撑。');
  }

  return parts.join('\n');
}

function appendRetrievalContext(systemPrompt: string, retrievalContext?: string): string {
  const normalizedContext = retrievalContext?.trim();
  if (!normalizedContext) {
    return systemPrompt;
  }

  return [
    systemPrompt,
    '---',
    '【检索增强上下文】',
    '以下内容来自系统预先检索到的聊天历史或知识库片段。仅在这些上下文能够直接支撑结论时引用；如果上下文不足，请明确说明，不要编造。',
    normalizedContext,
  ].join('\n\n');
}

// 从配置解析基础 Prompt 模板
function resolveBasePrompt(config: AppConfig): string {
  if (config.promptTemplateId === 'custom' && config.customPrompt?.trim()) {
    return config.customPrompt;
  }
  const template = PROMPT_TEMPLATES.find((item) => item.id === config.promptTemplateId);
  return template?.prompt || PROMPT_TEMPLATES[0].prompt;
}

// 构建发送给 AI 的 System Prompt。
// 拼接顺序（优先级从高到低）：
//   1. 面试模板 Prompt（来自 interviewTemplates.ts，用户主动选择，最高优先级）
//   2. 基础 Prompt（来自设置页的 Prompt 模板，默认 "通用助手"）
//   3. 面试背景信息（JD、简历、公司、岗位，来自面试设置弹窗）
//   4. RAG 检索上下文（知识库中检索到的相关文档片段）
function getSystemPrompt(config: AppConfig, promptMode: PromptMode, retrievalContext?: string): string {
  let prompt = resolveBasePrompt(config);

  // 注入面试模板 Prompt（优先于基础 Prompt）
  if (config.activeTemplateId) {
    const t = getTemplateById(config.activeTemplateId);
    if (t?.systemPrompt) {
      prompt = `${t.systemPrompt}\n\n---\n\n${prompt}`;
      log.debug(`注入面试模板: ${t.name} (${t.id})`);
    }
  }

  // 注入面试背景信息
  const bg = config.interviewBackground;
  if (bg?.enabled && (bg.company || bg.position || bg.jd || bg.resume)) {
    log.debug(`注入面试背景: mode=${promptMode}, 简历长度=${bg.resume?.length || 0}字符`);
    prompt = `${prompt}\n\n${buildInterviewBackgroundPrompt(bg, promptMode)}`;
  }

  return appendRetrievalContext(prompt, retrievalContext);
}

/** 流结果 */
export interface StreamResult {
  /** 是否正常完成 */
  isComplete: boolean;
  /** 完成原因 */
  finishReason?: string;
  /** 智能路由反馈：实际使用的 provider */
  usedProvider?: ProviderType;
  /** 智能路由反馈：实际使用的 model */
  usedModel?: string;
}

/** 流超时时间（毫秒）：2分钟 */
const STREAM_TIMEOUT_MS = 2 * 60 * 1000;

const localStreamControllers = new Map<string, () => void>();

function buildStreamEventName(
  requestId: string,
  eventPrefix: 'ai-stream' | 'qwen-stream' = 'ai-stream',
): string {
  return `${eventPrefix}:${requestId}`;
}

export function cancelStreamRequest(requestId: string): void {
  // 本地立即停止监听
  localStreamControllers.get(requestId)?.();

  // 后端异步取消，不阻塞前端
  invoke('ai_cancel_stream', { requestId }).catch((error) => {
    log.warn('后端取消流请求失败（本地已停止）:', error);
  });
}

async function streamWithEvent(
  invokeCommand: string,
  invokeArgs: Record<string, unknown>,
  onChunk: (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => void,
  options: StreamRequestOptions,
): Promise<StreamResult> {
  const eventName = buildStreamEventName(options.requestId, options.eventPrefix ?? 'ai-stream');
  const charQueue: string[] = [];
  let isDone = false;
  let resolveDone: ((result: StreamResult) => void) | null = null;
  let rejectDone: ((error: Error) => void) | null = null;
  let streamResult: StreamResult = { isComplete: true };
  let isSettled = false;
  let unlistenFn: (() => void) | null = null;

  const donePromise = new Promise<StreamResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const cleanup = () => {
    clearTimeout(timeoutId);
    charQueue.length = 0;
    localStreamControllers.delete(options.requestId);
    if (unlistenFn) {
      try {
        unlistenFn();
      } catch (e) {
        log.warn('事件监听器清理异常:', e);
      } finally {
        unlistenFn = null;
      }
    }
  };

  const resolveStream = (result: StreamResult) => {
    if (isSettled) return;
    isSettled = true;
    cleanup();
    resolveDone?.(result);
  };

  const rejectStream = (error: Error) => {
    if (isSettled) return;
    isSettled = true;
    cleanup();
    rejectDone?.(error);
  };

  // 设置超时保护
  const timeoutId = setTimeout(() => {
    if (!isDone && !isSettled) {
      rejectStream(new Error(`流响应超时（>${STREAM_TIMEOUT_MS / 1000}秒），请检查网络连接或稍后重试`));
    }
  }, STREAM_TIMEOUT_MS);

  const processQueue = () => {
    if (isSettled) return;

    // 有数据就批量处理
    if (charQueue.length > 0) {
      const batch = charQueue.splice(0, charQueue.length);
      onChunk(batch.join(''), false);
    }

    // 队列已空且流已结束，触发完成
    if (isDone && charQueue.length === 0) {
      onChunk('', true, streamResult.isComplete, streamResult.finishReason);
      resolveStream(streamResult);
      return;
    }
  };

  const unlisten = await listen<StreamEvent>(eventName, (event) => {
    if (isSettled) return;

    if (event.payload.done) {
      isDone = true;
      streamResult = {
        isComplete: event.payload.isComplete ?? true,
        finishReason: event.payload.finishReason,
      };
      processQueue();
      return;
    }

    if (event.payload.content) {
      charQueue.push(event.payload.content);
      processQueue();
    }
  });

  unlistenFn = unlisten;

  localStreamControllers.set(options.requestId, () => {
    if (isSettled) {
      return;
    }

    isDone = true;
    streamResult = {
      isComplete: false,
      finishReason: 'user_abort',
    };
    onChunk('', true, false, 'user_abort');
    resolveStream(streamResult);
  });

  try {
    void invoke(invokeCommand, invokeArgs).catch((error) => {
      rejectStream(error instanceof Error ? error : new Error(String(error)));
      return null;
    });
    return await donePromise;
  } catch (error) {
    rejectStream(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// ==================== 统一 AI 接口（新增）====================

/**
 * 统一流式聊天接口 - 根据 config.activeProvider 自动路由到对应后端 Provider
 * 返回流完成状态，用于判断是否需要显示"继续生成"按钮
 */
export async function sendStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => void,
  requestId: string,
  history: ChatMessage[] = [],
  options: ChatRequestOptions = {},
  degradedModels: Set<string> = new Set(),
): Promise<StreamResult> {
  await ensureRagRuntimeConfigured(config, 'chat-send');

  // 智能路由：pre-flight 探测选择最优 Provider/模型
  let routedProvider = config.activeProvider;
  let routedModel: string | null = null;

  let routeResult: Awaited<ReturnType<typeof selectProvider>> = null;

  if (config.smartRouting?.enabled && config.smartRouting.entries.length > 0) {
    routeResult = await selectProvider(config, degradedModels);
    if (routeResult) {
      routedProvider = routeResult.provider;
      routedModel = routeResult.model;
    }
  }

  // 降级检测：实际路由 != 最高优先级首选 → 写入降级事件
  if (config.smartRouting?.enabled) {
    recordDegradationIfNeeded(config, degradedModels, routeResult, routedProvider, routedModel);
  }

  const provider = routedProvider;
  const providerConfig = config.providerConfigs[routedProvider];
  // 使用路由选中的模型，否则沿用 provider 默认模型
  const model = routedModel ?? providerConfig.model;

  if (!providerConfig.apiKey?.trim()) {
    throw new Error(`请先配置 ${provider} 的 API Key`);
  }

  const mode = getPromptMode(config);
  const systemPrompt = getSystemPrompt(config, mode, options.retrievalContext);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  const result = await streamWithEvent(
    'ai_chat_stream',
    {
      provider,
      config: {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl || null,
      },
      model,
      messages,
      requestId,
    },
    onChunk,
    {
      requestId,
      eventPrefix: 'ai-stream',
    },
  );

  // 若使用了路由模型，反馈给调用方用于降级标记
  if (routedModel) {
    result.usedProvider = routedProvider;
    result.usedModel = routedModel;
  }
  return result;
}

/** 降级检测：实际路由偏离最高优先级首选时写入 store */
function recordDegradationIfNeeded(
  config: AppConfig,
  degradedModels: Set<string>,
  routeResult: RouteSelection | null,
  actualProvider: ProviderType,
  actualModel: string | null,
): void {
  const { smartRouting } = config;
  if (!smartRouting?.enabled) return;

  const configuredSet = new Set(
    (Object.keys(config.providerConfigs) as ProviderType[]).filter(
      (p) => config.providerConfigs[p]?.apiKey?.trim(),
    ),
  );
  const top = getTopPriorityEntry(smartRouting.entries, degradedModels, configuredSet);
  if (!top) return;

  // 首选可用且被选中 → 未降级
  if (routeResult && routeResult.provider === top.provider && routeResult.model === top.model) return;

  const now = Date.now();
  const { degradationEvents } = useNetworkResilience.getState();

  // 5 秒去重
  if (
    degradationEvents.some(
      (e) =>
        e.intendedProvider === top.provider &&
        e.intendedModel === top.model &&
        e.actualProvider === actualProvider &&
        e.actualModel === actualModel &&
        now - e.timestamp < 5000,
    )
  ) return;

  // 定位 topEntry 被跳过的原因
  const skipped = routeResult?.skippedCandidates ?? [];
  const topSkip = skipped.find(
    (s) => s.provider === top.provider && s.model === top.model,
  );
  const reason: DegradationReason = !routeResult
    ? 'all_degraded'
    : (topSkip?.reason ?? 'unreachable');

  useNetworkResilience.getState().addDegradationEvent({
    id: `${top.provider}:${top.model}-${now}`,
    timestamp: now,
    intendedProvider: top.provider,
    intendedModel: top.model,
    actualProvider,
    actualModel: actualModel ?? config.providerConfigs[actualProvider]?.model ?? '',
    reason,
    skippedCandidates: skipped,
  });
}

/**
 * 统一非流式聊天接口
 */
export async function sendChat(
  question: string,
  config: AppConfig,
  history: ChatMessage[] = [],
  options: ChatRequestOptions = {},
): Promise<string> {
  await ensureRagRuntimeConfigured(config, 'chat-send');

  const provider = config.activeProvider;
  const providerConfig = config.providerConfigs[provider];

  if (!providerConfig.apiKey?.trim()) {
    throw new Error(`请先配置 ${provider} 的 API Key`);
  }

  const mode = getPromptMode(config);
  const systemPrompt = getSystemPrompt(config, mode, options.retrievalContext);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  return invoke<string>('ai_chat', {
    provider,
    config: {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl || null,
    },
    model: providerConfig.model,
    messages,
  });
}

/**
 * 连通性测试
 */
export async function testConnection(
  provider: ProviderType,
  config: ProviderConfig,
): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const result = await invoke<{
    success: boolean;
    latency_ms: number;
    message: string;
  }>('ai_test_connection', {
    provider,
    config: {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || null,
    },
  });
  
  return {
    success: result.success,
    latencyMs: result.latency_ms,
    message: result.message,
  };
}

// ==================== 向下兼容：保留原有千问接口（已弃用）====================

/**
 * @deprecated 请使用 sendChat
 */
export async function sendToQwen(
  question: string,
  config: AppConfig,
  history: ChatMessage[] = [],
): Promise<string> {
  await ensureRagRuntimeConfigured(config, 'chat-send');

  // 兼容旧配置格式
  const apiKey = config.providerConfigs?.qwen?.apiKey || config.apiKey || '';
  const model = config.providerConfigs?.qwen?.model || config.model || 'qwen-turbo';
  
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config, getPromptMode(config)) },
    ...history,
    { role: 'user', content: question },
  ];

  return invoke<string>('qwen_chat', { apiKey, model, messages });
}

/**
 * @deprecated 请使用 sendStream
 */
export async function sendToQwenStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
  requestId: string,
  history: ChatMessage[] = [],
): Promise<void> {
  await ensureRagRuntimeConfigured(config, 'chat-send');

  // 兼容旧配置格式
  const apiKey = config.providerConfigs?.qwen?.apiKey || config.apiKey || '';
  const model = config.providerConfigs?.qwen?.model || config.model || 'qwen-turbo';
  
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config, getPromptMode(config)) },
    ...history,
    { role: 'user', content: question },
  ];

  await streamWithEvent(
    'qwen_chat_stream',
    { apiKey, model, messages, requestId },
    onChunk,
    {
      requestId,
      eventPrefix: 'qwen-stream',
    },
  );
}

/**
 * 截图视觉识别 - 始终使用千问 VL Max（千问专属能力）
 */
export async function sendToQwenStreamWithImage(
  prompt: string,
  imageBase64: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => void,
  requestId: string,
): Promise<void> {
  await ensureRagRuntimeConfigured(config, 'chat-send');

  // 截图视觉始终使用千问
  const apiKey = config.providerConfigs?.qwen?.apiKey || config.apiKey || '';
  
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  await streamWithEvent(
    'qwen_chat_stream_vision',
    {
      apiKey,
      imageBase64,
      prompt,
      repoUrls: parseRepoUrls(config.highQualityRepoUrls || ''),
      localDocPath: config.localDocPath?.trim() || null,
      requestId,
    },
    onChunk,
    {
      requestId,
      eventPrefix: 'qwen-stream',
    },
  );
}
