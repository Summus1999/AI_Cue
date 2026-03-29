import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertCircle, Check, Clock3, FolderOpen, LoaderCircle } from 'lucide-react';
import { loadConfig } from '../../store/config';
import { useRagStore } from '../../store/rag';
import { ragService, type KnowledgeBaseImportStage, type KnowledgeBaseImportTaskSnapshot } from '../../services/ragService';

interface KnowledgeImportPanelProps {
  knowledgeBaseId: string | null;
  knowledgeBaseName?: string | null;
}

type LocalImportStatus = 'queued' | 'failed';

interface LocalImportRow {
  requestId: string;
  knowledgeBaseId: string;
  fileName: string;
  sourcePath: string;
  status: LocalImportStatus;
  stage: KnowledgeBaseImportStage | null;
  current: number;
  total: number;
  message: string;
  updatedAt: number;
}

type ImportRow =
  | {
      requestId: string;
      fileName: string;
      sourcePath: string | null;
      status: KnowledgeBaseImportTaskSnapshot['status'];
      stage: KnowledgeBaseImportStage;
      current: number;
      total: number;
      message: string;
      updatedAt: number;
      chunkCount: number | null;
      embeddingCount: number | null;
      isOptimistic: false;
    }
  | {
      requestId: string;
      fileName: string;
      sourcePath: string;
      status: LocalImportStatus;
      stage: KnowledgeBaseImportStage | null;
      current: number;
      total: number;
      message: string;
      updatedAt: number;
      chunkCount: null;
      embeddingCount: null;
      isOptimistic: true;
    };

function extractFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() || path;
}

function stageLabel(stage: KnowledgeBaseImportStage | null): string {
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
      return '排队中';
  }
}

function statusLabel(status: ImportRow['status']): string {
  switch (status) {
    case 'running':
      return '进行中';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    case 'queued':
      return '等待中';
    default:
      return status;
  }
}

function statusClassName(status: ImportRow['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    case 'failed':
      return 'bg-red-100 text-red-700 border border-red-200';
    case 'running':
      return 'bg-blue-100 text-blue-700 border border-blue-200';
    case 'queued':
      return 'bg-amber-100 text-amber-700 border border-amber-200';
    default:
      return 'bg-amber-100 text-amber-700 border border-amber-200';
  }
}

function progressPercent(row: ImportRow): number {
  if (row.status === 'completed') {
    return 100;
  }
  if (row.total <= 0) {
    return row.status === 'queued' ? 0 : 10;
  }
  return Math.max(0, Math.min(100, Math.round((row.current / row.total) * 100)));
}

