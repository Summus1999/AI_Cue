import { useEffect, useState } from 'react';
import { AlertCircle, Clock3, FileText, Hash, LoaderCircle, MapPin, RefreshCw, Trash2 } from 'lucide-react';
import { loadConfig } from '../../store/config';
import { useRagStore } from '../../store/rag';
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from '../../services/ragService';

interface KnowledgeDocumentPreviewProps {
  knowledgeBaseId: string | null;
  document: KnowledgeDocumentRecord | null;
  chunks: KnowledgeChunkRecord[];
  isLoadingDocument: boolean;
  isLoadingChunks: boolean;
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) {
    return '未记录';
  }

  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
  });
}

function getIndexStateLabel(document: KnowledgeDocumentRecord): {
  label: string;
  className: string;
} {
  switch (document.indexState) {
    case 'ready':
      return {
        label: '已就绪',
        className: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
      };
    case 'indexing':
      return {
        label: '索引中',
        className: 'bg-blue-100 text-blue-700 border border-blue-200',
      };
    case 'failed':
      return {
        label: '失败',
        className: 'bg-red-100 text-red-700 border border-red-200',
      };
    default:
      return {
        label: '待处理',
        className: 'bg-amber-100 text-amber-700 border border-amber-200',
      };
  }
}

function formatChunkType(chunk: KnowledgeChunkRecord): string {
  if (chunk.chunkType === 'text') {
    return '文本';
  }
  if (chunk.chunkType === 'qa_pair') {
    return '问答';
  }
  if (chunk.chunkType.includes('code')) {
    return chunk.language ? `代码 · ${chunk.language}` : '代码';
  }
  return chunk.chunkType;
}

function formatStage(stage: string): string {
  switch (stage) {
    case 'parse':
      return '解析';
    case 'chunk':
      return '分块';
    case 'embed':
      return '向量化';
    case 'finalize':
      return '收尾';
    default:
      return stage;
  }
}

