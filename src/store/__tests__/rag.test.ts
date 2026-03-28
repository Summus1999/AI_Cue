import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type {
  CompletedKnowledgeBaseImport,
  KnowledgeBaseImportProgress,
  KnowledgeBaseImportTaskSnapshot,
  KnowledgeBaseRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  RagStats,
  SearchResult,
} from '../../services/ragService';
import { createRagState, type RagState } from '../rag';

function createKnowledgeBase(id: string, name: string): KnowledgeBaseRecord {
  return {
    id,
    name,
    description: '',
    documentCount: 1,
    createdAt: 1,
    updatedAt: 2,
  };
}

function createDocument(
  id: string,
  knowledgeBaseId: string,
  overrides: Partial<KnowledgeDocumentRecord> = {},
): KnowledgeDocumentRecord {
  return {
    id,
    knowledgeBaseId,
    title: `Document ${id}`,
    fileName: `${id}.md`,
    fileExtension: 'md',
    documentType: 'markdown',
    sourcePath: `C:/docs/${id}.md`,
    sourceByteSize: 128,
    sourceModifiedAt: 3,
    contentHash: `hash-${id}`,
    fingerprint: `fingerprint-${id}`,
    indexState: 'ready',
    lastError: null,
    chunkCount: 2,
    embeddingCount: 2,
    createdAt: 4,
    updatedAt: 5,
    indexedAt: 6,
    ...overrides,
  };
}

function createChunk(documentId: string): KnowledgeChunkRecord {
  return {
    id: `chunk-${documentId}`,
    documentId,
    chunkIndex: 0,
    text: 'chunk text',
    chunkType: 'text',
    headingPath: ['Intro'],
    pageNumber: 1,
    language: null,
    startOffset: 0,
    endOffset: 10,
    blockCount: 1,
    createdAt: 7,
  };
}

function createTaskSnapshot(
  requestId: string,
  documentId: string,
  status: KnowledgeBaseImportTaskSnapshot['status'],
): KnowledgeBaseImportTaskSnapshot {
  return {
    requestId,
    operation: 'reindex',
    stage: status === 'completed' ? 'finalize' : 'embed',
    status,
    current: status === 'completed' ? 2 : 1,
    total: 2,
    knowledgeBaseId: 'kb-1',
    documentId,
    fileName: 'doc-1.md',
    sourcePath: 'C:/docs/doc-1.md',
    chunkCount: 2,
    embeddingCount: 2,
    message: status === 'completed' ? 'done' : 'embedding',
    startedAt: 10,
    updatedAt: 20,
    finishedAt: status === 'completed' ? 30 : null,
  };
}

function createCompletedImport(document: KnowledgeDocumentRecord): CompletedKnowledgeBaseImport {
  return {
    document,
    parsedDocument: {
      metadata: {
        sourcePath: document.sourcePath,
        fileName: document.fileName,
        extension: document.fileExtension,
        title: document.title,
        documentType: 'markdown',
        byteSize: document.sourceByteSize,
        language: null,
      },
      blocks: [],
      totalChars: 0,
      totalPages: null,
    },
    chunks: [],
    persistedChunks: [createChunk(document.id)],
    persistedEmbeddings: [],
  };
}

function createMockService(overrides: Partial<Parameters<typeof createRagState>[0]> = {}) {
  const stats: RagStats = {
    total_embeddings: 0,
    total_messages: 0,
    storage_bytes: 0,
    model_id: null,
  };
  const searchResults: SearchResult[] = [];

  return {
    search: vi.fn().mockResolvedValue(searchResults),
    getContext: vi.fn().mockResolvedValue(''),
    embedMessage: vi.fn().mockResolvedValue(true),
    getStats: vi.fn().mockResolvedValue(stats),
    createKnowledgeBase: vi.fn(),
    listKnowledgeBases: vi.fn().mockResolvedValue([]),
    deleteKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    listKnowledgeDocuments: vi.fn().mockResolvedValue([]),
    getKnowledgeDocument: vi.fn().mockResolvedValue(null),
    listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([]),
    deleteKnowledgeDocument: vi.fn().mockResolvedValue(undefined),
    importKnowledgeDocument: vi.fn(),
    reindexKnowledgeDocument: vi.fn(),
    listKnowledgeImportTasks: vi.fn().mockResolvedValue([]),
    getKnowledgeImportTask: vi.fn().mockResolvedValue(null),
    createKnowledgeBaseImportProgressId: vi.fn().mockReturnValue('req-1'),
    ...overrides,
  } satisfies Parameters<typeof createRagState>[0];
}

