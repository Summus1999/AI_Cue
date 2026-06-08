import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../store/config';
import {
  buildAssistantMemoryExtractionRequest,
  shouldTriggerAssistantMemoryExtraction,
  triggerAssistantMemoryExtraction,
} from '../memoryExtraction';

function createConfig(overrides?: Partial<AppConfig>): AppConfig {
  const baseConfig = {
    activeProvider: 'qwen',
    providerConfigs: {
      qwen: {
        apiKey: 'chat-key',
        model: 'qwen-plus',
        baseUrl: '',
      },
      openai_compat: {
        apiKey: 'embedding-key',
        model: 'text-embedding-3-small',
        baseUrl: 'https://api.openai.com/v1',
      },
      claude: {
        apiKey: '',
        model: 'claude-sonnet-4-20250514',
        baseUrl: '',
      },
    },
    rag: {
      enabled: true,
      retrievalScope: 'hybrid',
      enableOcr: false,
      enablePersonalMemoryForInterviewer: false,
      embeddingProvider: 'openai_compat',
      embeddingModel: 'text-embedding-3-small',
      autoReindexPolicy: 'manual',
    },
  } satisfies Partial<AppConfig>;

  return {
    ...baseConfig,
    ...overrides,
    providerConfigs: {
      ...baseConfig.providerConfigs,
      ...overrides?.providerConfigs,
    },
    rag: {
      ...baseConfig.rag,
      ...overrides?.rag,
    },
  } as AppConfig;
}

const assistantContent =
  '可以这样回答：这个问题考察 Redis AOF 重写机制。AOF 重写通过 fork 子进程生成新的 AOF 文件，主线程继续处理请求，同时用增量缓冲区记录重写期间的新写命令，最后原子替换旧文件。';

describe('assistant memory extraction trigger', () => {
  it('allows complete assistant interview answers with configured providers', () => {
    expect(
      shouldTriggerAssistantMemoryExtraction({
        promptMode: 'assistant',
        isComplete: true,
        sessionId: 'session-1',
        userContent: 'Redis AOF 重写如何避免阻塞主线程？',
        assistantContent,
        imageBase64: undefined,
        config: createConfig(),
      }),
    ).toBe(true);
  });

  it('rejects modes, incomplete answers, screenshots, missing session, missing keys, and low-value text', () => {
    const base = {
      promptMode: 'assistant' as const,
      isComplete: true,
      sessionId: 'session-1',
      userContent: 'Redis AOF 重写如何避免阻塞主线程？',
      assistantContent,
      imageBase64: undefined,
      config: createConfig(),
    };

    expect(shouldTriggerAssistantMemoryExtraction({ ...base, promptMode: 'interviewer' })).toBe(false);
    expect(shouldTriggerAssistantMemoryExtraction({ ...base, isComplete: false })).toBe(false);
    expect(shouldTriggerAssistantMemoryExtraction({ ...base, imageBase64: 'base64' })).toBe(false);
    expect(shouldTriggerAssistantMemoryExtraction({ ...base, sessionId: undefined })).toBe(false);
    expect(shouldTriggerAssistantMemoryExtraction({ ...base, assistantContent: '好的。' })).toBe(false);
    expect(
      shouldTriggerAssistantMemoryExtraction({
        ...base,
        config: createConfig({
          providerConfigs: {
            ...createConfig().providerConfigs,
            qwen: { apiKey: '', model: 'qwen-plus', baseUrl: '' },
          },
        }),
      }),
    ).toBe(false);
    expect(
      shouldTriggerAssistantMemoryExtraction({
        ...base,
        config: createConfig({
          providerConfigs: {
            ...createConfig().providerConfigs,
            openai_compat: { apiKey: '', model: 'text-embedding-3-small', baseUrl: '' },
          },
        }),
      }),
    ).toBe(false);
  });

  it('builds backend request with chat and embedding configs', () => {
    const request = buildAssistantMemoryExtractionRequest({
      sessionId: 'session-1',
      userContent: 'Redis AOF 重写如何避免阻塞主线程？',
      assistantContent,
      config: createConfig(),
    });

    expect(request.provider).toBe('qwen');
    expect(request.model).toBe('qwen-plus');
    expect(request.config.apiKey).toBe('chat-key');
    expect(request.embeddingConfig.provider).toBe('openai_compat');
    expect(request.embeddingConfig.apiKey).toBe('embedding-key');
    expect(request.embeddingConfig.model).toBe('text-embedding-3-small');
    expect(request.sourceText).toContain('用户问题');
    expect(request.sourceText).toContain('助手回答');
  });

  it('fires and forgets backend extraction without surfacing failures', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('network'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await triggerAssistantMemoryExtraction(
      {
        promptMode: 'assistant',
        isComplete: true,
        sessionId: 'session-1',
        userContent: 'Redis AOF 重写如何避免阻塞主线程？',
        assistantContent,
        imageBase64: undefined,
        config: createConfig(),
      },
      { invoke },
    );

    expect(invoke).toHaveBeenCalledWith('memory_extract_from_assistant_turn', {
      request: expect.objectContaining({
        sessionId: 'session-1',
        provider: 'qwen',
      }),
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
