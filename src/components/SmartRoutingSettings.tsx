// 智能路由候选列表设置组件

import { useState } from 'react';
import { Plus, Trash2, GripVertical, AlertCircle, Zap } from 'lucide-react';
import type { SmartRouteEntry, SmartRoutingConfig, ProviderType } from '../store/config';
import { PROVIDERS, PROVIDER_MODELS } from '../store/config';

interface SmartRoutingSettingsProps {
  config: SmartRoutingConfig;
  configuredProviders: ProviderType[];
  onChange: (updates: Partial<SmartRoutingConfig>) => void;
}

export function SmartRoutingSettings({
  config,
  configuredProviders,
  onChange,
}: SmartRoutingSettingsProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addProvider, setAddProvider] = useState<ProviderType | ''>('');
  const [addModel, setAddModel] = useState('');

  const handleAdd = () => {
    if (!addProvider || !addModel) return;
    const id = `${addProvider}:${addModel}`;
    if (config.entries.some((e) => e.id === id)) return;
    const maxPriority = config.entries.reduce((max, e) => Math.max(max, e.priority), 0);
    const newEntry: SmartRouteEntry = {
      id,
      provider: addProvider,
      model: addModel,
      priority: maxPriority + 1,
    };
    onChange({ entries: [...config.entries, newEntry] });
    setShowAddDialog(false);
    setAddProvider('');
    setAddModel('');
  };

  const handleRemove = (id: string) => {
    onChange({ entries: config.entries.filter((e) => e.id !== id) });
  };

  const handlePriorityChange = (id: string, delta: number) => {
    const idx = config.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const newEntries = [...config.entries];
    const swapIdx = idx + delta;
    if (swapIdx < 0 || swapIdx >= newEntries.length) return;
    const temp = newEntries[idx].priority;
    newEntries[idx] = { ...newEntries[idx], priority: newEntries[swapIdx].priority };
    newEntries[swapIdx] = { ...newEntries[swapIdx], priority: temp };
    onChange({ entries: newEntries });
  };

  // 一键添加所有已配 API Key 的 Provider 的全部模型
  const handleAddAll = () => {
    const newEntries: SmartRouteEntry[] = [];
    for (const p of configuredProviders) {
      const models = PROVIDER_MODELS[p] || [];
      for (const m of models) {
        const id = `${p}:${m.id}`;
        if (!config.entries.some((e) => e.id === id)) {
          newEntries.push({ id, provider: p, model: m.id, priority: 0 });
        }
      }
    }
    if (newEntries.length === 0) return;
    const maxPriority = config.entries.reduce((max, e) => Math.max(max, e.priority), 0);
    onChange({
      entries: [
        ...config.entries,
        ...newEntries.map((e, i) => ({ ...e, priority: maxPriority + 1 + i })),
      ],
    });
  };

  const handleMoveUp = (id: string) => handlePriorityChange(id, -1);
  const handleMoveDown = (id: string) => handlePriorityChange(id, 1);

  const sortedEntries = [...config.entries].sort((a, b) => a.priority - b.priority);

  const getProviderName = (p: ProviderType) =>
    PROVIDERS.find((x) => x.id === p)?.name || p;

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
        智能路由
      </label>
      <p className="text-xs text-amber-600">
        当多个 AI 模型可用时，按优先级自动选择延迟最低的模型。不可用时自动降级到下一优先级。
      </p>

      {/* 总开关 */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-amber-800">启用智能路由</span>
        <button
          type="button"
          onClick={() => onChange({ enabled: !config.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
            config.enabled ? 'bg-amber-600' : 'bg-amber-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 延迟阈值 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-700">延迟阈值</span>
          <span className="text-xs text-amber-500">{config.latencyThreshold}ms</span>
        </div>
        <input
          type="range"
          min={1000}
          max={10000}
          step={500}
          value={config.latencyThreshold}
          onChange={(e) => onChange({ latencyThreshold: Number(e.target.value) })}
          className="w-full h-1.5 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
        />
        <div className="flex justify-between text-[10px] text-amber-400">
          <span>1s</span>
          <span>10s</span>
        </div>
      </div>

      {/* 候选列表 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-700">候选模型列表</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleAddAll}
              disabled={configuredProviders.length === 0}
              className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-700 disabled:opacity-40"
              title="一键添加所有已配置 Provider 的模型"
            >
              <Zap className="w-3 h-3" />
              一键
            </button>
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800"
            >
              <Plus className="w-3 h-3" />
              手动
            </button>
          </div>
        </div>

        {sortedEntries.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-100/50 rounded-lg px-3 py-4 justify-center">
            <AlertCircle className="w-3.5 h-3.5" />
            尚未添加候选模型，请点击「一键」或「手动」添加
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {sortedEntries.map((entry, idx) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 bg-white/60 rounded-lg px-2 py-1.5 border border-amber-200"
              >
                <div className="flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(entry.id)}
                    disabled={idx === 0}
                    className="text-amber-400 hover:text-amber-600 disabled:opacity-30 text-xs leading-none"
                  >
                    ▲
                  </button>
                  <span className="text-[10px] text-amber-400 font-mono">
                    P{entry.priority}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(entry.id)}
                    disabled={idx === sortedEntries.length - 1}
                    className="text-amber-400 hover:text-amber-600 disabled:opacity-30 text-xs leading-none"
                  >
                    ▼
                  </button>
                </div>
                <GripVertical className="w-3 h-3 text-amber-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-amber-800 block truncate">
                    {getProviderName(entry.provider)}
                  </span>
                  <span className="text-[10px] text-amber-500 block truncate">
                    {entry.model}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  className="text-amber-300 hover:text-red-500 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加候选弹窗 */}
      {showAddDialog && (
        <div className="bg-amber-100/80 rounded-lg p-3 border border-amber-300 space-y-2">
          <select
            value={addProvider}
            onChange={(e) => {
              setAddProvider(e.target.value as ProviderType);
              setAddModel('');
            }}
            className="w-full px-2 py-1.5 bg-white border border-amber-300 rounded text-xs"
          >
            <option value="">选择 Provider</option>
            {configuredProviders.map((p) => (
              <option key={p} value={p}>
                {getProviderName(p)}
              </option>
            ))}
          </select>
          {addProvider && (
            <select
              value={addModel}
              onChange={(e) => setAddModel(e.target.value)}
              className="w-full px-2 py-1.5 bg-white border border-amber-300 rounded text-xs"
            >
              <option value="">选择模型</option>
              {(PROVIDER_MODELS[addProvider] || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowAddDialog(false)}
              className="px-2 py-1 text-xs text-amber-600"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addProvider || !addModel}
              className="px-3 py-1 text-xs bg-amber-500 text-white rounded disabled:opacity-50"
            >
              确认添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
