// RAG 状态管理

import { create, type StateCreator } from 'zustand';
import type {
  CompletedKnowledgeBaseImport,
  CompletedKnowledgeBaseReindex,
  CreateKnowledgeBaseInput,
  KnowledgeBaseImportProgress,
  KnowledgeBaseImportProgressStatus,
  KnowledgeBaseImportRequest,
  KnowledgeBaseImportStage,
  KnowledgeBaseImportTaskSnapshot,
  KnowledgeBaseRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  RagStats,
  ReindexKnowledgeBaseRequest,
  ReindexKnowledgeDocumentRequest,
  SearchResult,
} from '../services/ragService';
import { ragService } from '../services/ragService';

export interface ReindexTaskState {
  requestId: string;
  stage: KnowledgeBaseImportStage;
  status: KnowledgeBaseImportProgressStatus;
  current: number;
  total: number;
  message: string;
  updatedAt: number;
}

export interface RagState {
  // 通用 RAG 状态
  isSearching: boolean;
  isEmbedding: boolean;
  searchResults: SearchResult[];
  ragEnabled: boolean;
  embeddingProgress: number;
  stats: RagStats | null;
  error: string | null;

  // 知识库 UI 状态
  knowledgeBases: KnowledgeBaseRecord[];
  currentKnowledgeBaseId: string | null;
  currentDocumentId: string | null;
  knowledgeDocumentsByKnowledgeBaseId: Record<string, KnowledgeDocumentRecord[]>;
  knowledgeDocumentDetailsById: Record<string, KnowledgeDocumentRecord>;
  knowledgeDocumentChunksById: Record<string, KnowledgeChunkRecord[]>;
  importTasksByRequestId: Record<string, KnowledgeBaseImportTaskSnapshot>;
  activeImportProgressByRequestId: Record<string, KnowledgeBaseImportProgress>;
  latestTaskRequestIdByDocumentId: Record<string, string>;
  reindexStatesByDocumentId: Record<string, ReindexTaskState>;

  // 加载与变更状态
  isLoadingKnowledgeBases: boolean;
  isLoadingKnowledgeDocumentsByKnowledgeBaseId: Record<string, boolean>;
  isLoadingKnowledgeDocumentDetailsById: Record<string, boolean>;
  isLoadingKnowledgeDocumentChunksById: Record<string, boolean>;
  isImportingByKnowledgeBaseId: Record<string, boolean>;
  isReindexingKnowledgeBaseById: Record<string, boolean>;
  isReindexingByDocumentId: Record<string, boolean>;
  isDeletingKnowledgeBaseById: Record<string, boolean>;
  isDeletingKnowledgeDocumentById: Record<string, boolean>;

  // 通用操作
  search: (query: string, limit?: number, sessionId?: string) => Promise<void>;
  getContext: (query: string, maxTokens?: number) => Promise<string>;
  embedMessage: (messageId: string, content: string) => Promise<void>;
  getStats: () => Promise<void>;
  clearResults: () => void;
  setEnabled: (enabled: boolean) => void;
  clearError: () => void;

  // 知识库状态操作
  setCurrentKnowledgeBase: (knowledgeBaseId: string | null) => void;
  setCurrentDocument: (documentId: string | null) => void;
  clearKnowledgeState: () => void;
  refreshKnowledgeBases: () => Promise<KnowledgeBaseRecord[]>;
  createKnowledgeBase: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBaseRecord>;
  deleteKnowledgeBase: (knowledgeBaseId: string) => Promise<void>;
  refreshKnowledgeDocuments: (knowledgeBaseId?: string) => Promise<KnowledgeDocumentRecord[]>;
  refreshKnowledgeDocument: (documentId: string) => Promise<KnowledgeDocumentRecord | null>;
  refreshKnowledgeDocumentChunks: (documentId?: string) => Promise<KnowledgeChunkRecord[]>;
  deleteKnowledgeDocument: (documentId: string, knowledgeBaseId?: string) => Promise<void>;
  refreshKnowledgeImportTasks: (
    knowledgeBaseId?: string,
    documentId?: string,
    includeFinished?: boolean,
  ) => Promise<KnowledgeBaseImportTaskSnapshot[]>;
  refreshKnowledgeImportTask: (requestId: string) => Promise<KnowledgeBaseImportTaskSnapshot | null>;
  importKnowledgeDocument: (
    request: KnowledgeBaseImportRequest,
  ) => Promise<CompletedKnowledgeBaseImport>;
  reindexKnowledgeBase: (
    request: ReindexKnowledgeBaseRequest,
  ) => Promise<CompletedKnowledgeBaseReindex>;
  reindexKnowledgeDocument: (
    request: ReindexKnowledgeDocumentRequest,
  ) => Promise<CompletedKnowledgeBaseImport>;
}

