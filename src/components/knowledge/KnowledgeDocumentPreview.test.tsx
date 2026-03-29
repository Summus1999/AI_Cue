// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseRagStore = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());

vi.mock('../../store/rag', () => ({
  useRagStore: mockUseRagStore,
}));

vi.mock('../../store/config', () => ({
  loadConfig: mockLoadConfig,
}));

import { KnowledgeDocumentPreview } from './KnowledgeDocumentPreview';

function createDocument() {
  return {
    id: 'doc-1',
    knowledgeBaseId: 'kb-1',
    title: 'Rust Ownership',
    fileName: 'ownership.md',
    fileExtension: 'md',
    documentType: 'markdown',
    sourcePath: 'C:/docs/ownership.md',
    sourceByteSize: 1024,
    sourceModifiedAt: 1,
    contentHash: 'hash-doc-1',
    fingerprint: 'fp-doc-1',
    indexState: 'failed' as const,
    lastError: 'embedding timeout',
    chunkCount: 2,
    embeddingCount: 2,
    createdAt: 1,
    updatedAt: new Date('2026-03-29T10:00:00+08:00').getTime(),
    indexedAt: new Date('2026-03-29T10:05:00+08:00').getTime(),
  };
}

function createChunks() {
  return [
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      chunkIndex: 0,
      text: 'Ownership rules the borrow checker.',
      chunkType: 'text',
      headingPath: ['Intro'],
      pageNumber: 1,
      language: null,
      startOffset: 0,
      endOffset: 36,
      blockCount: 1,
      createdAt: 1,
    },
    {
      id: 'chunk-2',
      documentId: 'doc-1',
      chunkIndex: 1,
      text: 'fn main() { println!("hello"); }',
      chunkType: 'code_block',
      headingPath: ['Examples'],
      pageNumber: null,
      language: 'rust',
      startOffset: 37,
      endOffset: 69,
      blockCount: 1,
      createdAt: 2,
    },
  ];
}

function createPreviewStore() {
  return {
    clearError: vi.fn(),
    deleteKnowledgeDocument: vi.fn().mockResolvedValue(undefined),
    isDeletingKnowledgeDocumentById: {
      'doc-1': false,
    },
    isReindexingByDocumentId: {
      'doc-1': false,
    },
    reindexKnowledgeDocument: vi.fn().mockResolvedValue({}),
    reindexStatesByDocumentId: {
      'doc-1': {
        requestId: 'req-1',
        stage: 'embed',
        status: 'running',
        current: 2,
        total: 4,
        message: '正在重建向量',
        updatedAt: 10,
      },
    },
  };
}

describe('KnowledgeDocumentPreview', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue({
      rag: {
        enableOcr: false,
      },
    });
  });

  it('renders empty placeholder when no document is selected', () => {
    mockUseRagStore.mockReturnValue(createPreviewStore());

    render(
      <KnowledgeDocumentPreview
        knowledgeBaseId="kb-1"
        document={null}
        chunks={[]}
        isLoadingDocument={false}
        isLoadingChunks={false}
      />,
    );

    expect(screen.getByText('先从左侧选择一个文档，右侧会展示文档详情和 chunk 预览。')).toBeTruthy();
  });

  it('renders document metadata, reindex progress, chunk preview, and action handlers', async () => {
    const store = createPreviewStore();
    const document = createDocument();
    mockUseRagStore.mockReturnValue(store);

    render(
      <KnowledgeDocumentPreview
        knowledgeBaseId="kb-1"
        document={document}
        chunks={createChunks()}
        isLoadingDocument={false}
        isLoadingChunks={false}
      />,
    );

    expect(screen.getByText('Rust Ownership')).toBeTruthy();
    expect(screen.getByText('最近重建索引状态：进行中')).toBeTruthy();
    expect(screen.getByText('阶段：向量化 · 正在重建向量')).toBeTruthy();
    expect(screen.getByText('Ownership rules the borrow checker.')).toBeTruthy();
    expect(screen.getByText('代码 · rust')).toBeTruthy();
    expect(screen.getByText('embedding timeout')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重建索引' }));
    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalled();
      expect(store.reindexKnowledgeDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        parseOptions: {
          enableOcr: false,
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '删除文档' }));
    expect(screen.getByRole('button', { name: '确认删除文档' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确认删除文档' }));
    await waitFor(() => {
      expect(store.deleteKnowledgeDocument).toHaveBeenCalledWith('doc-1', 'kb-1');
    });

    expect(store.clearError).toHaveBeenCalled();
  });
});
