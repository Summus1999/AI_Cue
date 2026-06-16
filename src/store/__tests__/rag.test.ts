import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type {
  CompletedKnowledgeBaseImport,
  CompletedKnowledgeBaseReindex,
  KnowledgeBaseImportProgress,
  KnowledgeBaseImportTaskSnapshot,
  KnowledgeBaseRecord,
  KnowledgeBaseStatsRecord,
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

function createKnowledgeBaseStats(
  knowledgeBaseId: string,
  overrides: Partial<KnowledgeBaseStatsRecord> = {},
): KnowledgeBaseStatsRecord {
  return {
    knowledgeBaseId,
    documentCount: 1,
    chunkCount: 2,
    embeddingCount: 2,
    sourceBytes: 128,
    chunkBytes: 32,
    embeddingBytes: 24,
    storageBytes: 184,
    latestIndexedModelId: 'mock-kb-model',
    latestIndexedAt: 42,
    ...overrides,
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

function createCompletedReindex(
  knowledgeBaseId: string,
  documents: KnowledgeDocumentRecord[],
  failures: CompletedKnowledgeBaseReindex['failures'] = [],
): CompletedKnowledgeBaseReindex {
  return {
    knowledgeBaseId,
    documents: documents.map((document) => createCompletedImport(document)),
    failures,
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
    getKnowledgeBaseStats: vi.fn().mockResolvedValue(null),
    deleteKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    listKnowledgeDocuments: vi.fn().mockResolvedValue([]),
    getKnowledgeDocument: vi.fn().mockResolvedValue(null),
    listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([]),
    deleteKnowledgeDocument: vi.fn().mockResolvedValue(undefined),
    importKnowledgeDocument: vi.fn(),
    reindexKnowledgeBase: vi.fn(),
    retryKnowledgeBaseDocuments: vi.fn(),
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

  it('keeps the real knowledge-base list error message instead of collapsing to a generic fallback', async () => {
    const service = createMockService({
      listKnowledgeBases: vi.fn().mockRejectedValue('invoke failed: no such table: knowledge_bases'),
    });
    const store = createStore<RagState>(createRagState(service));

    await expect(store.getState().refreshKnowledgeBases()).rejects.toBe(
      'invoke failed: no such table: knowledge_bases',
    );

    expect(store.getState().knowledgeBaseListError).toBe(
      'invoke failed: no such table: knowledge_bases',
    );
    expect(store.getState().error).toBeNull();
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

  it('stores knowledge-base aggregate stats for the selected knowledge base', async () => {
    const stats = createKnowledgeBaseStats('kb-1', {
      documentCount: 3,
      chunkCount: 12,
      embeddingCount: 12,
      storageBytes: 4096,
      latestIndexedModelId: 'text-embedding-3-large',
    });
    const service = createMockService({
      getKnowledgeBaseStats: vi.fn().mockResolvedValue(stats),
    });
    const store = createStore<RagState>(createRagState(service));
    store.setState({
      ...store.getState(),
      currentKnowledgeBaseId: 'kb-1',
    });

    const result = await store.getState().refreshKnowledgeBaseStats();

    expect(result).toEqual(stats);
    expect(store.getState().knowledgeBaseStatsById['kb-1']).toEqual(stats);
    expect(store.getState().isLoadingKnowledgeBaseStatsById['kb-1']).toBe(false);
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

  it('tracks knowledge-base reindex progress and preserves per-document task state', async () => {
    const firstDocument = createDocument('doc-1', 'kb-1');
    const secondDocument = createDocument('doc-2', 'kb-1');
    const runningProgress: KnowledgeBaseImportProgress = {
      requestId: 'batch-1:doc-1',
      operation: 'reindex',
      stage: 'chunk',
      status: 'running',
      current: 2,
      total: 4,
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-1',
      fileName: firstDocument.fileName,
      sourcePath: firstDocument.sourcePath,
      chunkCount: 2,
      embeddingCount: null,
      message: 'chunking',
    };
    const completedTask = createTaskSnapshot('batch-1:doc-1', 'doc-1', 'completed');

    const service = createMockService({
      reindexKnowledgeBase: vi.fn().mockImplementation(async (_request, onProgress) => {
        onProgress?.(runningProgress);
        return createCompletedReindex('kb-1', [firstDocument, secondDocument], [
          {
            documentId: 'doc-2',
            fileName: secondDocument.fileName,
            sourcePath: secondDocument.sourcePath,
            error: 'parse failed',
          },
        ]);
      }),
      listKnowledgeImportTasks: vi.fn().mockResolvedValue([completedTask]),
      listKnowledgeBases: vi.fn().mockResolvedValue([createKnowledgeBase('kb-1', 'Algorithms')]),
      getKnowledgeBaseStats: vi.fn().mockResolvedValue(
        createKnowledgeBaseStats('kb-1', {
          documentCount: 2,
          chunkCount: 4,
          embeddingCount: 4,
        }),
      ),
      listKnowledgeDocuments: vi.fn().mockResolvedValue([firstDocument, secondDocument]),
      getKnowledgeDocument: vi.fn().mockResolvedValue(firstDocument),
      listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([createChunk(firstDocument.id)]),
    });
    const store = createStore<RagState>(createRagState(service));
    store.setState({
      ...store.getState(),
      currentKnowledgeBaseId: 'kb-1',
      currentDocumentId: 'doc-1',
    });

    const result = await store.getState().reindexKnowledgeBase({
      knowledgeBaseId: 'kb-1',
    });

    expect(result.documents).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(store.getState().isReindexingKnowledgeBaseById['kb-1']).toBe(false);
    expect(store.getState().reindexStatesByDocumentId['doc-1']).toMatchObject({
      requestId: 'batch-1:doc-1',
      status: 'completed',
    });
    expect(store.getState().knowledgeBaseStatsById['kb-1']).toMatchObject({
      documentCount: 2,
      chunkCount: 4,
      embeddingCount: 4,
    });
    expect(store.getState().error).toContain('1 个文档失败');
    expect(store.getState().error).toContain('parse failed');
  });

  it('tracks retry progress for pending and failed documents in a knowledge base', async () => {
    const failedDocument = createDocument('doc-failed', 'kb-1', { indexState: 'failed' });
    const pendingDocument = createDocument('doc-pending', 'kb-1', { indexState: 'pending' });
    const runningProgress: KnowledgeBaseImportProgress = {
      requestId: 'retry-1:doc-failed',
      operation: 'reindex',
      stage: 'parse',
      status: 'running',
      current: 1,
      total: 4,
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-failed',
      fileName: failedDocument.fileName,
      sourcePath: failedDocument.sourcePath,
      chunkCount: null,
      embeddingCount: null,
      message: 'parsing',
    };
    const completedTask = createTaskSnapshot('retry-1:doc-failed', 'doc-failed', 'completed');

    const service = createMockService({
      retryKnowledgeBaseDocuments: vi.fn().mockImplementation(async (_request, onProgress) => {
        onProgress?.(runningProgress);
        return createCompletedReindex('kb-1', [failedDocument, pendingDocument], []);
      }),
      listKnowledgeImportTasks: vi.fn().mockResolvedValue([completedTask]),
      listKnowledgeBases: vi.fn().mockResolvedValue([createKnowledgeBase('kb-1', 'Algorithms')]),
      listKnowledgeDocuments: vi.fn().mockResolvedValue([failedDocument, pendingDocument]),
      getKnowledgeDocument: vi.fn().mockResolvedValue(failedDocument),
      listKnowledgeDocumentChunks: vi.fn().mockResolvedValue([createChunk(failedDocument.id)]),
    });
    const store = createStore<RagState>(createRagState(service));
    store.setState({
      ...store.getState(),
      currentKnowledgeBaseId: 'kb-1',
      currentDocumentId: 'doc-failed',
    });

    const result = await store.getState().retryKnowledgeBaseDocuments({
      knowledgeBaseId: 'kb-1',
    });

    expect(result.documents).toHaveLength(2);
    expect(store.getState().isRetryingKnowledgeBaseById['kb-1']).toBe(false);
    expect(store.getState().reindexStatesByDocumentId['doc-failed']).toMatchObject({
      requestId: 'retry-1:doc-failed',
      status: 'completed',
    });
  });
});