describe('useRagStore state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores knowledge bases and selects the first available one', async () => {
    const service = createMockService({
      listKnowledgeBases: vi.fn().mockResolvedValue([
        createKnowledgeBase('kb-1', 'Algorithms'),
        createKnowledgeBase('kb-2', 'System Design'),
      ]),
    });
    const store = createStore<RagState>(createRagState(service));

    const knowledgeBases = await store.getState().refreshKnowledgeBases();

    expect(knowledgeBases).toHaveLength(2);
    expect(store.getState().knowledgeBases.map((item) => item.id)).toEqual(['kb-1', 'kb-2']);
    expect(store.getState().currentKnowledgeBaseId).toBe('kb-1');
    expect(store.getState().isLoadingKnowledgeBases).toBe(false);
  });

  it('stores knowledge documents, document detail, and chunk preview', async () => {
    const document = createDocument('doc-1', 'kb-1');
    const service = createMockService({
      listKnowledgeDocuments: vi.fn().mockResolvedValue([document]),
      getKnowledgeDocument: vi.fn().mockResolvedValue(document),
      listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([createChunk(document.id)]),
    });
    const store = createStore<RagState>(createRagState(service));

    await store.getState().refreshKnowledgeDocuments('kb-1');
    await store.getState().refreshKnowledgeDocument(document.id);
    await store.getState().refreshKnowledgeDocumentChunks(document.id);

    expect(store.getState().currentKnowledgeBaseId).toBe('kb-1');
    expect(store.getState().currentDocumentId).toBe('doc-1');
    expect(store.getState().knowledgeDocumentsByKnowledgeBaseId['kb-1']).toHaveLength(1);
    expect(store.getState().knowledgeDocumentDetailsById['doc-1']).toEqual(document);
    expect(store.getState().knowledgeDocumentChunksById['doc-1'][0]?.documentId).toBe('doc-1');
  });

  it('stores backend task snapshots and exposes reindex state by document', async () => {
    const task = createTaskSnapshot('req-1', 'doc-1', 'running');
    const service = createMockService({
      listKnowledgeImportTasks: vi.fn().mockResolvedValue([task]),
    });
    const store = createStore<RagState>(createRagState(service));

    await store.getState().refreshKnowledgeImportTasks('kb-1');

    expect(store.getState().importTasksByRequestId['req-1']).toEqual(task);
    expect(store.getState().latestTaskRequestIdByDocumentId['doc-1']).toBe('req-1');
    expect(store.getState().reindexStatesByDocumentId['doc-1']).toMatchObject({
      requestId: 'req-1',
      status: 'running',
      stage: 'embed',
    });
    expect(store.getState().isReindexingByDocumentId['doc-1']).toBe(true);
  });

  it('tracks reindex progress and refreshes document state after completion', async () => {
    const document = createDocument('doc-1', 'kb-1');
    const runningProgress: KnowledgeBaseImportProgress = {
      requestId: 'req-1',
      operation: 'reindex',
      stage: 'embed',
      status: 'running',
      current: 1,
      total: 2,
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-1',
      fileName: 'doc-1.md',
      sourcePath: document.sourcePath,
      chunkCount: 2,
      embeddingCount: 2,
      message: 'embedding',
    };
    const completedTask = createTaskSnapshot('req-1', 'doc-1', 'completed');

    const service = createMockService({
      reindexKnowledgeDocument: vi.fn().mockImplementation(async (_request, onProgress) => {
        onProgress?.(runningProgress);
        return createCompletedImport(document);
      }),
      getKnowledgeImportTask: vi.fn().mockResolvedValue(completedTask),
      listKnowledgeDocuments: vi.fn().mockResolvedValue([document]),
      getKnowledgeDocument: vi.fn().mockResolvedValue(document),
      listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([createChunk(document.id)]),
    });
    const store = createStore<RagState>(createRagState(service));

    const result = await store.getState().reindexKnowledgeDocument({
      documentId: 'doc-1',
    });

    expect(result.document.id).toBe('doc-1');
    expect(store.getState().currentKnowledgeBaseId).toBe('kb-1');
    expect(store.getState().currentDocumentId).toBe('doc-1');
    expect(store.getState().activeImportProgressByRequestId['req-1']).toBeUndefined();
    expect(store.getState().reindexStatesByDocumentId['doc-1']).toMatchObject({
      requestId: 'req-1',
      status: 'completed',
      stage: 'finalize',
    });
    expect(store.getState().isReindexingByDocumentId['doc-1']).toBe(false);
  });
});