type RagStoreService = Pick<
  typeof ragService,
  | 'search'
  | 'getContext'
  | 'embedMessage'
  | 'getStats'
  | 'createKnowledgeBase'
  | 'listKnowledgeBases'
  | 'deleteKnowledgeBase'
  | 'listKnowledgeDocuments'
  | 'getKnowledgeDocument'
  | 'listKnowledgeDocumentChunks'
  | 'deleteKnowledgeDocument'
  | 'importKnowledgeDocument'
  | 'reindexKnowledgeBase'
  | 'reindexKnowledgeDocument'
  | 'listKnowledgeImportTasks'
  | 'getKnowledgeImportTask'
  | 'createKnowledgeBaseImportProgressId'
>;

function nextKnowledgeBaseId(
  currentKnowledgeBaseId: string | null,
  knowledgeBases: KnowledgeBaseRecord[],
): string | null {
  if (
    currentKnowledgeBaseId
    && knowledgeBases.some((knowledgeBase) => knowledgeBase.id === currentKnowledgeBaseId)
  ) {
    return currentKnowledgeBaseId;
  }

  return knowledgeBases[0]?.id ?? null;
}

function nextDocumentId(
  currentDocumentId: string | null,
  documents: KnowledgeDocumentRecord[],
): string | null {
  if (currentDocumentId && documents.some((document) => document.id === currentDocumentId)) {
    return currentDocumentId;
  }

  return documents[0]?.id ?? null;
}

function mergeTaskSnapshot(
  tasksByRequestId: Record<string, KnowledgeBaseImportTaskSnapshot>,
  task: KnowledgeBaseImportTaskSnapshot,
): Record<string, KnowledgeBaseImportTaskSnapshot> {
  return {
    ...tasksByRequestId,
    [task.requestId]: task,
  };
}

function snapshotFromProgress(
  progress: KnowledgeBaseImportProgress,
  existingTask: KnowledgeBaseImportTaskSnapshot | undefined,
): KnowledgeBaseImportTaskSnapshot | null {
  const requestId = progress.requestId?.trim();
  if (!requestId) {
    return null;
  }

  const now = Date.now();

  return {
    requestId,
    operation: progress.operation,
    stage: progress.stage,
    status: progress.status,
    current: progress.current,
    total: progress.total,
    knowledgeBaseId: progress.knowledgeBaseId,
    documentId: progress.documentId ?? null,
    fileName: progress.fileName ?? null,
    sourcePath: progress.sourcePath ?? null,
    chunkCount: progress.chunkCount ?? null,
    embeddingCount: progress.embeddingCount ?? null,
    message: progress.message,
    startedAt: existingTask?.startedAt ?? now,
    updatedAt: now,
    finishedAt: progress.status === 'running' ? null : now,
  };
}

function buildReindexState(task: KnowledgeBaseImportTaskSnapshot): ReindexTaskState | null {
  if (task.operation !== 'reindex' || !task.documentId) {
    return null;
  }

  return {
    requestId: task.requestId,
    stage: task.stage,
    status: task.status,
    current: task.current,
    total: task.total,
    message: task.message,
    updatedAt: task.updatedAt,
  };
}

