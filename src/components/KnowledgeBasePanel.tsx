import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Database, PlusCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useRagStore } from '../store/rag';
import { loadConfig } from '../store/config';
import { KnowledgeImportPanel } from './knowledge/KnowledgeImportPanel';
import { KnowledgeDocumentList } from './knowledge/KnowledgeDocumentList';
import { KnowledgeDocumentPreview } from './knowledge/KnowledgeDocumentPreview';

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatIndexedAt(timestamp: number | null): string {
  if (!timestamp) {
    return '暂无';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

// 共享的创建知识库表单字段，内联和弹窗两处复用，避免表单逻辑重复
function CreateKnowledgeBaseForm({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  isCreating,
  error,
  onCancel,
  autoFocusName,
}: {
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (desc: string) => void;
  isCreating: boolean;
  error: string | null;
  onCancel?: () => void;
  autoFocusName?: boolean;
}) {
  const normalizedName = name.trim();
  return (
    <>
      <label className="block">
        <span className="text-xs font-medium text-amber-700">知识库名称</span>
        <input
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如：面试题库 / 项目文档 / 算法笔记"
          autoFocus={autoFocusName}
          className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-amber-900 placeholder:text-amber-400 focus:border-amber-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-amber-700">描述（可选）</span>
        <input
          type="text"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="说明这个知识库主要放什么资料，便于后续区分"
          className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-amber-900 placeholder:text-amber-400 focus:border-amber-500 focus:outline-none"
        />
      </label>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          创建失败：{error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={!normalizedName || isCreating}
          className="flex items-center gap-2 rounded-xl border border-amber-700 bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusCircle className="w-4 h-4" />
          {isCreating ? '创建中...' : '创建知识库'}
        </button>
      </div>
    </>
  );
}

interface KnowledgeBasePanelProps {
  onBack: () => void;
}

export function KnowledgeBasePanel({ onBack }: KnowledgeBasePanelProps) {
  const {
    knowledgeBases,
    currentKnowledgeBaseId,
    currentDocumentId,
    knowledgeBaseStatsById,
    isLoadingKnowledgeBases,
    isLoadingKnowledgeBaseStatsById,
    isLoadingKnowledgeDocumentDetailsById,
    isLoadingKnowledgeDocumentsByKnowledgeBaseId,
    isLoadingKnowledgeDocumentChunksById,
    isDeletingKnowledgeBaseById,
    isReindexingKnowledgeBaseById,
    isRetryingKnowledgeBaseById,
    knowledgeDocumentDetailsById,
    knowledgeDocumentsByKnowledgeBaseId,
    knowledgeDocumentChunksById,
    knowledgeBaseListError,
    error,
    clearError,
    createKnowledgeBase,
    deleteKnowledgeBase,
    reindexKnowledgeBase,
    retryKnowledgeBaseDocuments,
    refreshKnowledgeBases,
    refreshKnowledgeBaseStats,
    refreshKnowledgeDocument,
    refreshKnowledgeDocumentChunks,
    refreshKnowledgeDocuments,
    setCurrentKnowledgeBase,
    setCurrentDocument,
  } = useRagStore();

  const currentKnowledgeBase = useMemo(
    () => knowledgeBases.find((knowledgeBase) => knowledgeBase.id === currentKnowledgeBaseId) ?? null,
    [knowledgeBases, currentKnowledgeBaseId],
  );

  const currentDocuments = useMemo(
    () => (currentKnowledgeBaseId ? knowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? [] : []),
    [knowledgeDocumentsByKnowledgeBaseId, currentKnowledgeBaseId],
  );

  const currentDocument = useMemo(
    () => {
      if (!currentDocumentId) {
        return null;
      }

      return knowledgeDocumentDetailsById[currentDocumentId]
        ?? currentDocuments.find((document) => document.id === currentDocumentId)
        ?? null;
    },
    [currentDocumentId, currentDocuments, knowledgeDocumentDetailsById],
  );

  const currentDocumentChunks = useMemo(
    () => (currentDocumentId ? knowledgeDocumentChunksById[currentDocumentId] ?? [] : []),
    [currentDocumentId, knowledgeDocumentChunksById],
  );
  const currentKnowledgeBaseStats = useMemo(
    () => (currentKnowledgeBaseId ? knowledgeBaseStatsById[currentKnowledgeBaseId] ?? null : null),
    [currentKnowledgeBaseId, knowledgeBaseStatsById],
  );

  const isLoadingDocuments = currentKnowledgeBaseId
    ? isLoadingKnowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? false
    : false;
  const isLoadingKnowledgeBaseStats = currentKnowledgeBaseId
    ? isLoadingKnowledgeBaseStatsById[currentKnowledgeBaseId] ?? false
    : false;
  const isLoadingDocument = currentDocumentId
    ? isLoadingKnowledgeDocumentDetailsById[currentDocumentId] ?? false
    : false;
  const isLoadingDocumentChunks = currentDocumentId
    ? isLoadingKnowledgeDocumentChunksById[currentDocumentId] ?? false
    : false;
  const isDeletingKnowledgeBase = currentKnowledgeBaseId
    ? isDeletingKnowledgeBaseById[currentKnowledgeBaseId] ?? false
    : false;
  const isReindexingKnowledgeBase = currentKnowledgeBaseId
    ? isReindexingKnowledgeBaseById[currentKnowledgeBaseId] ?? false
    : false;
  const isRetryingKnowledgeBase = currentKnowledgeBaseId
    ? isRetryingKnowledgeBaseById[currentKnowledgeBaseId] ?? false
    : false;
  const [confirmDeleteKnowledgeBaseId, setConfirmDeleteKnowledgeBaseId] = useState<string | null>(null);
  const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState('');
  const [newKnowledgeBaseDescription, setNewKnowledgeBaseDescription] = useState('');
  const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const retryableDocumentCount = useMemo(
    () => currentDocuments.filter((document) => document.indexState === 'pending' || document.indexState === 'failed').length,
    [currentDocuments],
  );
  const normalizedKnowledgeBaseName = newKnowledgeBaseName.trim();

  useEffect(() => {
    setConfirmDeleteKnowledgeBaseId(null);
  }, [currentKnowledgeBaseId]);

  useEffect(() => {
    if (!currentKnowledgeBaseId) {
      return;
    }

    void refreshKnowledgeBaseStats(currentKnowledgeBaseId).catch((refreshError) => {
      console.error('Failed to load knowledge base stats:', refreshError);
    });
  }, [currentKnowledgeBaseId, refreshKnowledgeBaseStats]);

  useEffect(() => {
    if (!currentKnowledgeBaseId) {
      return;
    }

    void refreshKnowledgeDocuments(currentKnowledgeBaseId).catch((refreshError) => {
      console.error('Failed to load knowledge documents:', refreshError);
    });
  }, [currentKnowledgeBaseId, refreshKnowledgeDocuments]);

  useEffect(() => {
    if (!currentDocumentId) {
      return;
    }

    void (async () => {
      try {
        await Promise.all([
          refreshKnowledgeDocument(currentDocumentId),
          refreshKnowledgeDocumentChunks(currentDocumentId),
        ]);
      } catch (refreshError) {
        console.error('Failed to load knowledge document preview:', refreshError);
      }
    })();
  }, [currentDocumentId, refreshKnowledgeDocument, refreshKnowledgeDocumentChunks]);

  const handleRefresh = () => {
    void (async () => {
      try {
        const refreshedKnowledgeBases = await refreshKnowledgeBases();
        const nextKnowledgeBaseId = currentKnowledgeBaseId && refreshedKnowledgeBases.some(
          (knowledgeBase) => knowledgeBase.id === currentKnowledgeBaseId,
        )
          ? currentKnowledgeBaseId
          : refreshedKnowledgeBases[0]?.id ?? null;

        if (nextKnowledgeBaseId) {
          await refreshKnowledgeBaseStats(nextKnowledgeBaseId);
          const refreshedDocuments = await refreshKnowledgeDocuments(nextKnowledgeBaseId);
          const nextDocumentId = currentDocumentId && refreshedDocuments.some(
            (document) => document.id === currentDocumentId,
          )
            ? currentDocumentId
            : refreshedDocuments[0]?.id ?? null;

          if (nextDocumentId) {
            await Promise.all([
              refreshKnowledgeDocument(nextDocumentId),
              refreshKnowledgeDocumentChunks(nextDocumentId),
            ]);
          }
        }
      } catch (refreshError) {
        console.error('Failed to refresh knowledge bases:', refreshError);
      }
    })();
  };

  const handleSelectKnowledgeBase = (knowledgeBaseId: string) => {
    setCurrentKnowledgeBase(knowledgeBaseId);
  };

  const handleCreateKnowledgeBase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!normalizedKnowledgeBaseName || isCreatingKnowledgeBase) {
      return;
    }

    clearError();
    setIsCreatingKnowledgeBase(true);

    try {
      await createKnowledgeBase({
        name: normalizedKnowledgeBaseName,
        description: newKnowledgeBaseDescription.trim() || null,
      });
      setNewKnowledgeBaseName('');
      setNewKnowledgeBaseDescription('');
    } catch (createError) {
      console.error('Failed to create knowledge base:', createError);
    } finally {
      setIsCreatingKnowledgeBase(false);
    }
  };

  const handleDeleteKnowledgeBase = async () => {
    if (!currentKnowledgeBaseId) {
      return;
    }

    if (confirmDeleteKnowledgeBaseId !== currentKnowledgeBaseId) {
      setConfirmDeleteKnowledgeBaseId(currentKnowledgeBaseId);
      return;
    }

    clearError();
    try {
      await deleteKnowledgeBase(currentKnowledgeBaseId);
      setConfirmDeleteKnowledgeBaseId(null);
    } catch (deleteError) {
      console.error('Failed to delete knowledge base:', deleteError);
    }
  };

  const handleReindexKnowledgeBase = async () => {
    if (!currentKnowledgeBaseId) {
      return;
    }

    clearError();
    try {
      const config = await loadConfig();
      await reindexKnowledgeBase({
        knowledgeBaseId: currentKnowledgeBaseId,
        parseOptions: {
          enableOcr: config.rag.enableOcr,
        },
      });
    } catch (reindexError) {
      console.error('Failed to reindex knowledge base:', reindexError);
    }
  };

  const handleRetryKnowledgeBaseDocuments = async () => {
    if (!currentKnowledgeBaseId || retryableDocumentCount === 0) {
      return;
    }

    clearError();
    try {
      const config = await loadConfig();
      await retryKnowledgeBaseDocuments({
        knowledgeBaseId: currentKnowledgeBaseId,
        parseOptions: {
          enableOcr: config.rag.enableOcr,
        },
      });
    } catch (retryError) {
      console.error('Failed to retry pending or failed knowledge documents:', retryError);
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      <div
        data-tauri-drag-region
        className="flex-shrink-0 flex items-center justify-between h-10 px-4 bg-amber-100/80 border-b border-amber-200 select-none"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700" />
          </button>
          <Database className="w-4 h-4 text-amber-700" />
          <span className="text-xs font-medium text-amber-800 tracking-wide">知识库</span>
        </div>
        <button
          onClick={() => {
            setNewKnowledgeBaseName('');
            setNewKnowledgeBaseDescription('');
            clearError();
            setShowCreateDialog(true);
          }}
          className="flex items-center gap-1 px-2 h-6 rounded hover:bg-amber-200/60 text-xs text-amber-700 transition-colors"
          title="新建知识库"
        >
          <PlusCircle className="w-3 h-3" />
          新建
        </button>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1 px-2 h-6 rounded hover:bg-amber-200/60 text-xs text-amber-700 transition-colors"
          title="刷新知识库"
        >
          <RefreshCw className="w-3 h-3" />
          刷新
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-white/70 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-amber-500">Knowledge Base</p>
                <h2 className="mt-2 text-xl font-semibold text-amber-950">
                  {currentKnowledgeBase ? currentKnowledgeBase.name : '知识库管理'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-amber-800/80">
                  {currentKnowledgeBase
                    ? '当前面板已经接入知识库维度统计，可直接查看文档规模、索引体量、逻辑存储占用和最近一次索引模型。'
                    : '选择一个知识库后，可以查看该知识库的聚合统计、文档列表、导入状态与索引操作。'}
                </p>
              </div>
              <div className="min-w-28 rounded-2xl bg-amber-100 px-4 py-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500">Bases</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{knowledgeBases.length}</p>
              </div>
            </div>

            {currentKnowledgeBase && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  {
                    label: '总文档数',
                    value: isLoadingKnowledgeBaseStats
                      ? '...'
                      : String(currentKnowledgeBaseStats?.documentCount ?? currentKnowledgeBase.documentCount ?? 0),
                    helper: '当前知识库的文档总量',
                  },
                  {
                    label: '总 Chunk 数',
                    value: isLoadingKnowledgeBaseStats
                      ? '...'
                      : String(currentKnowledgeBaseStats?.chunkCount ?? 0),
                    helper: '已持久化的文本分块数',
                  },
                  {
                    label: '总 Embedding 数',
                    value: isLoadingKnowledgeBaseStats
                      ? '...'
                      : String(currentKnowledgeBaseStats?.embeddingCount ?? 0),
                    helper: '已写入的向量条数',
                  },
                  {
                    label: '存储占用',
                    value: isLoadingKnowledgeBaseStats
                      ? '...'
                      : formatBytes(currentKnowledgeBaseStats?.storageBytes ?? 0),
                    helper: '源文件 + chunk 文本 + 向量逻辑体积',
                  },
                  {
                    label: '最近索引模型',
                    value: isLoadingKnowledgeBaseStats
                      ? '...'
                      : currentKnowledgeBaseStats?.latestIndexedModelId ?? '暂无',
                    helper: isLoadingKnowledgeBaseStats
                      ? '正在加载'
                      : `最近索引时间：${formatIndexedAt(currentKnowledgeBaseStats?.latestIndexedAt ?? null)}`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3"
                  >
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-500">
                      {item.label}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-amber-950 break-all">
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-700/80">
                      {item.helper}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-amber-900">当前状态</h3>
                <p className="mt-1 text-sm text-amber-700/80">
                  {isLoadingKnowledgeBases
                    ? '正在加载知识库列表...'
                    : currentKnowledgeBase
                      ? `当前选中知识库：${currentKnowledgeBase.name}`
                      : knowledgeBaseListError
                        ? '知识库列表加载失败，请刷新后重试。'
                      : knowledgeBases.length > 0
                        ? '知识库列表已加载，选择任意知识库即可查看统计和文档详情。'
                        : '当前还没有可展示的知识库。'}
                </p>
              </div>
              {currentKnowledgeBase && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleRetryKnowledgeBaseDocuments();
                    }}
                    disabled={
                      isDeletingKnowledgeBase
                      || isReindexingKnowledgeBase
                      || isRetryingKnowledgeBase
                      || retryableDocumentCount === 0
                    }
                    className="flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRetryingKnowledgeBase ? 'animate-spin' : ''}`} />
                    {isRetryingKnowledgeBase
                      ? '后台重试中...'
                      : retryableDocumentCount > 0
                        ? `重试异常文档 (${retryableDocumentCount})`
                        : '重试异常文档'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleReindexKnowledgeBase();
                    }}
                    disabled={
                      isDeletingKnowledgeBase
                      || isReindexingKnowledgeBase
                      || isRetryingKnowledgeBase
                      || currentDocuments.length === 0
                    }
                    className="flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isReindexingKnowledgeBase ? 'animate-spin' : ''}`} />
                    {isReindexingKnowledgeBase ? '整库重建中...' : '重建当前知识库'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeleteKnowledgeBase();
                    }}
                    disabled={isDeletingKnowledgeBase || isReindexingKnowledgeBase || isRetryingKnowledgeBase}
                    className={`flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      confirmDeleteKnowledgeBaseId === currentKnowledgeBaseId
                        ? 'border-red-300 bg-red-100 text-red-700 hover:bg-red-200'
                        : 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {isDeletingKnowledgeBase
                      ? '删除中...'
                      : confirmDeleteKnowledgeBaseId === currentKnowledgeBaseId
                        ? '确认删除知识库'
                        : '删除当前知识库'}
                  </button>
                </div>
              )}
            </div>

            {knowledgeBaseListError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                知识库列表加载失败：{knowledgeBaseListError}
              </div>
            )}

            {!knowledgeBaseListError && error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                最近一次知识库操作失败：{error}
              </div>
            )}

            {!isLoadingKnowledgeBases && knowledgeBases.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {knowledgeBases.map((knowledgeBase) => {
                  const isActive = knowledgeBase.id === currentKnowledgeBaseId;
                  return (
                    <button
                      key={knowledgeBase.id}
                      type="button"
                      onClick={() => handleSelectKnowledgeBase(knowledgeBase.id)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-amber-400 bg-amber-100/80'
                          : 'border-amber-200 bg-amber-50/70 hover:bg-amber-100/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-amber-900">{knowledgeBase.name}</p>
                          <p className="mt-1 text-xs text-amber-700/80">
                            {knowledgeBase.documentCount} 个文档
                          </p>
                        </div>
                        {isActive && (
                          <span className="rounded-full bg-amber-600 px-2 py-1 text-[10px] font-medium text-white">
                            当前
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!isLoadingKnowledgeBases && knowledgeBases.length === 0 && (
              <form
                onSubmit={handleCreateKnowledgeBase}
                className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-amber-900">新建知识库</h4>
                    <p className="mt-1 text-sm text-amber-700/80">
                      当前还没有知识库。先创建一个知识库，随后就可以立即导入文档。
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] text-amber-700/80">
                    创建后自动选中
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <CreateKnowledgeBaseForm
                    name={newKnowledgeBaseName}
                    onNameChange={setNewKnowledgeBaseName}
                    description={newKnowledgeBaseDescription}
                    onDescriptionChange={setNewKnowledgeBaseDescription}
                    isCreating={isCreatingKnowledgeBase}
                    error={error}
                  />
                </div>
              </form>
            )}
          </div>

          <KnowledgeImportPanel
            knowledgeBaseId={currentKnowledgeBaseId}
            knowledgeBaseName={currentKnowledgeBase?.name ?? null}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
            <KnowledgeDocumentList
              documents={currentDocuments}
              currentDocumentId={currentDocumentId}
              isLoading={isLoadingDocuments}
              onSelectDocument={setCurrentDocument}
            />

            <KnowledgeDocumentPreview
              document={currentDocument}
              chunks={currentDocumentChunks}
              isLoadingDocument={isLoadingDocument}
              isLoadingChunks={isLoadingDocumentChunks}
              knowledgeBaseId={currentKnowledgeBaseId}
            />
          </div>
        </div>
      </div>

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-amber-900">新建知识库</h3>
              <button
                type="button"
                onClick={() => setShowCreateDialog(false)}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-amber-100 text-amber-600 transition-colors"
              >
                <span className="text-lg leading-none">&times;</span>
              </button>
            </div>
            <p className="mt-1 text-sm text-amber-700/80">
              创建一个新的知识库，随后即可导入文档。
            </p>

            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!normalizedKnowledgeBaseName || isCreatingKnowledgeBase) return;

                clearError();
                setIsCreatingKnowledgeBase(true);
                try {
                  await createKnowledgeBase({
                    name: normalizedKnowledgeBaseName,
                    description: newKnowledgeBaseDescription.trim() || null,
                  });
                  setNewKnowledgeBaseName('');
                  setNewKnowledgeBaseDescription('');
                  setShowCreateDialog(false);
                } catch {
                  // error is already set by the store
                } finally {
                  setIsCreatingKnowledgeBase(false);
                }
              }}
              className="mt-4 space-y-4"
            >
              <CreateKnowledgeBaseForm
                name={newKnowledgeBaseName}
                onNameChange={setNewKnowledgeBaseName}
                description={newKnowledgeBaseDescription}
                onDescriptionChange={setNewKnowledgeBaseDescription}
                isCreating={isCreatingKnowledgeBase}
                error={error}
                onCancel={() => setShowCreateDialog(false)}
                autoFocusName
              />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeBasePanel;
