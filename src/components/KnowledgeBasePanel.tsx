import { useEffect, useMemo } from 'react';
import { ArrowLeft, Database, RefreshCw } from 'lucide-react';
import { useRagStore } from '../store/rag';
import { KnowledgeDocumentList } from './knowledge/KnowledgeDocumentList';

interface KnowledgeBasePanelProps {
  onBack: () => void;
}

export function KnowledgeBasePanel({ onBack }: KnowledgeBasePanelProps) {
  const {
    knowledgeBases,
    currentKnowledgeBaseId,
    currentDocumentId,
    isLoadingKnowledgeBases,
    isLoadingKnowledgeDocumentsByKnowledgeBaseId,
    knowledgeDocumentsByKnowledgeBaseId,
    error,
    refreshKnowledgeBases,
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

  const isLoadingDocuments = currentKnowledgeBaseId
    ? isLoadingKnowledgeDocumentsByKnowledgeBaseId[currentKnowledgeBaseId] ?? false
    : false;

  useEffect(() => {
    if (!currentKnowledgeBaseId) {
      return;
    }

    void refreshKnowledgeDocuments(currentKnowledgeBaseId).catch((refreshError) => {
      console.error('Failed to load knowledge documents:', refreshError);
    });
  }, [currentKnowledgeBaseId, refreshKnowledgeDocuments]);

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
          await refreshKnowledgeDocuments(nextKnowledgeBaseId);
        }
      } catch (refreshError) {
        console.error('Failed to refresh knowledge bases:', refreshError);
      }
    })();
  };

  const handleSelectKnowledgeBase = (knowledgeBaseId: string) => {
    setCurrentKnowledgeBase(knowledgeBaseId);
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
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-white/70 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-amber-500">Knowledge Base</p>
                <h2 className="mt-2 text-xl font-semibold text-amber-950">
                  知识库管理面板已拆分
                </h2>
                <p className="mt-2 text-sm leading-6 text-amber-800/80">
                  当前步骤已经把知识库页面拆成独立组件，并接入当前知识库的文档列表。后续会继续补上文档预览和导入交互。
                </p>
              </div>
              <div className="min-w-28 rounded-2xl bg-amber-100 px-4 py-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500">Bases</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{knowledgeBases.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
            <KnowledgeDocumentList
              documents={currentDocuments}
              currentDocumentId={currentDocumentId}
              isLoading={isLoadingDocuments}
              onSelectDocument={setCurrentDocument}
            />

            <section className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-amber-900">预览区占位</h3>
              <p className="mt-2 text-sm leading-6 text-amber-700/80">
                当前已可以浏览并选择文档。
                {currentDocumentId
                  ? ' 下一步会把选中文档的 chunk 预览和元数据明细接到这里。'
                  : ' 下一步会把文档预览组件接到这里。'}
              </p>
              {currentKnowledgeBase && (
                <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p>当前知识库：{currentKnowledgeBase.name}</p>
                  <p className="mt-1 text-xs text-amber-700/80">
                    已加载文档数：{currentDocuments.length}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KnowledgeBasePanel;
