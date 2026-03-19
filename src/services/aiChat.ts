import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppConfig, ProviderType, ProviderConfig, InterviewBackground } from '../store/config';
import { PROMPT_TEMPLATES } from '../store/config';

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
    console.log(`[Context] 上下文窗口已禁用或无历史消息 (windowSize=${windowSize}, messages=${messages.length})`);
    return [];
  }

  // 排除 system 消息，只保留 user 和 assistant
  const validMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  
  // 取最近 windowSize 轮 = windowSize * 2 条消息
  const maxMessages = windowSize * 2;
  const history = validMessages.slice(-maxMessages);

  console.log(`[Context] 构建上下文历史: windowSize=${windowSize}, 可用消息=${validMessages.length}, 提取历史=${history.length}条`);

  return history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

interface StreamEvent {
  content: string;
  done: boolean;
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

function buildInterviewBackgroundPrompt(bg: InterviewBackground): string {
  const parts: string[] = ['---', '## 当前面试背景'];

  if (bg.company) {
    parts.push(`- **目标公司**: ${bg.company}`);
  }
  if (bg.position) {
    parts.push(`- **应聘岗位**: ${bg.position}`);
  }
  if (bg.jdHighlights) {
    parts.push(`- **JD 要点**:\n${bg.jdHighlights}`);
  }

  parts.push('');
  parts.push('请根据以上面试背景，调整你的回答风格和侧重点，使回答更加贴合该公司和岗位的要求。');

  return parts.join('\n');
}

function getSystemPrompt(config: AppConfig): string {
  // 1. 获取基础 Prompt（现有逻辑不变）
  let basePrompt: string;
  if (config.promptTemplateId === 'custom') {
    if (config.customPrompt?.trim()) {
      basePrompt = config.customPrompt;
    } else {
      basePrompt = PROMPT_TEMPLATES[0].prompt;
    }
  } else {
    const template = PROMPT_TEMPLATES.find((item) => item.id === config.promptTemplateId);
    basePrompt = template?.prompt || PROMPT_TEMPLATES[0].prompt;
  }

  // 2. 注入面试背景（新增）
  const bg = config.interviewBackground;
  if (bg?.enabled && (bg.company || bg.position || bg.jdHighlights)) {
    console.log(`[Interview] 注入面试背景: 公司=${bg.company || 'N/A'}, 岗位=${bg.position || 'N/A'}, JD要点长度=${bg.jdHighlights?.length || 0}字符`);
    const bgSection = buildInterviewBackgroundPrompt(bg);
    return `${basePrompt}\n\n${bgSection}`;
  }

  return basePrompt;
}

async function streamWithEvent(
  invokeCommand: string,
  invokeArgs: Record<string, unknown>,
  onChunk: (content: string, done: boolean) => void,
  eventName: string = 'ai-stream',
): Promise<void> {
  const charQueue: string[] = [];
  let isProcessing = false;
  let isDone = false;
  let resolveDone: (() => void) | null = null;

  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const processQueue = () => {
    if (isProcessing || charQueue.length === 0) {
      if (isDone && charQueue.length === 0) {
        onChunk('', true);
        resolveDone?.();
      }
      return;
    }

    isProcessing = true;
    const char = charQueue.shift()!;
    onChunk(char, false);

    setTimeout(() => {
      isProcessing = false;
      processQueue();
    }, 30);
  };

  const unlisten = await listen<StreamEvent>(eventName, (event) => {
    if (event.payload.done) {
      isDone = true;
      if (charQueue.length === 0) {
        onChunk('', true);
        resolveDone?.();
      }
      return;
    }

    if (event.payload.content) {
      for (const char of event.payload.content) {
        charQueue.push(char);
      }
      processQueue();
    }
  });

  try {
    await invoke(invokeCommand, invokeArgs);
    await donePromise;
  } catch (error) {
    throw error;
  } finally {
    unlisten();
  }
}

// ==================== 统一 AI 接口（新增）====================

/**
 * 统一流式聊天接口 - 根据 config.activeProvider 自动路由到对应后端 Provider
 */
export async function sendStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
  history: ChatMessage[] = [],
): Promise<void> {
  const provider = config.activeProvider;
  const providerConfig = config.providerConfigs[provider];

  if (!providerConfig.apiKey?.trim()) {
    throw new Error(`请先配置 ${provider} 的 API Key`);
  }

  const systemPrompt = getSystemPrompt(config);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  await streamWithEvent(
    'ai_chat_stream',
    {
      provider,
      config: {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl || null,
      },
      model: providerConfig.model,
      messages,
    },
    onChunk,
    'ai-stream',
  );
}

/**
 * 统一非流式聊天接口
 */
export async function sendChat(
  question: string,
  config: AppConfig,
  history: ChatMessage[] = [],
): Promise<string> {
  const provider = config.activeProvider;
  const providerConfig = config.providerConfigs[provider];

  if (!providerConfig.apiKey?.trim()) {
    throw new Error(`请先配置 ${provider} 的 API Key`);
  }

  const systemPrompt = getSystemPrompt(config);
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
  // 兼容旧配置格式
  const apiKey = config.providerConfigs?.qwen?.apiKey || config.apiKey || '';
  const model = config.providerConfigs?.qwen?.model || config.model || 'qwen-turbo';
  
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config) },
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
  history: ChatMessage[] = [],
): Promise<void> {
  // 兼容旧配置格式
  const apiKey = config.providerConfigs?.qwen?.apiKey || config.apiKey || '';
  const model = config.providerConfigs?.qwen?.model || config.model || 'qwen-turbo';
  
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config) },
    ...history,
    { role: 'user', content: question },
  ];

  await streamWithEvent(
    'qwen_chat_stream',
    { apiKey, model, messages },
    onChunk,
    'qwen-stream',
  );
}

/**
 * 截图视觉识别 - 始终使用千问 VL Max（千问专属能力）
 */
export async function sendToQwenStreamWithImage(
  prompt: string,
  imageBase64: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
): Promise<void> {
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
    },
    onChunk,
    'qwen-stream',
  );
}
