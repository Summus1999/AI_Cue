import { AlertCircle, FileText, LoaderCircle } from 'lucide-react';
import type { KnowledgeDocumentRecord } from '../../services/ragService';

interface KnowledgeDocumentListProps {
  documents: KnowledgeDocumentRecord[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onSelectDocument: (documentId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return '刚刚更新';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前更新`;
  }
  if (hours < 24) {
    return `${hours} 小时前更新`;
  }
  if (days < 7) {
    return `${days} 天前更新`;
  }
  return `${new Date(timestamp).toLocaleDateString('zh-CN')} 更新`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export function KnowledgeDocumentList({
  documents,
  currentDocumentId,
  isLoading,
  onSelectDocument,
}: KnowledgeDocumentListProps) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">文档列表</h3>
          <p className="mt-1 text-sm text-amber-700/80">
            当前知识库下共有 {documents.length} 个文档，选择后会在右侧显示文档详情和 chunk 预览。
          </p>
        </div>
        <div className="rounded-xl bg-amber-100 px-3 py-2 text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-500">Docs</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">{documents.length}</p>
        </div>
      </div>

      {isLoading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <LoaderCircle className="w-4 h-4 animate-spin" />
          正在加载文档列表...
        </div>
      )}

      {!isLoading && documents.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/80 px-5 py-8 text-center text-sm text-amber-700/80">
          当前知识库还没有文档。你可以先在上方导入区选择文件并开始导入。
        </div>
      )}

      {!isLoading && documents.length > 0 && (
        <div className="mt-4 space-y-3">
          {documents.map((document) => {
            const state = getIndexStateLabel(document);
            const isActive = document.id === currentDocumentId;

            return (
              <button
                key={document.id}
                type="button"
                onClick={() => onSelectDocument(document.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                  isActive
                    ? 'border-amber-400 bg-amber-100/90'
                    : 'border-amber-200 bg-amber-50/60 hover:bg-amber-100/70'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 flex-shrink-0 text-amber-700" />
                      <p className="truncate text-sm font-medium text-amber-950">
                        {document.title || document.fileName}
                      </p>
                    </div>
                    <p className="mt-1 truncate text-xs text-amber-700/70">{document.fileName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${state.className}`}>
                      {state.label}
                    </span>
                    {isActive && (
                      <span className="rounded-full bg-amber-600 px-2 py-1 text-[10px] font-medium text-white">
                        当前
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-amber-700/80">
                  <span className="rounded-full bg-white/80 px-2 py-1">{document.chunkCount} 个 chunk</span>
                  <span className="rounded-full bg-white/80 px-2 py-1">{document.embeddingCount} 个 embedding</span>
                  <span className="rounded-full bg-white/80 px-2 py-1">{formatFileSize(document.sourceByteSize)}</span>
                  <span className="rounded-full bg-white/80 px-2 py-1">{formatRelativeTime(document.updatedAt)}</span>
                </div>

                {document.lastError && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                    <span className="break-words">{document.lastError}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default KnowledgeDocumentList;
