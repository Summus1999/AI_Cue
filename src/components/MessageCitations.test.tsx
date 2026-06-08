// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageCitations } from './MessageCitations';
import type { CitationMetadata } from '../services/ragService';

describe('MessageCitations', () => {
  it('renders personal memory citations with the correct source label', () => {
    const citations: CitationMetadata[] = [
      {
        index: 1,
        knowledgeBaseId: null,
        documentId: null,
        chunkId: 'memory:memory-1',
        title: '',
        snippet: '用户擅长用项目经历解释 Redis AOF 重写。',
        pageNumber: null,
        headingPath: [],
        score: 0.92,
        sourceKind: 'PersonalMemory',
      },
    ];

    render(<MessageCitations citations={citations} />);

    expect(screen.getAllByText('个人记忆')).toHaveLength(2);
    expect(screen.queryByText('知识库')).toBeNull();
    expect(screen.getByText('用户擅长用项目经历解释 Redis AOF 重写。')).toBeTruthy();
  });
});
