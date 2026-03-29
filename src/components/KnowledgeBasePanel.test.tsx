// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseRagStore = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockImportPanelProps = vi.hoisted(() => vi.fn());
const mockDocumentListProps = vi.hoisted(() => vi.fn());
const mockDocumentPreviewProps = vi.hoisted(() => vi.fn());

vi.mock('../store/rag', () => ({
  useRagStore: mockUseRagStore,
}));

vi.mock('../store/config', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('./knowledge/KnowledgeImportPanel', () => ({
  KnowledgeImportPanel: (props: unknown) => {
    mockImportPanelProps(props);
    return <div data-testid="knowledge-import-panel" />;
  },
}));

vi.mock('./knowledge/KnowledgeDocumentList', () => ({
  KnowledgeDocumentList: (props: unknown) => {
    mockDocumentListProps(props);
    return <div data-testid="knowledge-document-list" />;
  },
}));

vi.mock('./knowledge/KnowledgeDocumentPreview', () => ({
  KnowledgeDocumentPreview: (props: unknown) => {
    mockDocumentPreviewProps(props);
    return <div data-testid="knowledge-document-preview" />;
  },
}));

import { KnowledgeBasePanel } from './KnowledgeBasePanel';

function createKnowledgeBase(id: string, name: string, documentCount: number) {
  return {
    id,
    name,
    description: '',
    documentCount,
    createdAt: 1,
    updatedAt: 2,
  };
}

function createKnowledgeBaseStats(knowledgeBaseId: string) {
  return {
    knowledgeBaseId,
    documentCount: 2,
    chunkCount: 8,
    embeddingCount: 8,
    sourceBytes: 1024,
    chunkBytes: 256,
    embeddingBytes: 128,
    storageBytes: 3072,
    latestIndexedModelId: 'mock-embed-v2',
    latestIndexedAt: new Date('2026-03-29T12:30:00+08:00').getTime(),
  };
}

function createDocument(
  id: string,
  knowledgeBaseId: string,
  indexState: 'ready' | 'failed' = 'ready',
  lastError: string | null = null,
) {
  return {
    id,
    knowledgeBaseId,
    title: `Document ${id}`,
    fileName: `${id}.md`,
    fileExtension: 'md',
    documentType: 'markdown',
    sourcePath: `C:/docs/${id}.md`,
    sourceByteSize: 512,
    sourceModifiedAt: 1,
    contentHash: `hash-${id}`,
    fingerprint: `fp-${id}`,
    indexState,
    lastError,
    chunkCount: 2,
    embeddingCount: 2,
    createdAt: 2,
    updatedAt: 3,
    indexedAt: 4,
  };
}

function createPanelStore() {
  const kb1 = createKnowledgeBase('kb-1', 'Algorithms', 2);
  const kb2 = createKnowledgeBase('kb-2', 'System Design', 1);
  const doc1 = createDocument('doc-1', 'kb-1');
  const doc2 = createDocument('doc-2', 'kb-1', 'failed', 'embedding failed');

  return {
    knowledgeBases: [kb1, kb2],
    currentKnowledgeBaseId: 'kb-1',
    currentDocumentId: 'doc-1',
    knowledgeBaseStatsById: {
      'kb-1': createKnowledgeBaseStats('kb-1'),
    },
    isLoadingKnowledgeBases: false,
    isLoadingKnowledgeBaseStatsById: {
      'kb-1': false,
    },
    isLoadingKnowledgeDocumentDetailsById: {
      'doc-1': false,
    },
    isLoadingKnowledgeDocumentsByKnowledgeBaseId: {
      'kb-1': false,
    },
    isLoadingKnowledgeDocumentChunksById: {
      'doc-1': false,
    },
    isDeletingKnowledgeBaseById: {
      'kb-1': false,
    },
    isReindexingKnowledgeBaseById: {
      'kb-1': false,
    },
    isRetryingKnowledgeBaseById: {
      'kb-1': false,
    },
    knowledgeDocumentDetailsById: {
      'doc-1': doc1,
    },
    knowledgeDocumentsByKnowledgeBaseId: {
      'kb-1': [doc1, doc2],
    },
    knowledgeDocumentChunksById: {
      'doc-1': [
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          chunkIndex: 0,
          text: 'chunk text',
          chunkType: 'text',
          headingPath: ['Intro'],
          pageNumber: 1,
          language: null,
          startOffset: 0,
          endOffset: 10,
          blockCount: 1,
          createdAt: 5,
        },
      ],
    },
    error: null,
    clearError: vi.fn(),
    deleteKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    reindexKnowledgeBase: vi.fn().mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      documents: [],
      failures: [],
    }),
    retryKnowledgeBaseDocuments: vi.fn().mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      documents: [],
      failures: [],
    }),
    refreshKnowledgeBases: vi.fn().mockResolvedValue([kb1, kb2]),
    refreshKnowledgeBaseStats: vi.fn().mockResolvedValue(createKnowledgeBaseStats('kb-1')),
    refreshKnowledgeDocument: vi.fn().mockResolvedValue(doc1),
    refreshKnowledgeDocumentChunks: vi.fn().mockResolvedValue([]),
    refreshKnowledgeDocuments: vi.fn().mockResolvedValue([doc1, doc2]),
    setCurrentKnowledgeBase: vi.fn(),
    setCurrentDocument: vi.fn(),
  };
}

