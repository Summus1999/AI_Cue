import { describe, expect, it } from 'vitest';

import type { CitationMetadata } from '../ragService';
import {
  buildContinueGenerationPlan,
  buildRetryMessagePlan,
} from '../chatReplay';

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

describe('chat replay planning', () => {
  it('builds a continue-generation plan from the original user query', () => {
    const plan = buildContinueGenerationPlan(
      [
        {
          id: 'u1',
          role: 'user',
          content: '请解释二分查找的边界处理',
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '可以先定义左右边界，然后在循环中持续收缩区间',
          sourceUserMessageId: 'u1',
          retrievalQuery: '请解释二分查找的边界处理',
          citations: [sampleCitation],
        },
      ],
      'a1',
    );

    expect(plan).toMatchObject({
      userContent: '请解释二分查找的边界处理',
      userMessageId: 'u1',
      retrievalQuery: '请解释二分查找的边界处理',
      existingAssistantContentPrefix: '可以先定义左右边界，然后在循环中持续收缩区间',
      fallbackCitations: [sampleCitation],
    });
    expect(plan?.requestText).toContain('请继续完成这个回答');
    expect(plan?.baseMessages).toHaveLength(1);
  });

  it('builds a retry plan that preserves the original screenshot and request metadata', () => {
    const plan = buildRetryMessagePlan(
      [
        {
          id: 'u1',
          role: 'user',
          content: '📷 [已发送截图]',
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '这里应该用双指针。',
          sourceUserMessageId: 'u1',
          requestText: '请识别截图中的算法题',
          requestContentPrefix: '这里应该用双指针。',
          citations: [sampleCitation],
        },
      ],
      'a1',
      'fallback request text',
      'latest-image-base64',
    );

    expect(plan).toMatchObject({
      userContent: '📷 [已发送截图]',
      userMessageId: 'u1',
      requestText: '请识别截图中的算法题',
      requestImageBase64: 'latest-image-base64',
      retrievalQuery: '📷 [已发送截图]',
      existingAssistantContentPrefix: '这里应该用双指针。',
      fallbackCitations: [sampleCitation],
    });
  });
});
