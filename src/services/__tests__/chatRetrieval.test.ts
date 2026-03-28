import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../store/config';
import type { CitationMetadata } from '../ragService';
import { resolveChatRetrievalContext } from '../chatRetrieval';

function createConfig(overrides?: Partial<AppConfig>): AppConfig {
  const baseConfig = {
    providerConfigs: {
      qwen: {
        apiKey: 'rag-key',
        model: 'qwen-plus',
        baseUrl: '',
      },
      openai_compat: {
        apiKey: '',
        model: 'gpt-4o',
        baseUrl: '',
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
      embeddingProvider: 'qwen',
      embeddingModel: 'text-embedding-v2',
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

const sampleCitation: CitationMetadata = {
  index: 1,
  knowledgeBaseId: 'kb-1',
  documentId: 'doc-1',
  chunkId: 'chunk-1',
  title: 'Binary Search',
  snippet: 'Use a left-closed right-closed interval.',
  pageNumber: 2,
  headingPath: ['Algorithms'],
  score: 0.93,
  sourceKind: 'KnowledgeBaseDocument',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveChatRetrievalContext', () => {
  it('falls back to normal chat when RAG is disabled', async () => {
    const retrieveWithCitations = vi.fn();
    const getKnowledgeReadyState = vi.fn();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await resolveChatRetrievalContext(
      createConfig({
        rag: {
          enabled: false,
          retrievalScope: 'hybrid',
          enableOcr: false,
          embeddingProvider: 'qwen',
          embeddingModel: 'text-embedding-v2',
          autoReindexPolicy: 'manual',
        },
      }),
      'assistant',
      '如何实现二分查找？',
      'session-1',
      {
        retrieveWithCitations,
        getKnowledgeReadyState,
      },
    );

    expect(result).toBeUndefined();
    expect(retrieveWithCitations).not.toHaveBeenCalled();
    expect(getKnowledgeReadyState).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
  });

  it('returns retrieval context and citations when retrieval succeeds', async () => {
    const retrieveWithCitations = vi.fn().mockResolvedValue({
      promptContext: '命中知识库片段',
      citations: [sampleCitation],
    });
    const getKnowledgeReadyState = vi.fn();

    const result = await resolveChatRetrievalContext(
      createConfig(),
      'assistant',
      '如何实现二分查找？',
      'session-1',
      {
        retrieveWithCitations,
        getKnowledgeReadyState,
      },
    );

    expect(result).toEqual({
      promptContext: '命中知识库片段',
      citations: [sampleCitation],
    });
    expect(retrieveWithCitations).toHaveBeenCalledWith('如何实现二分查找？', 2000, 5, {
      sessionId: 'session-1',
      sourceKinds: ['Message', 'KnowledgeBaseDocument'],
    });
    expect(getKnowledgeReadyState).not.toHaveBeenCalled();
  });

  it('falls back when retrieval returns no usable context', async () => {
    const retrieveWithCitations = vi.fn().mockResolvedValue({
      promptContext: '',
      citations: [],
    });
    const getKnowledgeReadyState = vi.fn().mockResolvedValue(false);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await resolveChatRetrievalContext(
      createConfig({
        rag: {
          enabled: true,
          retrievalScope: 'knowledge_base',
          enableOcr: false,
          embeddingProvider: 'qwen',
          embeddingModel: 'text-embedding-v2',
          autoReindexPolicy: 'manual',
        },
      }),
      'assistant',
      '如何实现二分查找？',
      'session-1',
      {
        retrieveWithCitations,
        getKnowledgeReadyState,
      },
    );

    expect(result).toBeUndefined();
    expect(retrieveWithCitations).toHaveBeenCalled();
    expect(getKnowledgeReadyState).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalled();
  });

  it('falls back when retrieval throws', async () => {
    const retrieveWithCitations = vi.fn().mockRejectedValue(new Error('network boom'));
    const getKnowledgeReadyState = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveChatRetrievalContext(
      createConfig(),
      'assistant',
      '如何实现二分查找？',
      'session-1',
      {
        retrieveWithCitations,
        getKnowledgeReadyState,
      },
    );

    expect(result).toBeUndefined();
    expect(retrieveWithCitations).toHaveBeenCalledOnce();
    expect(getKnowledgeReadyState).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