export function KnowledgeImportPanel({
  knowledgeBaseId,
  knowledgeBaseName,
}: KnowledgeImportPanelProps) {
  const {
    error,
    clearError,
    importTasksByRequestId,
    isImportingByKnowledgeBaseId,
    refreshKnowledgeImportTasks,
    importKnowledgeDocument,
  } = useRagStore();

  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isChoosingFiles, setIsChoosingFiles] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enableOcr, setEnableOcr] = useState(false);
  const [localRowsByRequestId, setLocalRowsByRequestId] = useState<Record<string, LocalImportRow>>({});

  const isImporting = knowledgeBaseId
    ? isImportingByKnowledgeBaseId[knowledgeBaseId] ?? false
    : false;

  useEffect(() => {
    let mounted = true;

    void loadConfig()
      .then((config) => {
        if (mounted) {
          setEnableOcr(config.rag.enableOcr);
        }
      })
      .catch((loadError) => {
        console.error('Failed to load config for knowledge import panel:', loadError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setSelectedPaths([]);
  }, [knowledgeBaseId]);

  useEffect(() => {
    if (!knowledgeBaseId) {
      return;
    }

    void refreshKnowledgeImportTasks(knowledgeBaseId, undefined, true).catch((refreshError) => {
      console.error('Failed to load knowledge import tasks:', refreshError);
    });
  }, [knowledgeBaseId, refreshKnowledgeImportTasks]);

  useEffect(() => {
    setLocalRowsByRequestId((current) => {
      let changed = false;
      const next = { ...current };

      Object.keys(next).forEach((requestId) => {
        if (importTasksByRequestId[requestId]) {
          delete next[requestId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [importTasksByRequestId]);

  const importRows = useMemo<ImportRow[]>(() => {
    const rowsByRequestId = new Map<string, ImportRow>();

    Object.values(localRowsByRequestId)
      .filter((row) => !knowledgeBaseId || row.knowledgeBaseId === knowledgeBaseId)
      .forEach((row) => {
        rowsByRequestId.set(row.requestId, {
          ...row,
          chunkCount: null,
          embeddingCount: null,
          isOptimistic: true,
        });
      });

    Object.values(importTasksByRequestId)
      .filter((task) => task.operation === 'import')
      .filter((task) => !knowledgeBaseId || task.knowledgeBaseId === knowledgeBaseId)
      .forEach((task) => {
        rowsByRequestId.set(task.requestId, {
          requestId: task.requestId,
          fileName: task.fileName || '未命名文件',
          sourcePath: task.sourcePath ?? null,
          status: task.status,
          stage: task.stage,
          current: task.current,
          total: task.total,
          message: task.message,
          updatedAt: task.updatedAt,
          chunkCount: task.chunkCount ?? null,
          embeddingCount: task.embeddingCount ?? null,
          isOptimistic: false,
        });
      });

    return Array.from(rowsByRequestId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8);
  }, [importTasksByRequestId, knowledgeBaseId, localRowsByRequestId]);

  const handleChooseFiles = async () => {
    clearError();
    setIsChoosingFiles(true);

    try {
      const selected = await open({
        multiple: true,
        directory: false,
      });

      const paths = Array.isArray(selected)
        ? selected
        : selected
          ? [selected]
          : [];

      setSelectedPaths(Array.from(new Set(paths)));
    } catch (chooseError) {
      console.error('Failed to choose knowledge files:', chooseError);
    } finally {
      setIsChoosingFiles(false);
    }
  };

  const handleImport = async () => {
    if (!knowledgeBaseId || selectedPaths.length === 0) {
      return;
    }

    clearError();
    setIsSubmitting(true);

    const queuedImports = selectedPaths.map((path) => ({
      requestId: ragService.createKnowledgeBaseImportProgressId(),
      path,
      fileName: extractFileName(path),
    }));

    setLocalRowsByRequestId((current) => {
      const next = { ...current };
      const now = Date.now();

      queuedImports.forEach((item, index) => {
        next[item.requestId] = {
          requestId: item.requestId,
          knowledgeBaseId,
          fileName: item.fileName,
          sourcePath: item.path,
          status: 'queued',
          stage: null,
          current: 0,
          total: 1,
          message: index === 0 ? '等待开始导入' : '已加入导入队列',
          updatedAt: now + index,
        };
      });

      return next;
    });

    setSelectedPaths([]);

    try {
      for (const item of queuedImports) {
        try {
          await importKnowledgeDocument({
            knowledgeBaseId,
            path: item.path,
            parseOptions: {
              enableOcr,
            },
            progressEventId: item.requestId,
          });
        } catch (importError) {
          const message = importError instanceof Error ? importError.message : '导入失败';

          setLocalRowsByRequestId((current) => ({
            ...current,
            [item.requestId]: {
              requestId: item.requestId,
              knowledgeBaseId,
              fileName: item.fileName,
              sourcePath: item.path,
              status: 'failed',
              stage: 'finalize',
              current: 0,
              total: 1,
              message,
              updatedAt: Date.now(),
            },
          }));
        }
      }
    } finally {
      setIsSubmitting(false);
      void refreshKnowledgeImportTasks(knowledgeBaseId, undefined, true).catch((refreshError) => {
        console.error('Failed to refresh import tasks after import:', refreshError);
      });
    }
  };

  const isDisabled = !knowledgeBaseId;

  return (
    <section className="rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">导入文档</h3>
          <p className="mt-1 text-sm text-amber-700/80">
            选择本地文件并导入当前知识库，界面会立即创建状态行，并持续显示解析、分块、向量化和收尾阶段进度。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-amber-700/80">
            <span className="rounded-full bg-amber-50 px-2 py-1">
              目标知识库：{knowledgeBaseName || '未选择'}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-1">
              OCR：{enableOcr ? '已启用' : '未启用'}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-1">
              支持逐个顺序导入
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleChooseFiles}
            disabled={isDisabled || isChoosingFiles || isSubmitting}
            className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-4 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isChoosingFiles ? (
              <LoaderCircle className="w-4 h-4 animate-spin" />
            ) : (
              <FolderOpen className="w-4 h-4" />
            )}
            选择文件
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isDisabled || selectedPaths.length === 0 || isSubmitting}
            className="rounded-xl border border-amber-700 bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? '导入中...' : `导入选中${selectedPaths.length > 0 ? ` (${selectedPaths.length})` : ''}`}
          </button>
        </div>
      </div>

      {isDisabled && (
        <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-4 text-sm text-amber-700/80">
          当前没有可用的目标知识库。后续步骤会补齐完整的知识库管理入口。
        </div>
      )}

      {!isDisabled && selectedPaths.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-amber-900">待导入文件</p>
            <button
              type="button"
              onClick={() => setSelectedPaths([])}
              className="text-xs text-amber-700 transition-colors hover:text-amber-900"
            >
              清空
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedPaths.map((path) => (
              <span
                key={path}
                className="max-w-full rounded-full bg-white px-3 py-1 text-xs text-amber-800"
                title={path}
              >
                {extractFileName(path)}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 w-4 h-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-amber-900">导入状态</h4>
            <p className="mt-1 text-xs text-amber-700/75">
              这里会保留最近的导入任务，失败任务不会被静默吞掉。
            </p>
          </div>
          {(isSubmitting || isImporting) && (
            <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-medium text-blue-700 border border-blue-200">
              正在导入
            </span>
          )}
        </div>

        {importRows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-white/70 px-4 py-6 text-center text-sm text-amber-700/80">
            还没有导入记录。选择文件后，这里会先出现乐观状态行，再逐步更新为真实阶段进度。
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {importRows.map((row) => {
              const percent = progressPercent(row);
              return (
                <article
                  key={row.requestId}
                  className={`rounded-2xl border px-4 py-4 ${
                    row.status === 'failed'
                      ? 'border-red-200 bg-red-50/70'
                      : 'border-amber-200 bg-white/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-amber-950">{row.fileName}</p>
                      {row.sourcePath && (
                        <p className="mt-1 truncate text-xs text-amber-700/70" title={row.sourcePath}>
                          {row.sourcePath}
                        </p>
                      )}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusClassName(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-amber-700/80">
                    <span className="rounded-full bg-amber-50 px-2 py-1">阶段：{stageLabel(row.stage)}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1">
                      进度：{row.current}/{row.total}
                    </span>
                    {row.chunkCount !== null && (
                      <span className="rounded-full bg-amber-50 px-2 py-1">{row.chunkCount} 个 chunk</span>
                    )}
                    {row.embeddingCount !== null && (
                      <span className="rounded-full bg-amber-50 px-2 py-1">{row.embeddingCount} 个 embedding</span>
                    )}
                    {row.isOptimistic && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">乐观状态</span>
                    )}
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        row.status === 'failed'
                          ? 'bg-red-400'
                          : row.status === 'completed'
                            ? 'bg-emerald-500'
                            : row.status === 'queued'
                              ? 'bg-amber-400'
                              : 'bg-blue-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-3 text-xs">
                    <div className="flex items-start gap-2 text-amber-800">
                      {row.status === 'completed' ? (
                        <Check className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                      ) : row.status === 'failed' ? (
                        <AlertCircle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-red-600" />
                      ) : row.status === 'running' ? (
                        <LoaderCircle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 animate-spin text-blue-600" />
                      ) : (
                        <Clock3 className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
                      )}
                      <span className="break-words">{row.message}</span>
                    </div>
                    <span className="whitespace-nowrap text-amber-700/70">{percent}%</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default KnowledgeImportPanel;