function updateTaskState(
  state: RagState,
  task: KnowledgeBaseImportTaskSnapshot,
): Partial<RagState> {
  const importTasksByRequestId = mergeTaskSnapshot(state.importTasksByRequestId, task);
  const activeImportProgressByRequestId = { ...state.activeImportProgressByRequestId };

  if (task.status === 'running') {
    activeImportProgressByRequestId[task.requestId] = {
      requestId: task.requestId,
      operation: task.operation,
      stage: task.stage,
      status: task.status,
      current: task.current,
      total: task.total,
      knowledgeBaseId: task.knowledgeBaseId,
      documentId: task.documentId ?? null,
      fileName: task.fileName ?? null,
      sourcePath: task.sourcePath ?? null,
      chunkCount: task.chunkCount ?? null,
      embeddingCount: task.embeddingCount ?? null,
      message: task.message,
    };
  } else {
    delete activeImportProgressByRequestId[task.requestId];
  }

  const latestTaskRequestIdByDocumentId = { ...state.latestTaskRequestIdByDocumentId };
  if (task.documentId) {
    latestTaskRequestIdByDocumentId[task.documentId] = task.requestId;
  }

  const reindexStatesByDocumentId = { ...state.reindexStatesByDocumentId };
  const isReindexingByDocumentId = { ...state.isReindexingByDocumentId };
  if (task.documentId) {
    const reindexState = buildReindexState(task);
    if (reindexState) {
      reindexStatesByDocumentId[task.documentId] = reindexState;
      isReindexingByDocumentId[task.documentId] = task.status === 'running';
    }
  }

  return {
    importTasksByRequestId,
    activeImportProgressByRequestId,
    latestTaskRequestIdByDocumentId,
    reindexStatesByDocumentId,
    isReindexingByDocumentId,
  };
}

