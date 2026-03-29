// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseRagStore = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockDialogOpen = vi.hoisted(() => vi.fn());
const mockCreateProgressId = vi.hoisted(() => vi.fn());

vi.mock('../../store/rag', () => ({
  useRagStore: mockUseRagStore,
}));

vi.mock('../../store/config', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mockDialogOpen,
}));

vi.mock('../../services/ragService', async () => ({
  ragService: {
    createKnowledgeBaseImportProgressId: mockCreateProgressId,
  },
}));

import { KnowledgeImportPanel } from './KnowledgeImportPanel';

function createCompletedImport() {
  return {
    document: {
      id: 'doc-1',
      knowledgeBaseId: 'kb-1',
      title: 'Imported',
      fileName: 'imported.md',
      fileExtension: 'md',
      documentType: 'markdown',
      sourcePath: 'C:/docs/imported.md',
      sourceByteSize: 128,
      sourceModifiedAt: 1,
      contentHash: 'hash',
      fingerprint: 'fp',
      indexState: 'ready',
      lastError: null,
      chunkCount: 1,
      embeddingCount: 1,
      createdAt: 1,
      updatedAt: 1,
      indexedAt: 1,
    },
    parsedDocument: {
      metadata: {
        sourcePath: 'C:/docs/imported.md',
        fileName: 'imported.md',
        extension: 'md',
        title: 'Imported',
        documentType: 'markdown',
        byteSize: 128,
        language: null,
      },
      blocks: [],
      totalChars: 0,
      totalPages: null,
    },
    chunks: [],
    persistedChunks: [],
    persistedEmbeddings: [],
  };
}

function createImportTask(requestId: string) {
  return {
    requestId,
    operation: 'import' as const,
    stage: 'embed' as const,
    status: 'running' as const,
    current: 2,
    total: 4,
    knowledgeBaseId: 'kb-1',
    documentId: 'doc-1',
    fileName: 'server-task.md',
    sourcePath: 'C:/docs/server-task.md',
    chunkCount: 12,
    embeddingCount: 8,
    message: '正在写入向量',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: null,
  };
}

function createImportStore() {
  return {
    error: null,
    clearError: vi.fn(),
    importTasksByRequestId: {},
    isImportingByKnowledgeBaseId: {
      'kb-1': false,
    },
    refreshKnowledgeImportTasks: vi.fn().mockResolvedValue([]),
    importKnowledgeDocument: vi.fn().mockResolvedValue(createCompletedImport()),
  };
}

describe('KnowledgeImportPanel', () => {
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

  it('queues selected files and dispatches sequential imports with OCR config', async () => {
    const store = createImportStore();
    mockUseRagStore.mockReturnValue(store);
    mockDialogOpen.mockResolvedValue(['C:/docs/alpha.md', 'C:/docs/beta.pdf']);
    mockCreateProgressId
      .mockReturnValueOnce('req-1')
      .mockReturnValueOnce('req-2');

    render(<KnowledgeImportPanel knowledgeBaseId="kb-1" knowledgeBaseName="Algorithms" />);

    await waitFor(() => {
      expect(store.refreshKnowledgeImportTasks).toHaveBeenCalledWith('kb-1', undefined, true);
    });

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    await waitFor(() => {
      expect(screen.getByText('alpha.md')).toBeTruthy();
      expect(screen.getByText('beta.pdf')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '导入选中 (2)' }));
    await waitFor(() => {
      expect(store.importKnowledgeDocument).toHaveBeenNthCalledWith(1, {
        knowledgeBaseId: 'kb-1',
        path: 'C:/docs/alpha.md',
        parseOptions: {
          enableOcr: true,
        },
        progressEventId: 'req-1',
      });
      expect(store.importKnowledgeDocument).toHaveBeenNthCalledWith(2, {
        knowledgeBaseId: 'kb-1',
        path: 'C:/docs/beta.pdf',
        parseOptions: {
          enableOcr: true,
        },
        progressEventId: 'req-2',
      });
    });

    expect(screen.getAllByText('等待中').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('乐观状态')).toHaveLength(2);
    expect(store.refreshKnowledgeImportTasks.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders backend import task snapshots with real progress metadata', () => {
    const store = createImportStore();
    store.importTasksByRequestId = {
      'req-server': createImportTask('req-server'),
    };
    mockUseRagStore.mockReturnValue(store);

    render(<KnowledgeImportPanel knowledgeBaseId="kb-1" knowledgeBaseName="Algorithms" />);

    expect(screen.getByText('server-task.md')).toBeTruthy();
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.getByText('阶段：向量化')).toBeTruthy();
    expect(screen.getByText('12 个 chunk')).toBeTruthy();
    expect(screen.getByText('8 个 embedding')).toBeTruthy();
    expect(screen.getByText('正在写入向量')).toBeTruthy();
  });

  it('keeps failed optimistic rows visible when import fails', async () => {
    const store = createImportStore();
    store.importKnowledgeDocument = vi.fn().mockRejectedValue(new Error('embedding failed'));
    mockUseRagStore.mockReturnValue(store);
    mockDialogOpen.mockResolvedValue('C:/docs/failure.md');
    mockCreateProgressId.mockReturnValue('req-fail');

    render(<KnowledgeImportPanel knowledgeBaseId="kb-1" knowledgeBaseName="Algorithms" />);

    fireEvent.click(screen.getByRole('button', { name: /^选择文件$/ }));
    await waitFor(() => {
      expect(screen.getByText('failure.md')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '导入选中 (1)' }));
    await waitFor(() => {
      expect(screen.getByText('失败')).toBeTruthy();
      expect(screen.getByText('embedding failed')).toBeTruthy();
    });
  });
});