describe('KnowledgeBasePanel', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue({
      rag: {
        enableOcr: true,
      },
    });
  });

  it('renders selected knowledge base summary and wires child panels', async () => {
    const store = createPanelStore();
    mockUseRagStore.mockReturnValue(store);

    render(<KnowledgeBasePanel onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Algorithms' })).toBeTruthy();
    expect(screen.getByText('mock-embed-v2')).toBeTruthy();
    expect(screen.getByText('3.00 KB')).toBeTruthy();

    await waitFor(() => {
      expect(store.refreshKnowledgeBaseStats).toHaveBeenCalledWith('kb-1');
      expect(store.refreshKnowledgeDocuments).toHaveBeenCalledWith('kb-1');
      expect(store.refreshKnowledgeDocument).toHaveBeenCalledWith('doc-1');
      expect(store.refreshKnowledgeDocumentChunks).toHaveBeenCalledWith('doc-1');
    });

    const importPanelProps = mockImportPanelProps.mock.calls[mockImportPanelProps.mock.calls.length - 1]?.[0] as {
      knowledgeBaseId: string | null;
      knowledgeBaseName?: string | null;
    };
    expect(importPanelProps.knowledgeBaseId).toBe('kb-1');
    expect(importPanelProps.knowledgeBaseName).toBe('Algorithms');

    const documentListProps = mockDocumentListProps.mock.calls[mockDocumentListProps.mock.calls.length - 1]?.[0] as {
      documents: Array<{ id: string }>;
      currentDocumentId: string | null;
    };
    expect(documentListProps.currentDocumentId).toBe('doc-1');
    expect(documentListProps.documents).toHaveLength(2);

    fireEvent.click(screen.getByText('System Design'));
    expect(store.setCurrentKnowledgeBase).toHaveBeenCalledWith('kb-2');
  });

  it('handles retry, reindex, and confirmed delete actions for the current knowledge base', async () => {
    const store = createPanelStore();
    mockUseRagStore.mockReturnValue(store);

    render(<KnowledgeBasePanel onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重试异常文档 (1)' }));
    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalled();
      expect(store.retryKnowledgeBaseDocuments).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-1',
        parseOptions: {
          enableOcr: true,
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '重建当前知识库' }));
    await waitFor(() => {
      expect(store.reindexKnowledgeBase).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-1',
        parseOptions: {
          enableOcr: true,
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '删除当前知识库' }));
    expect(screen.getByRole('button', { name: '确认删除知识库' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确认删除知识库' }));
    await waitFor(() => {
      expect(store.deleteKnowledgeBase).toHaveBeenCalledWith('kb-1');
    });

    expect(store.clearError).toHaveBeenCalled();
  });
});
