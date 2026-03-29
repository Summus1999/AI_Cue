// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeDocumentList } from './KnowledgeDocumentList';

function createDocument(
  id: string,
  indexState: 'ready' | 'failed',
  lastError: string | null = null,
) {
  return {
    id,
    knowledgeBaseId: 'kb-1',
    title: `Document ${id}`,
    fileName: `${id}.md`,
    fileExtension: 'md',
    documentType: 'markdown',
    sourcePath: `C:/docs/${id}.md`,
    sourceByteSize: 1536,
    sourceModifiedAt: 1,
    contentHash: `hash-${id}`,
    fingerprint: `fp-${id}`,
    indexState,
    lastError,
    chunkCount: 3,
    embeddingCount: 3,
    createdAt: 1,
    updatedAt: Date.now() - 60_000,
    indexedAt: Date.now() - 30_000,
  };
}

describe('KnowledgeDocumentList', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders document states and forwards selection events', () => {
    const onSelectDocument = vi.fn();

    render(
      <KnowledgeDocumentList
        documents={[
          createDocument('doc-1', 'ready'),
          createDocument('doc-2', 'failed', 'embedding failed'),
        ]}
        currentDocumentId="doc-1"
        isLoading={false}
        onSelectDocument={onSelectDocument}
      />,
    );

    expect(screen.getByText('已就绪')).toBeTruthy();
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('embedding failed')).toBeTruthy();
    expect(screen.getByText('当前')).toBeTruthy();

    fireEvent.click(screen.getByText('Document doc-2'));
    expect(onSelectDocument).toHaveBeenCalledWith('doc-2');
  });

  it('renders empty and loading states', () => {
    const { rerender } = render(
      <KnowledgeDocumentList
        documents={[]}
        currentDocumentId={null}
        isLoading
        onSelectDocument={vi.fn()}
      />,
    );

    expect(screen.getByText('正在加载文档列表...')).toBeTruthy();

    rerender(
      <KnowledgeDocumentList
        documents={[]}
        currentDocumentId={null}
        isLoading={false}
        onSelectDocument={vi.fn()}
      />,
    );

    expect(screen.getByText('当前知识库还没有文档。你可以先在上方导入区选择文件并开始导入。')).toBeTruthy();
  });
});
