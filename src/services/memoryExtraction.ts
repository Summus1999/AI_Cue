import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { AppConfig, PromptMode } from '../store/config';
import { createLogger } from './logger';

const log = createLogger('MemoryExtraction');

const MIN_USER_CHARS = 8;
const MIN_ASSISTANT_CHARS = 80;

const INTERVIEW_MEMORY_KEYWORDS = [
  '面试',
  '项目',
  '简历',
  '岗位',
  '技术',
  '架构',
  '算法',
  '系统设计',
  '数据库',
  'Redis',
  'MySQL',
  'Java',
  'Rust',
  'React',
  '性能',
  '并发',
  '线程',
  '进程',
  '缓存',
  '索引',
  '事务',
];

export interface AssistantMemoryExtractionGateInput {
  promptMode: PromptMode;
  isComplete?: boolean;
  sessionId?: string | null;
  userContent: string;
  assistantContent: string;
  imageBase64?: string;
  config: AppConfig;
}

export interface AssistantMemoryExtractionRequest {
  sessionId: string;
  provider: AppConfig['activeProvider'];
  config: {
    apiKey: string;
    baseUrl: string | null;
  };
  model: string;
  embeddingConfig: {
    provider: AppConfig['rag']['embeddingProvider'];
    apiKey: string;
    baseUrl: string | null;
    model: string | null;
  };
  sourceText: string;
  similarityThreshold: number;
}

export interface MemoryExtractionDependencies {
  invoke?: typeof tauriInvoke;
}

function trimText(value: string): string {
  return value.trim();
}

function hasUsefulInterviewSignal(userContent: string, assistantContent: string): boolean {
  const combined = `${userContent}\n${assistantContent}`;
  if (/[?？]/.test(userContent)) {
    return true;
  }

  return INTERVIEW_MEMORY_KEYWORDS.some((keyword) => combined.includes(keyword));
}

export function shouldTriggerAssistantMemoryExtraction(
  input: AssistantMemoryExtractionGateInput,
): boolean {
  if (input.promptMode !== 'assistant') return false;
  if (!input.isComplete) return false;
  if (input.imageBase64) return false;
  if (!input.sessionId?.trim()) return false;

  const userContent = trimText(input.userContent);
  const assistantContent = trimText(input.assistantContent);
  if (userContent.length < MIN_USER_CHARS) return false;
  if (assistantContent.length < MIN_ASSISTANT_CHARS) return false;
  if (!hasUsefulInterviewSignal(userContent, assistantContent)) return false;

  const chatConfig = input.config.providerConfigs[input.config.activeProvider];
  if (!chatConfig?.apiKey?.trim()) return false;

  const embeddingProvider = input.config.rag.embeddingProvider;
  const embeddingConfig = input.config.providerConfigs[embeddingProvider];
  if (!embeddingConfig?.apiKey?.trim()) return false;

  return true;
}

export function buildAssistantMemoryExtractionRequest(params: {
  sessionId: string;
  userContent: string;
  assistantContent: string;
  config: AppConfig;
}): AssistantMemoryExtractionRequest {
  const { config } = params;
  const chatConfig = config.providerConfigs[config.activeProvider];
  const embeddingProvider = config.rag.embeddingProvider;
  const embeddingConfig = config.providerConfigs[embeddingProvider];

  return {
    sessionId: params.sessionId,
    provider: config.activeProvider,
    config: {
      apiKey: chatConfig.apiKey.trim(),
      baseUrl: chatConfig.baseUrl?.trim() || null,
    },
    model: chatConfig.model,
    embeddingConfig: {
      provider: embeddingProvider,
      apiKey: embeddingConfig.apiKey.trim(),
      baseUrl: embeddingConfig.baseUrl?.trim() || null,
      model: config.rag.embeddingModel?.trim() || null,
    },
    sourceText: [
      '用户问题：',
      trimText(params.userContent),
      '',
      '助手回答：',
      trimText(params.assistantContent),
    ].join('\n'),
    similarityThreshold: 0.92,
  };
}

export async function triggerAssistantMemoryExtraction(
  input: AssistantMemoryExtractionGateInput,
  dependencies: MemoryExtractionDependencies = {},
): Promise<void> {
  if (!shouldTriggerAssistantMemoryExtraction(input)) {
    return;
  }

  const invoke = dependencies.invoke ?? tauriInvoke;
  const request = buildAssistantMemoryExtractionRequest({
    sessionId: input.sessionId!.trim(),
    userContent: input.userContent,
    assistantContent: input.assistantContent,
    config: input.config,
  });

  try {
    await invoke('memory_extract_from_assistant_turn', { request });
  } catch (error) {
    // 实时记忆只能增强体验，失败不能影响主聊天链路。
    log.warn('实时抽取失败，已跳过:', error);
  }
}
