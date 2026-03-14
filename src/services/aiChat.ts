import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppConfig } from '../store/config';
import { PROMPT_TEMPLATES } from '../store/config';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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

function getSystemPrompt(config: AppConfig): string {
  if (config.promptTemplateId === 'custom') {
    if (config.customPrompt?.trim()) {
      return config.customPrompt;
    }
    return PROMPT_TEMPLATES[0].prompt;
  }

  const template = PROMPT_TEMPLATES.find((item) => item.id === config.promptTemplateId);
  return template?.prompt || PROMPT_TEMPLATES[0].prompt;
}

async function streamWithEvent(
  invokeCommand: string,
  invokeArgs: Record<string, unknown>,
  onChunk: (content: string, done: boolean) => void,
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

  const unlisten = await listen<StreamEvent>('qwen-stream', (event) => {
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

export async function sendToQwen(
  question: string,
  config: AppConfig,
  history: ChatMessage[] = [],
): Promise<string> {
  if (!config.apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config) },
    ...history,
    { role: 'user', content: question },
  ];

  return invoke<string>('qwen_chat', {
    apiKey: config.apiKey,
    model: config.model || 'qwen-turbo',
    messages,
  });
}

export async function sendToQwenStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
  history: ChatMessage[] = [],
): Promise<void> {
  if (!config.apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(config) },
    ...history,
    { role: 'user', content: question },
  ];

  await streamWithEvent(
    'qwen_chat_stream',
    {
      apiKey: config.apiKey,
      model: config.model || 'qwen-turbo',
      messages,
    },
    onChunk,
  );
}

export async function sendToQwenStreamWithImage(
  prompt: string,
  imageBase64: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
): Promise<void> {
  if (!config.apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  await streamWithEvent(
    'qwen_chat_stream_vision',
    {
      apiKey: config.apiKey,
      imageBase64,
      prompt,
      repoUrls: parseRepoUrls(config.highQualityRepoUrls || ''),
      localDocPath: config.localDocPath?.trim() || null,
    },
    onChunk,
  );
}