export function createRagState(service: RagStoreService = ragService): StateCreator<RagState> {
  return (set, get) => ({
    // 通用初始状态
    isSearching: false,
    isEmbedding: false,
    searchResults: [],
    ragEnabled: true,
    embeddingProgress: 0,
    stats: null,
    error: null,

    // 知识库初始状态
    knowledgeBases: [],
    currentKnowledgeBaseId: null,
    currentDocumentId: null,
    knowledgeDocumentsByKnowledgeBaseId: {},
    knowledgeDocumentDetailsById: {},
    knowledgeDocumentChunksById: {},
    importTasksByRequestId: {},
    activeImportProgressByRequestId: {},
    latestTaskRequestIdByDocumentId: {},
    reindexStatesByDocumentId: {},

    isLoadingKnowledgeBases: false,
    isLoadingKnowledgeDocumentsByKnowledgeBaseId: {},
    isLoadingKnowledgeDocumentDetailsById: {},
    isLoadingKnowledgeDocumentChunksById: {},
    isImportingByKnowledgeBaseId: {},
    isReindexingKnowledgeBaseById: {},
    isReindexingByDocumentId: {},
    isDeletingKnowledgeBaseById: {},
    isDeletingKnowledgeDocumentById: {},

    search: async (query, limit = 10, sessionId) => {
      if (!query.trim()) {
        set({ searchResults: [], error: null });
        return;
      }

      set({ isSearching: true, error: null });

      try {
        const results = await service.search(query, limit, sessionId);
        set({ searchResults: results, isSearching: false });
      } catch (err) {
        const error = err instanceof Error ? err.message : '搜索失败';
        set({ error, isSearching: false });
      }
    },

    getContext: async (query, maxTokens = 2000) => {
      try {
        return await service.getContext(query, maxTokens);
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取上下文失败';
        set({ error });
        throw new Error(error);
      }
    },

    embedMessage: async (messageId, content) => {
      set({ isEmbedding: true, error: null });

      try {
        await service.embedMessage(messageId, content);
        set({ isEmbedding: false, embeddingProgress: 100 });
        void get().getStats();
      } catch (err) {
        const error = err instanceof Error ? err.message : '向量化失败';
        set({ error, isEmbedding: false });
      }
    },

    getStats: async () => {
      try {
        const stats = await service.getStats();
        set({ stats });
      } catch (err) {
        console.error('获取 RAG 统计失败:', err);
      }
    },

    clearResults: () => {
      set({ searchResults: [], error: null });
    },

    setEnabled: (enabled) => {
      set({ ragEnabled: enabled });
    },

    clearError: () => {
      set({ error: null });
    },

    setCurrentKnowledgeBase: (knowledgeBaseId) => {
      const documents = knowledgeBaseId
        ? get().knowledgeDocumentsByKnowledgeBaseId[knowledgeBaseId] ?? []
        : [];
      set({
        currentKnowledgeBaseId: knowledgeBaseId,
        currentDocumentId: nextDocumentId(null, documents),
      });
    },

    setCurrentDocument: (documentId) => {
      set({ currentDocumentId: documentId });
    },

    clearKnowledgeState: () => {
      set({
        knowledgeBases: [],
        currentKnowledgeBaseId: null,
        currentDocumentId: null,
        knowledgeDocumentsByKnowledgeBaseId: {},
        knowledgeDocumentDetailsById: {},
        knowledgeDocumentChunksById: {},
        importTasksByRequestId: {},
        activeImportProgressByRequestId: {},
        latestTaskRequestIdByDocumentId: {},
        reindexStatesByDocumentId: {},
        isLoadingKnowledgeBases: false,
        isLoadingKnowledgeDocumentsByKnowledgeBaseId: {},
        isLoadingKnowledgeDocumentDetailsById: {},
        isLoadingKnowledgeDocumentChunksById: {},
        isImportingByKnowledgeBaseId: {},
        isReindexingKnowledgeBaseById: {},
        isReindexingByDocumentId: {},
        isDeletingKnowledgeBaseById: {},
        isDeletingKnowledgeDocumentById: {},
        error: null,
      });
    },

    refreshKnowledgeBases: async () => {
      set({ isLoadingKnowledgeBases: true, error: null });

      try {
        const knowledgeBases = await service.listKnowledgeBases();
        const currentKnowledgeBaseId = nextKnowledgeBaseId(
          get().currentKnowledgeBaseId,
          knowledgeBases,
        );
        const currentDocuments = currentKnowledgeBaseId
          ? get().knowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? []
          : [];

        set({
          knowledgeBases,
          currentKnowledgeBaseId,
          currentDocumentId: nextDocumentId(get().currentDocumentId, currentDocuments),
          isLoadingKnowledgeBases: false,
        });

        return knowledgeBases;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取知识库列表失败';
        set({ error, isLoadingKnowledgeBases: false });
        throw err;
      }
    },

    createKnowledgeBase: async (input) => {
      set({ error: null });

      try {
        const knowledgeBase = await service.createKnowledgeBase(input);
        set((state) => ({
          knowledgeBases: [...state.knowledgeBases, knowledgeBase],
          currentKnowledgeBaseId: knowledgeBase.id,
          currentDocumentId: null,
        }));

        return knowledgeBase;
      } catch (err) {
        const error = err instanceof Error ? err.message : '创建知识库失败';
        set({ error });
        throw err;
      }
    },

    deleteKnowledgeBase: async (knowledgeBaseId) => {
      set((state) => ({
        error: null,
        isDeletingKnowledgeBaseById: {
          ...state.isDeletingKnowledgeBaseById,
          [knowledgeBaseId]: true,
        },
      }));

      try {
        await service.deleteKnowledgeBase(knowledgeBaseId);

        set((state) => {
          const knowledgeBases = state.knowledgeBases.filter(
            (knowledgeBase) => knowledgeBase.id !== knowledgeBaseId,
          );
          const { [knowledgeBaseId]: _, ...knowledgeDocumentsByKnowledgeBaseId } =
            state.knowledgeDocumentsByKnowledgeBaseId;
          const isDeletingKnowledgeBaseById = { ...state.isDeletingKnowledgeBaseById };
          delete isDeletingKnowledgeBaseById[knowledgeBaseId];

          const deletedDocumentIds = new Set(
            (state.knowledgeDocumentsByKnowledgeBaseId[knowledgeBaseId] ?? []).map((document) => document.id),
          );
          const knowledgeDocumentDetailsById = { ...state.knowledgeDocumentDetailsById };
          const knowledgeDocumentChunksById = { ...state.knowledgeDocumentChunksById };
          const latestTaskRequestIdByDocumentId = { ...state.latestTaskRequestIdByDocumentId };
          const reindexStatesByDocumentId = { ...state.reindexStatesByDocumentId };
          const isReindexingByDocumentId = { ...state.isReindexingByDocumentId };
          const isDeletingKnowledgeDocumentById = { ...state.isDeletingKnowledgeDocumentById };

          deletedDocumentIds.forEach((documentId) => {
            delete knowledgeDocumentDetailsById[documentId];
            delete knowledgeDocumentChunksById[documentId];
            delete latestTaskRequestIdByDocumentId[documentId];
            delete reindexStatesByDocumentId[documentId];
            delete isReindexingByDocumentId[documentId];
            delete isDeletingKnowledgeDocumentById[documentId];
          });

          const currentKnowledgeBaseId = nextKnowledgeBaseId(
            state.currentKnowledgeBaseId === knowledgeBaseId ? null : state.currentKnowledgeBaseId,
            knowledgeBases,
          );
          const currentDocuments = currentKnowledgeBaseId
            ? knowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? []
            : [];

          return {
            knowledgeBases,
            currentKnowledgeBaseId,
            currentDocumentId: nextDocumentId(
              deletedDocumentIds.has(state.currentDocumentId ?? '') ? null : state.currentDocumentId,
              currentDocuments,
            ),
            knowledgeDocumentsByKnowledgeBaseId,
            knowledgeDocumentDetailsById,
            knowledgeDocumentChunksById,
            latestTaskRequestIdByDocumentId,
            reindexStatesByDocumentId,
            isReindexingByDocumentId,
            isDeletingKnowledgeDocumentById,
            isDeletingKnowledgeBaseById,
          };
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : '删除知识库失败';
        set((state) => ({
          error,
          isDeletingKnowledgeBaseById: {
            ...state.isDeletingKnowledgeBaseById,
            [knowledgeBaseId]: false,
          },
        }));
        throw err;
      }
    },

    refreshKnowledgeDocuments: async (knowledgeBaseId) => {
      const targetKnowledgeBaseId = knowledgeBaseId ?? get().currentKnowledgeBaseId;
      if (!targetKnowledgeBaseId) {
        set({ currentDocumentId: null });
        return [];
      }

      set((state) => ({
        error: null,
        isLoadingKnowledgeDocumentsByKnowledgeBaseId: {
          ...state.isLoadingKnowledgeDocumentsByKnowledgeBaseId,
          [targetKnowledgeBaseId]: true,
        },
      }));

      try {
        const documents = await service.listKnowledgeDocuments(targetKnowledgeBaseId);
        set((state) => ({
          knowledgeDocumentsByKnowledgeBaseId: {
            ...state.knowledgeDocumentsByKnowledgeBaseId,
            [targetKnowledgeBaseId]: documents,
          },
          currentKnowledgeBaseId: targetKnowledgeBaseId,
          currentDocumentId:
            state.currentKnowledgeBaseId === targetKnowledgeBaseId
              ? nextDocumentId(state.currentDocumentId, documents)
              : nextDocumentId(null, documents),
          isLoadingKnowledgeDocumentsByKnowledgeBaseId: {
            ...state.isLoadingKnowledgeDocumentsByKnowledgeBaseId,
            [targetKnowledgeBaseId]: false,
          },
        }));

        return documents;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取知识库文档列表失败';
        set((state) => ({
          error,
          isLoadingKnowledgeDocumentsByKnowledgeBaseId: {
            ...state.isLoadingKnowledgeDocumentsByKnowledgeBaseId,
            [targetKnowledgeBaseId]: false,
          },
        }));
        throw err;
      }
    },

    refreshKnowledgeDocument: async (documentId) => {
      set((state) => ({
        error: null,
        isLoadingKnowledgeDocumentDetailsById: {
          ...state.isLoadingKnowledgeDocumentDetailsById,
          [documentId]: true,
        },
      }));

      try {
        const document = await service.getKnowledgeDocument(documentId);

        set((state) => {
          const isLoadingKnowledgeDocumentDetailsById = {
            ...state.isLoadingKnowledgeDocumentDetailsById,
            [documentId]: false,
          };
          const knowledgeDocumentDetailsById = { ...state.knowledgeDocumentDetailsById };

          if (document) {
            knowledgeDocumentDetailsById[document.id] = document;
          } else {
            delete knowledgeDocumentDetailsById[documentId];
          }

          return {
            knowledgeDocumentDetailsById,
            currentDocumentId: document?.id ?? (state.currentDocumentId === documentId ? null : state.currentDocumentId),
            isLoadingKnowledgeDocumentDetailsById,
          };
        });

        return document;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取文档详情失败';
        set((state) => ({
          error,
          isLoadingKnowledgeDocumentDetailsById: {
            ...state.isLoadingKnowledgeDocumentDetailsById,
            [documentId]: false,
          },
        }));
        throw err;
      }
    },

    refreshKnowledgeDocumentChunks: async (documentId) => {
      const targetDocumentId = documentId ?? get().currentDocumentId;
      if (!targetDocumentId) {
        return [];
      }

      set((state) => ({
        error: null,
        isLoadingKnowledgeDocumentChunksById: {
          ...state.isLoadingKnowledgeDocumentChunksById,
          [targetDocumentId]: true,
        },
      }));

      try {
        const chunks = await service.listKnowledgeDocumentChunks(targetDocumentId);
        set((state) => ({
          knowledgeDocumentChunksById: {
            ...state.knowledgeDocumentChunksById,
            [targetDocumentId]: chunks,
          },
          isLoadingKnowledgeDocumentChunksById: {
            ...state.isLoadingKnowledgeDocumentChunksById,
            [targetDocumentId]: false,
          },
        }));

        return chunks;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取文档分块失败';
        set((state) => ({
          error,
          isLoadingKnowledgeDocumentChunksById: {
            ...state.isLoadingKnowledgeDocumentChunksById,
            [targetDocumentId]: false,
          },
        }));
        throw err;
      }
    },

    deleteKnowledgeDocument: async (documentId, knowledgeBaseId) => {
      set((state) => ({
        error: null,
        isDeletingKnowledgeDocumentById: {
          ...state.isDeletingKnowledgeDocumentById,
          [documentId]: true,
        },
      }));

      try {
        await service.deleteKnowledgeDocument(documentId);

        set((state) => {
          const resolvedKnowledgeBaseId =
            knowledgeBaseId
            ?? state.knowledgeDocumentDetailsById[documentId]?.knowledgeBaseId
            ?? Object.entries(state.knowledgeDocumentsByKnowledgeBaseId).find(([, documents]) =>
              documents.some((document) => document.id === documentId),
            )?.[0]
            ?? null;

          const knowledgeDocumentsByKnowledgeBaseId = { ...state.knowledgeDocumentsByKnowledgeBaseId };
          if (resolvedKnowledgeBaseId) {
            knowledgeDocumentsByKnowledgeBaseId[resolvedKnowledgeBaseId] = (
              knowledgeDocumentsByKnowledgeBaseId[resolvedKnowledgeBaseId] ?? []
            ).filter((document) => document.id !== documentId);
          }

          const { [documentId]: _, ...knowledgeDocumentDetailsById } = state.knowledgeDocumentDetailsById;
          const { [documentId]: __, ...knowledgeDocumentChunksById } = state.knowledgeDocumentChunksById;
          const { [documentId]: ___, ...latestTaskRequestIdByDocumentId } = state.latestTaskRequestIdByDocumentId;
          const { [documentId]: ____, ...reindexStatesByDocumentId } = state.reindexStatesByDocumentId;
          const { [documentId]: _____, ...isReindexingByDocumentId } = state.isReindexingByDocumentId;
          const { [documentId]: ______, ...isDeletingKnowledgeDocumentById } =
            state.isDeletingKnowledgeDocumentById;
          const nextCurrentDocumentId =
            state.currentDocumentId === documentId
              ? nextDocumentId(
                  null,
                  resolvedKnowledgeBaseId
                    ? knowledgeDocumentsByKnowledgeBaseId[resolvedKnowledgeBaseId] ?? []
                    : [],
                )
              : state.currentDocumentId;

          return {
            knowledgeDocumentsByKnowledgeBaseId,
            knowledgeDocumentDetailsById,
            knowledgeDocumentChunksById,
            latestTaskRequestIdByDocumentId,
            reindexStatesByDocumentId,
            isReindexingByDocumentId,
            isDeletingKnowledgeDocumentById,
            currentDocumentId: nextCurrentDocumentId,
          };
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : '删除知识库文档失败';
        set((state) => ({
          error,
          isDeletingKnowledgeDocumentById: {
            ...state.isDeletingKnowledgeDocumentById,
            [documentId]: false,
          },
        }));
        throw err;
      }
    },

    refreshKnowledgeImportTasks: async (knowledgeBaseId, documentId, includeFinished = true) => {
      try {
        const tasks = await service.listKnowledgeImportTasks(
          knowledgeBaseId,
          documentId,
          includeFinished,
        );

        set((state) => tasks.reduce<Partial<RagState>>(
          (accumulator, task) => {
            const baseState = {
              ...state,
              ...(accumulator as Partial<RagState>),
              importTasksByRequestId: accumulator.importTasksByRequestId ?? state.importTasksByRequestId,
              activeImportProgressByRequestId:
                accumulator.activeImportProgressByRequestId ?? state.activeImportProgressByRequestId,
              latestTaskRequestIdByDocumentId:
                accumulator.latestTaskRequestIdByDocumentId ?? state.latestTaskRequestIdByDocumentId,
              reindexStatesByDocumentId:
                accumulator.reindexStatesByDocumentId ?? state.reindexStatesByDocumentId,
              isReindexingByDocumentId:
                accumulator.isReindexingByDocumentId ?? state.isReindexingByDocumentId,
            } as RagState;

            return {
              ...accumulator,
              ...updateTaskState(baseState, task),
            };
          },
          {},
        ));

        return tasks;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取知识库任务列表失败';
        set({ error });
        throw err;
      }
    },

    refreshKnowledgeImportTask: async (requestId) => {
      try {
        const task = await service.getKnowledgeImportTask(requestId);
        if (task) {
          set((state) => updateTaskState(state, task));
        }
        return task;
      } catch (err) {
        const error = err instanceof Error ? err.message : '获取知识库任务详情失败';
        set({ error });
        throw err;
      }
    },

    importKnowledgeDocument: async (request) => {
      const requestId = request.progressEventId ?? service.createKnowledgeBaseImportProgressId();
      set((state) => ({
        error: null,
        isImportingByKnowledgeBaseId: {
          ...state.isImportingByKnowledgeBaseId,
          [request.knowledgeBaseId]: true,
        },
      }));

      try {
        const result = await service.importKnowledgeDocument(
          { ...request, progressEventId: requestId },
          (progress) => {
            const snapshot = snapshotFromProgress(
              progress,
              get().importTasksByRequestId[progress.requestId ?? ''],
            );
            if (!snapshot) {
              return;
            }

            set((state) => ({
              activeImportProgressByRequestId: {
                ...state.activeImportProgressByRequestId,
                [snapshot.requestId]: progress,
              },
              ...updateTaskState(state, snapshot),
            }));
          },
        );

        const completedTask = await get().refreshKnowledgeImportTask(requestId);
        await get().refreshKnowledgeBases();
        await get().refreshKnowledgeDocuments(result.document.knowledgeBaseId);
        await get().refreshKnowledgeDocument(result.document.id);
        await get().refreshKnowledgeDocumentChunks(result.document.id);

        set((state) => ({
          currentKnowledgeBaseId: result.document.knowledgeBaseId,
          currentDocumentId: result.document.id,
          isImportingByKnowledgeBaseId: {
            ...state.isImportingByKnowledgeBaseId,
            [request.knowledgeBaseId]: false,
          },
          activeImportProgressByRequestId: completedTask
            ? state.activeImportProgressByRequestId
            : Object.fromEntries(
                Object.entries(state.activeImportProgressByRequestId).filter(([key]) => key !== requestId),
              ),
        }));

        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : '导入知识库文档失败';
        set((state) => ({
          error,
          isImportingByKnowledgeBaseId: {
            ...state.isImportingByKnowledgeBaseId,
            [request.knowledgeBaseId]: false,
          },
        }));
        throw err;
      }
    },

    reindexKnowledgeBase: async (request) => {
      const requestId = request.progressEventId ?? service.createKnowledgeBaseImportProgressId();
      set((state) => ({
        error: null,
        isReindexingKnowledgeBaseById: {
          ...state.isReindexingKnowledgeBaseById,
          [request.knowledgeBaseId]: true,
        },
      }));

      try {
        const result = await service.reindexKnowledgeBase(
          { ...request, progressEventId: requestId },
          (progress) => {
            const snapshot = snapshotFromProgress(
              progress,
              get().importTasksByRequestId[progress.requestId ?? ''],
            );
            if (!snapshot) {
              return;
            }

            set((state) => ({
              activeImportProgressByRequestId: {
                ...state.activeImportProgressByRequestId,
                [snapshot.requestId]: progress,
              },
              ...updateTaskState(state, snapshot),
            }));
          },
        );

        await get().refreshKnowledgeImportTasks(request.knowledgeBaseId, undefined, true);
        await get().refreshKnowledgeBases();
        const refreshedDocuments = await get().refreshKnowledgeDocuments(request.knowledgeBaseId);
        const currentDocumentId = get().currentDocumentId;
        const shouldRefreshCurrentDocument = currentDocumentId
          ? refreshedDocuments.some((document) => document.id === currentDocumentId)
          : false;

        if (currentDocumentId && shouldRefreshCurrentDocument) {
          await get().refreshKnowledgeDocument(currentDocumentId);
          await get().refreshKnowledgeDocumentChunks(currentDocumentId);
        }

        set((state) => ({
          currentKnowledgeBaseId: request.knowledgeBaseId,
          isReindexingKnowledgeBaseById: {
            ...state.isReindexingKnowledgeBaseById,
            [request.knowledgeBaseId]: false,
          },
          error: result.failures.length > 0
            ? `整库重建完成，但有 ${result.failures.length} 个文档失败：${result.failures[0]?.fileName ?? '未知文档'}`
            : state.error,
        }));

        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : '重建知识库索引失败';
        set((state) => ({
          error,
          isReindexingKnowledgeBaseById: {
            ...state.isReindexingKnowledgeBaseById,
            [request.knowledgeBaseId]: false,
          },
        }));
        throw err;
      }
    },

    reindexKnowledgeDocument: async (request) => {
      const requestId = request.progressEventId ?? service.createKnowledgeBaseImportProgressId();
      set((state) => ({
        error: null,
        isReindexingByDocumentId: {
          ...state.isReindexingByDocumentId,
          [request.documentId]: true,
        },
      }));

      try {
        const result = await service.reindexKnowledgeDocument(
          { ...request, progressEventId: requestId },
          (progress) => {
            const snapshot = snapshotFromProgress(
              progress,
              get().importTasksByRequestId[progress.requestId ?? ''],
            );
            if (!snapshot) {
              return;
            }

            set((state) => ({
              activeImportProgressByRequestId: {
                ...state.activeImportProgressByRequestId,
                [snapshot.requestId]: progress,
              },
              ...updateTaskState(state, snapshot),
            }));
          },
        );

        await get().refreshKnowledgeImportTask(requestId);
        await get().refreshKnowledgeDocuments(result.document.knowledgeBaseId);
        await get().refreshKnowledgeDocument(result.document.id);
        await get().refreshKnowledgeDocumentChunks(result.document.id);

        set((state) => ({
          currentKnowledgeBaseId: result.document.knowledgeBaseId,
          currentDocumentId: result.document.id,
          isReindexingByDocumentId: {
            ...state.isReindexingByDocumentId,
            [request.documentId]: false,
          },
        }));

        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : '重建知识库文档索引失败';
        set((state) => ({
          error,
          isReindexingByDocumentId: {
            ...state.isReindexingByDocumentId,
            [request.documentId]: false,
          },
        }));
        throw err;
      }
    },
  });
}

export const useRagStore = create<RagState>(createRagState());

export default useRagStore;
