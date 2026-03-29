import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Database, RefreshCw, Trash2 } from 'lucide-react';
import { useRagStore } from '../store/rag';
import { KnowledgeImportPanel } from './knowledge/KnowledgeImportPanel';
import { KnowledgeDocumentList } from './knowledge/KnowledgeDocumentList';
import { KnowledgeDocumentPreview } from './knowledge/KnowledgeDocumentPreview';

interface KnowledgeBasePanelProps {
  onBack: () => void;
}

export function KnowledgeBasePanel({ onBack }: KnowledgeBasePanelProps) {
  const {
    knowledgeBases,
    currentKnowledgeBaseId,
    currentDocumentId,
    isLoadingKnowledgeBases,
    isLoadingKnowledgeDocumentDetailsById,
    isLoadingKnowledgeDocumentsByKnowledgeBaseId,
    isLoadingKnowledgeDocumentChunksById,
    isDeletingKnowledgeBaseById,
    knowledgeDocumentDetailsById,
    knowledgeDocumentsByKnowledgeBaseId,
    knowledgeDocumentChunksById,
    error,
    clearError,
    deleteKnowledgeBase,
    refreshKnowledgeBases,
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

  const isLoadingDocuments = currentKnowledgeBaseId
    ? isLoadingKnowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? false
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
  const [confirmDeleteKnowledgeBaseId, setConfirmDeleteKnowledgeBaseId] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDeleteKnowledgeBaseId(null);
  }, [currentKnowledgeBaseId]);

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
                  知识库管理面板已拆分
                </h2>
                <p className="mt-2 text-sm leading-6 text-amber-800/80">
                  当前步骤已经把知识库页面拆成独立组件，并接入当前知识库的文档列表、文档预览、导入状态区，以及删除和重建索引操作。
                </p>
              </div>
              <div className="min-w-28 rounded-2xl bg-amber-100 px-4 py-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500">Bases</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{knowledgeBases.length}</p>
              </div>
            </div>
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
                      : knowledgeBases.length > 0
                        ? '知识库列表已加载，但文档管理区还会在后续子任务接入。'
                        : '当前还没有可展示的知识库。'}
                </p>
              </div>
              {currentKnowledgeBase && (
                <button
                  type="button"
                  onClick={() => {
                    void handleDeleteKnowledgeBase();
                  }}
                  disabled={isDeletingKnowledgeBase}
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
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                知识库状态加载失败：{error}
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
    </div>
  );
}

export default KnowledgeBasePanel;
