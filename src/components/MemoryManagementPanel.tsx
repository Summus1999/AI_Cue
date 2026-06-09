import { Brain, RefreshCw, Trash2, X, Edit3, Check, AlertTriangle, ChevronLeft, Archive } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadConfig, type AppConfig } from '../store/config';
import {
  listMemories,
  updateMemory,
  deleteMemory,
  runMemoryMaintenance,
  getMemoryTypeLabel,
  getSourceTypeLabel,
  getMemoryTypeColor,
  type MemoryRecord,
  type MemoryStatus,
  type MemoryType,
} from '../services/memoryService';
import { createLogger } from '../services/logger';

const log = createLogger('MemoryManagementPanel');

interface MemoryManagementPanelProps {
  onBack: () => void;
}

type FilterMode = 'all' | 'active' | 'archived';

export function MemoryManagementPanel({ onBack }: MemoryManagementPanelProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [maintaining, setMaintaining] = useState(false);
  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editImportance, setEditImportance] = useState(5);
  const [editStatus, setEditStatus] = useState<MemoryStatus>('active');
  const [saving, setSaving] = useState(false);

  // 加载配置
  useEffect(() => {
    loadConfig().then(setConfig).catch(log.error);
  }, []);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status: MemoryStatus | null =
        filter === 'all' ? null : (filter as MemoryStatus);
      const list = await listMemories(status);
      setMemories(list);
      if (selectedId && !list.find((m) => m.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (e) {
      setError(`加载记忆失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [filter, selectedId]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const filteredMemories = useMemo(() => memories, [memories]);

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId],
  );

  const typeCounts = useMemo(() => {
    const counts: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      profile: 0,
      procedural: 0,
    };
    memories.forEach((m) => {
      counts[m.memoryType] = (counts[m.memoryType] || 0) + 1;
    });
    return counts;
  }, [memories]);

  const activeCount = memories.filter((m) => m.status === 'active').length;
  const archivedCount = memories.filter((m) => m.status === 'archived').length;

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条记忆吗？关联的向量数据也会被删除。')) return;
    try {
      await deleteMemory(id);
      if (selectedId === id) setSelectedId(null);
      if (editingId === id) setEditingId(null);
      await loadMemories();
    } catch (e) {
      setError(`删除失败: ${e}`);
    }
  };

  const startEditing = (memory: MemoryRecord) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditImportance(memory.importance);
    setEditStatus(memory.status);
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateMemory(editingId, {
        content: editContent.trim(),
        importance: Math.min(10, Math.max(1, editImportance)),
        status: editStatus,
      });
      setEditingId(null);
      await loadMemories();
    } catch (e) {
      setError(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleMaintenance = async () => {
    if (!config) {
      setError('配置未加载，无法执行维护');
      return;
    }
    setMaintaining(true);
    setMaintenanceResult(null);
    setError(null);
    try {
      const chatConfig = config.providerConfigs[config.activeProvider];
      const embeddingProvider = config.rag.embeddingProvider;
      const embeddingConfig = config.providerConfigs[embeddingProvider];
      const result = await runMemoryMaintenance({
        provider: config.activeProvider,
        config: {
          apiKey: chatConfig.apiKey.trim(),
          baseUrl: chatConfig.baseUrl?.trim() || null,
        },
        model: chatConfig.model,
        embeddingConfig: {
          provider: embeddingProvider,
          apiKey: embeddingConfig.apiKey.trim(),
          baseUrl: embeddingConfig.baseUrl?.trim() || null,
          model: config.rag.embeddingModel?.trim() || null,
        },
      });
      setMaintenanceResult(
        `衰减归档 ${result.decayedCount} 条` +
          (result.reflectionTriggered
            ? `，反思生成 ${result.reflectionProfileCount} 条画像记忆`
            : '，未达反思阈值') +
          `（当前 active 情景+语义记忆 ${result.activeSourceCount} 条）`,
      );
      await loadMemories();
    } catch (e) {
      setError(`维护执行失败: ${e}`);
    } finally {
      setMaintaining(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return (
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-sm">
      <div className="flex items-center justify-between shrink-0 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronLeft className="w-4 h-4" />
            返回
          </button>
          <Brain className="w-5 h-5 text-purple-600" />
          <div>
            <h2 className="text-sm font-semibold text-gray-800">个人面试记忆</h2>
            <p className="text-xs text-gray-500">
              {memories.length} 条记忆（活跃 {activeCount} · 归档 {archivedCount}）
            </p>
          </div>
        </div>
        <button
          onClick={() => void handleMaintenance()}
          disabled={maintaining}
          className="flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50"
        >
          <RefreshCw className={['w-3.5 h-3.5', maintaining ? 'animate-spin' : ''].join(' ')} />
          {maintaining ? '维护中...' : '运行维护'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 hover:text-red-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {maintenanceResult && (
        <div className="mx-4 mt-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700">
          {maintenanceResult}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2 shrink-0">
        {(['episodic', 'semantic', 'profile', 'procedural'] as MemoryType[]).map(
          (type) =>
            typeCounts[type] > 0 && (
              <span
                key={type}
                className={['rounded-full px-2 py-0.5 text-xs font-medium', getMemoryTypeColor(type)].join(' ')}
              >
                {getMemoryTypeLabel(type)} {typeCounts[type]}
              </span>
            ),
        )}
        <div className="flex-1" />
        <div className="flex items-center rounded-lg border border-gray-200 bg-white text-xs">
          {(['all', 'active', 'archived'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={[
                'px-2.5 py-1 first:rounded-l-lg last:rounded-r-lg',
                filter === mode ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {mode === 'all' ? '全部' : mode === 'active' ? '活跃' : '归档'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-gray-100">
          {loading ? (
            <div className="p-4 text-center text-xs text-gray-400">加载中...</div>
          ) : filteredMemories.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">
              暂无记忆。助手对话中的面试题会自动抽取。
            </div>
          ) : (
            filteredMemories.map((memory) => (
              <button
                key={memory.id}
                onClick={() => setSelectedId(memory.id)}
                className={[
                  'w-full border-b border-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-50',
                  selectedId === memory.id ? 'bg-purple-50 border-l-2 border-l-purple-500' : '',
                ].join(' ')}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={['rounded px-1.5 py-0.5 text-[10px] font-medium', getMemoryTypeColor(memory.memoryType)].join(' ')}
                  >
                    {getMemoryTypeLabel(memory.memoryType)}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {getSourceTypeLabel(memory.sourceType)}
                  </span>
                  {memory.status === 'archived' && (
                    <Archive className="w-3 h-3 text-gray-400" />
                  )}
                </div>
                <p className="text-xs text-gray-700 line-clamp-2">{memory.content}</p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                  <span>重要性 {memory.importance}/10</span>
                  <span>出现 {memory.occurrenceCount} 次</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              选择左侧记忆查看详情
            </div>
          ) : editingId === selected.id ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">编辑记忆</h3>
                <button
                  onClick={cancelEditing}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">记忆内容</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">重要性 (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={editImportance}
                    onChange={(e) => setEditImportance(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">状态</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as MemoryStatus)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  >
                    <option value="active">活跃</option>
                    <option value="archived">已归档</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void saveEditing()}
                  disabled={saving || editContent.trim().length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={cancelEditing}
                  className="rounded-lg px-4 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-100"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={['rounded px-2 py-0.5 text-xs font-medium', getMemoryTypeColor(selected.memoryType)].join(' ')}
                  >
                    {getMemoryTypeLabel(selected.memoryType)}
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {getSourceTypeLabel(selected.sourceType)}
                  </span>
                  {selected.status === 'archived' && (
                    <span className="flex items-center gap-1 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      <Archive className="w-3 h-3" />
                      已归档
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEditing(selected)}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-purple-600"
                    title="编辑"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(selected.id)}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  记忆内容
                </h4>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {selected.content}
                </p>
              </div>

              {selected.structuredJson &&
                Object.keys(selected.structuredJson).length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                      结构化信息
                    </h4>
                    <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 overflow-x-auto">
                      {JSON.stringify(selected.structuredJson, null, 2)}
                    </pre>
                  </div>
                )}

              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  记忆元数据
                </h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-600">
                  <div>
                    <span className="text-gray-400">重要性:</span> {selected.importance}/10
                  </div>
                  <div>
                    <span className="text-gray-400">出现次数:</span> {selected.occurrenceCount}
                  </div>
                  <div>
                    <span className="text-gray-400">衰减分:</span>{' '}
                    {selected.decayScore.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-gray-400">Embedding 模型:</span>{' '}
                    {selected.embeddingModelId || '无'}
                  </div>
                  <div>
                    <span className="text-gray-400">创建时间:</span>{' '}
                    {formatTime(selected.createdAt)}
                  </div>
                  <div>
                    <span className="text-gray-400">最近活跃:</span>{' '}
                    {formatTime(selected.lastSeenAt)}
                  </div>
                  <div>
                    <span className="text-gray-400">最近检索:</span>{' '}
                    {selected.lastRetrievedAt
                      ? formatTime(selected.lastRetrievedAt)
                      : '从未'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