export function KnowledgeDocumentPreview({
  knowledgeBaseId,
  document,
  chunks,
  isLoadingDocument,
  isLoadingChunks,
}: KnowledgeDocumentPreviewProps) {
  const {
    clearError,
    deleteKnowledgeDocument,
    isDeletingKnowledgeDocumentById,
    isReindexingByDocumentId,
    reindexKnowledgeDocument,
    reindexStatesByDocumentId,
  } = useRagStore();
  const [enableOcr, setEnableOcr] = useState(false);
  const [confirmDeleteDocumentId, setConfirmDeleteDocumentId] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDeleteDocumentId(null);
  }, [document?.id]);

  useEffect(() => {
    let mounted = true;

    void loadConfig()
      .then((config) => {
        if (mounted) {
          setEnableOcr(config.rag.enableOcr);
        }
      })
      .catch((loadError) => {
        console.error('Failed to load config for knowledge document preview:', loadError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const isDeletingDocument = document
    ? isDeletingKnowledgeDocumentById[document.id] ?? false
    : false;
  const isReindexingDocument = document
    ? isReindexingByDocumentId[document.id] ?? false
    : false;
  const reindexState = document ? reindexStatesByDocumentId[document.id] ?? null : null;

  const handleReindex = async () => {
    if (!document) {
      return;
    }

    clearError();
    try {
      await reindexKnowledgeDocument({
        documentId: document.id,
        parseOptions: {
          enableOcr,
        },
      });
    } catch (reindexError) {
      console.error('Failed to reindex knowledge document:', reindexError);
    }
  };

  const handleDeleteDocument = async () => {
    if (!document) {
      return;
    }

    if (confirmDeleteDocumentId !== document.id) {
      setConfirmDeleteDocumentId(document.id);
      return;
    }

    clearError();
    try {
      await deleteKnowledgeDocument(document.id, knowledgeBaseId ?? undefined);
      setConfirmDeleteDocumentId(null);
    } catch (deleteError) {
      console.error('Failed to delete knowledge document:', deleteError);
    }
  };

  if (!document && !isLoadingDocument && !isLoadingChunks) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-amber-900">文档预览</h3>
        <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/80 px-5 py-10 text-center text-sm text-amber-700/80">
          先从左侧选择一个文档，右侧会展示文档详情和 chunk 预览。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-amber-900">文档预览</h3>
          <p className="mt-1 text-sm text-amber-700/80">
            查看当前选中文档的元数据和 chunk 明细，并在这里直接执行重建索引或删除文档。
          </p>
        </div>
        {document && (
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${getIndexStateLabel(document).className}`}>
              {getIndexStateLabel(document).label}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleReindex();
                }}
                disabled={isReindexingDocument || isDeletingDocument}
                className="flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReindexingDocument ? 'animate-spin' : ''}`} />
                {isReindexingDocument ? '重建中...' : '重建索引'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteDocument();
                }}
                disabled={isReindexingDocument || isDeletingDocument}
                className={`flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                  confirmDeleteDocumentId === document.id
                    ? 'border-red-300 bg-red-100 text-red-700 hover:bg-red-200'
                    : 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeletingDocument
                  ? '删除中...'
                  : confirmDeleteDocumentId === document.id
                    ? '确认删除文档'
                    : '删除文档'}
              </button>
            </div>
          </div>
        )}
      </div>

      {(isLoadingDocument || isLoadingChunks) && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <LoaderCircle className="w-4 h-4 animate-spin" />
          正在加载文档预览...
        </div>
      )}

      {document && (
        <>
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 w-4 h-4 flex-shrink-0 text-amber-700" />
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-amber-950">
                  {document.title || document.fileName}
                </p>
                <p className="mt-1 break-all text-xs text-amber-700/75">{document.sourcePath}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-amber-700/80">
              <span className="rounded-full bg-white/90 px-2 py-1">{document.documentType}</span>
              <span className="rounded-full bg-white/90 px-2 py-1">{document.chunkCount} 个 chunk</span>
              <span className="rounded-full bg-white/90 px-2 py-1">{document.embeddingCount} 个 embedding</span>
              {document.fileExtension && (
                <span className="rounded-full bg-white/90 px-2 py-1">.{document.fileExtension}</span>
              )}
            </div>

            <div className="mt-4 grid gap-2 text-xs text-amber-800">
              <div className="flex items-center gap-2">
                <Clock3 className="w-3.5 h-3.5 text-amber-600" />
                <span>最近更新：{formatDateTime(document.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="w-3.5 h-3.5 text-amber-600" />
                <span>最近索引：{formatDateTime(document.indexedAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-amber-600" />
                <span className="break-all">Fingerprint：{document.fingerprint}</span>
              </div>
            </div>

            {reindexState && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-700">
                <div className="flex items-center justify-between gap-3">
                  <span>最近重建索引状态：{reindexState.status === 'running' ? '进行中' : reindexState.status === 'failed' ? '失败' : '完成'}</span>
                  <span>{reindexState.current}/{reindexState.total}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                  <div
                    className={`h-full rounded-full ${
                      reindexState.status === 'failed'
                        ? 'bg-red-400'
                        : reindexState.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(100, reindexState.total > 0 ? (reindexState.current / reindexState.total) * 100 : 0))}%`,
                    }}
                  />
                </div>
                <p className="mt-2">
                  阶段：{formatStage(reindexState.stage)} · {reindexState.message}
                </p>
              </div>
            )}

            {document.lastError && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                <span className="break-words">{document.lastError}</span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-amber-900">Chunk 明细</h4>
              <span className="text-xs text-amber-700/75">{chunks.length} 条</span>
            </div>

            {!isLoadingChunks && chunks.length === 0 && (
              <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-6 text-center text-sm text-amber-700/80">
                当前文档还没有可展示的 chunk。
              </div>
            )}

            {chunks.length > 0 && (
              <div className="mt-3 max-h-[680px] space-y-3 overflow-y-auto pr-1">
                {chunks.map((chunk) => (
                  <article
                    key={chunk.id}
                    className="rounded-2xl border border-amber-200 bg-white/90 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-amber-950">
                          Chunk #{chunk.chunkIndex + 1}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-amber-700/80">
                          <span className="rounded-full bg-amber-50 px-2 py-1">{formatChunkType(chunk)}</span>
                          <span className="rounded-full bg-amber-50 px-2 py-1">{chunk.blockCount} 个 block</span>
                          {chunk.language && (
                            <span className="rounded-full bg-amber-50 px-2 py-1">{chunk.language}</span>
                          )}
                          {chunk.pageNumber !== null && (
                            <span className="rounded-full bg-amber-50 px-2 py-1">第 {chunk.pageNumber} 页</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-amber-600/80">
                        {chunk.startOffset} - {chunk.endOffset}
                      </div>
                    </div>

                    {chunk.headingPath.length > 0 && (
                      <div className="mt-3 flex items-start gap-2 text-xs text-amber-700/80">
                        <MapPin className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
                        <span>{chunk.headingPath.join(' / ')}</span>
                      </div>
                    )}

                    <div className="mt-3 rounded-xl bg-amber-50/70 px-3 py-3 text-[13px] leading-6 text-amber-950 whitespace-pre-wrap break-words">
                      {chunk.text}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default KnowledgeDocumentPreview;
