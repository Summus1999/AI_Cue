# Smart Routing 智能路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于网络状态的 AI Provider 智能路由，用户设定优先级后系统自动选择延迟最低的可用模型，不可用时无缝降级。

**Architecture:** 前端新增 `smartRouter.ts` 服务层，在 `sendStream` 入口前执行 pre-flight 批量健康探测，按优先级+延迟选最优 Provider。后端新增 `batch_health_check` 命令并行探测所有候选。配置通过现有 Zustand Store 持久化，Feature Gate 控制灰度开关。

**Tech Stack:** TypeScript (React 19 + Zustand 5), Rust (Tauri 2 + reqwest + tokio)

---

### File Structure

| File | Operation | Responsibility |
|---|---|---|
| `src/store/config.ts` | Modify | 新增 SmartRoutingConfig 类型、默认值、迁移、持久化 |
| `src-tauri/src/commands.rs` | Modify | 新增 `batch_health_check` 命令 |
| `src-tauri/src/lib.rs` | Modify | 注册 `batch_health_check` |
| `src/services/smartRouter.ts` | **Create** | 路由决策核心：优先级分组、健康探测、模型选择 |
| `src/services/aiChat.ts` | Modify | `sendStream` 入口接入 smartRouter |
| `src/components/SmartRoutingSettings.tsx` | **Create** | 候选列表管理 UI（排序、增删、阈值配置） |
| `src/components/SettingsPanel.tsx` | Modify | 集成智能路由设置区域 + feature gate 开关 |

---

### Task 1: 数据模型 & 配置持久化

**Files:**
- Modify: `src/store/config.ts`

- [ ] **Step 1: 新增类型定义和默认值**

在 `FeatureGates` 接口中添加 `smartRouting` 字段：

```typescript
export interface FeatureGates {
  // ... existing fields ...
  smartRouting: boolean; // 智能路由，默认 false
}

export const DEFAULT_FEATURE_GATES: FeatureGates = {
  // ... existing defaults ...
  smartRouting: false,
};
```

新增 `SmartRouteEntry` 和 `SmartRoutingConfig` 类型（放在 `PromptMode` 类型附近）：

```typescript
// 智能路由候选条目，id = `${provider}:${model}`
export interface SmartRouteEntry {
  id: string;
  provider: ProviderType;
  model: string;
  priority: number;
}

export interface SmartRoutingConfig {
  enabled: boolean;
  latencyThreshold: number;  // ms，默认 3000
  entries: SmartRouteEntry[];
}
```

在 `AppConfig` 接口末尾新增：

```typescript
smartRouting: SmartRoutingConfig;
```

新增默认值常量：

```typescript
export const DEFAULT_SMART_ROUTING_CONFIG: SmartRoutingConfig = {
  enabled: false,
  latencyThreshold: 3000,
  entries: [],
};
```

在 `DEFAULT_CONFIG` 中新增：

```typescript
smartRouting: DEFAULT_SMART_ROUTING_CONFIG,
```

- [ ] **Step 2: 添加配置迁移**

在 `migrateConfig` 函数中处理 smartRouting 字段缺失的情况（旧配置没有该字段）：

```typescript
// 在 migrateConfig 返回之前补充
smartRouting: parsed.smartRouting || DEFAULT_SMART_ROUTING_CONFIG,
```

- [ ] **Step 3: 添加持久化读写**

在 `loadConfig` 中新增读取：

```typescript
const smartRouting = await store.get<SmartRoutingConfig>('smartRouting');
// 在 config 对象中使用
smartRouting: smartRouting || DEFAULT_SMART_ROUTING_CONFIG,
```

在 `saveConfig` 中新增写入：

```typescript
await store.set('smartRouting', config.smartRouting);
```

- [ ] **Step 4: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors related to new types.

- [ ] **Step 5: Commit**

```bash
git add src/store/config.ts
git commit -m "feat: add SmartRoutingConfig data model and persistence"
```

---

### Task 2: 后端 batch_health_check 命令

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 确认现有 check_network_health 可复用逻辑**

现有 `check_network_health`（commands.rs:142-199）的 HTTP 探测和状态码判断逻辑直接可用。`batch_health_check` 的核心是"并行版 check_network_health"。

- [ ] **Step 2: 添加输入输出类型**

在 `commands.rs` 顶部，新增 use 后添加类型定义：

```rust
// 批量健康检查 — 输入
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthCheckCandidate {
    id: String,
    provider_type: String,
    base_url: Option<String>,
    #[allow(dead_code)]
    api_key: Option<String>,  // 保留字段用于未来认证探测，当前 HEAD 请求不发送
}

// 前端调用参数对应 (smartRouter.ts)
// interface HealthCheckCandidate {
//   id: string;
//   providerType: string;
//   baseUrl: string | null;
//   apiKey?: string;  // 保留，与 Rust 结构对齐
// }

// 批量健康检查 — 单个结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateHealthStatus {
    id: String,
    reachable: bool,
    latency_ms: Option<u64>,
    error_detail: Option<String>,
}

// 批量健康检查 — 输出
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchHealthCheckResult {
    results: Vec<CandidateHealthStatus>,
}
```

- [ ] **Step 3: 实现 batch_health_check 命令**

在 `check_network_health` 函数后面插入：

```rust
/// 批量探测多个 Provider 的网络可达性和延迟
/// 并行发起 HEAD 请求，每个候选独立超时
#[tauri::command]
pub async fn batch_health_check(
    candidates: Vec<HealthCheckCandidate>,
    timeout_ms: u64,
) -> Result<BatchHealthCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    // 并行探测所有候选
    let futures: Vec<_> = candidates
        .into_iter()
        .map(|c| {
            let client = client.clone();
            let timeout_dur = Duration::from_millis(timeout_ms);
            async move {
                let start = Instant::now();
                let target_url = c.base_url.unwrap_or_else(|| {
                    match c.provider_type.as_str() {
                        "qwen" => "https://dashscope.aliyuncs.com".to_string(),
                        "openai_compat" => "https://api.openai.com".to_string(),
                        "claude" => "https://api.anthropic.com".to_string(),
                        _ => "https://www.google.com".to_string(),
                    }
                });

                let result = timeout(timeout_dur, client.head(&target_url).send()).await;
                let latency = start.elapsed().as_millis().min(u64::MAX as u128) as u64;

                match result {
                    Ok(Ok(response)) => {
                        let status = response.status().as_u16();
                        // 200-499 视为可达（与 check_network_health 逻辑一致）
                        let reachable = !(500..=599).contains(&status);
                        CandidateHealthStatus {
                            id: c.id,
                            reachable,
                            latency_ms: Some(latency),
                            error_detail: if reachable { None } else { Some(format!("HTTP {}", status)) },
                        }
                    }
                    _ => CandidateHealthStatus {
                        id: c.id,
                        reachable: false,
                        latency_ms: None,
                        error_detail: Some("连接超时或网络不可达".to_string()),
                    },
                }
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    Ok(BatchHealthCheckResult { results })
}
```

- [ ] **Step 4: 注册命令**

在 `src-tauri/src/lib.rs` 中注册：

找到现有 `commands::check_network_health` 注册处，在附近添加：

```rust
commands::batch_health_check,
```

- [ ] **Step 5: 验证编译**

Run: `cargo check`
Expected: No compilation errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add batch_health_check command for parallel provider probing"
```

---

### Task 3: 核心路由器服务

**Files:**
- Create: `src/services/smartRouter.ts`

- [ ] **Step 1: 创建 smartRouter.ts**

```typescript
// 智能路由服务 — pre-flight 探测 + 优先级选择

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, SmartRouteEntry, ProviderType } from '../store/config';

// 路由选择结果
export interface RouteSelection {
  provider: ProviderType;
  model: string;
  entryId: string;
}

// 后端批量健康检查返回
interface CandidateHealthStatus {
  id: string;
  reachable: boolean;
  latencyMs: number | null;
  errorDetail: string | null;
}

// 前端调用参数
interface HealthCheckCandidate {
  id: string;
  providerType: string;
  baseUrl: string | null;
}

// 按优先级分组
function groupByPriority(entries: SmartRouteEntry[]): Map<number, SmartRouteEntry[]> {
  const groups = new Map<number, SmartRouteEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.priority);
    if (list) {
      list.push(entry);
    } else {
      groups.set(entry.priority, [entry]);
    }
  }
  // 按优先级升序排序（1 最高）
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

// 将 SmartRouteEntry 转换为 HealthCheckCandidate
function entriesToCandidates(
  entries: SmartRouteEntry[],
  config: AppConfig,
): HealthCheckCandidate[] {
  return entries
    .filter((entry) => {
      const pc = config.providerConfigs[entry.provider];
      return pc?.apiKey?.trim();
    })
    .map((entry) => {
      const pc = config.providerConfigs[entry.provider];
      return {
        id: entry.id,
        providerType: entry.provider,
        baseUrl: pc.baseUrl?.trim() || null,
      };
    });
}

// 核心选择函数
export async function selectProvider(
  config: AppConfig,
  degradedModels: Set<string>,
): Promise<RouteSelection | null> {
  const { smartRouting } = config;

  // 开关未启用或无候选列表，不干预
  if (!smartRouting.enabled || smartRouting.entries.length === 0) {
    return null;
  }

  const priorityGroups = groupByPriority(smartRouting.entries);

  // 从高优先级到低优先级尝试
  for (const [, entries] of priorityGroups) {
    // 过滤本 session 已降级的模型
    const activeEntries = entries.filter((e) => !degradedModels.has(e.id));
    if (activeEntries.length === 0) continue;

    // 同优先级的候选进行批量探测
    const candidates = entriesToCandidates(activeEntries, config);
    if (candidates.length === 0) continue;

    let statuses: CandidateHealthStatus[];
    try {
      const result = await invoke<{ results: CandidateHealthStatus[] }>(
        'batch_health_check',
        { candidates, timeoutMs: 5000 },
      );
      statuses = result.results;
    } catch {
      // 健康检查本身失败，跳过该优先级组
      continue;
    }

    // 筛选可达且延迟低于阈值的候选
    const viable = statuses
      .filter(
        (s) =>
          s.reachable &&
          s.latencyMs !== null &&
          s.latencyMs <= smartRouting.latencyThreshold,
      )
      .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));

    if (viable.length > 0) {
      const best = viable[0];
      const entry = activeEntries.find((e) => e.id === best.id);
      if (entry) {
        return {
          provider: entry.provider,
          model: entry.model,
          entryId: entry.id,
        };
      }
    }
  }

  // 所有候选都不可用，返回 null 让调用方用 activeProvider 兜底
  return null;
}
```

- [ ] **Step 2: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors in smartRouter.ts.

- [ ] **Step 3: Commit**

```bash
git add src/services/smartRouter.ts
git commit -m "feat: add smartRouter service with priority-based provider selection"
```

---

### Task 4: 接入 aiChat.ts sendStream

**Files:**
- Modify: `src/services/aiChat.ts`

- [ ] **Step 1: 扩展 StreamResult 类型**

在 `aiChat.ts` 顶部，`StreamResult` 接口新增字段，使调用方能知道路由实际选中的模型：

```typescript
export interface StreamResult {
  isComplete: boolean;
  finishReason?: string;
  // 智能路由反馈：实际使用的 provider 和 model，用于失 败时标记降级
  usedProvider?: ProviderType;
  usedModel?: string;
}
```

- [ ] **Step 2: 在文件顶部添加 import**

在 `aiChat.ts` 顶部现有 import 中新增：

```typescript
import { selectProvider } from './smartRouter';
```

- [ ] **Step 3: 修改 sendStream 函数签名（必须在修改函数体之前）**

新增 `degradedModels` 参数：

```typescript
export async function sendStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean, isComplete?: boolean, finishReason?: string) => void,
  requestId: string,
  history: ChatMessage[] = [],
  options: ChatRequestOptions = {},
  degradedModels: Set<string> = new Set(),  // 新增
): Promise<StreamResult> {
```

- [ ] **Step 4: 修改 sendStream 函数体**

在 `sendStream` 函数体内，**在**现有两行之前插入路由选择（不是替换）：

找到约第 320 行原有代码：
```typescript
const provider = config.activeProvider;
const providerConfig = config.providerConfigs[provider];
```

**在它们之前**插入路由逻辑，并扩展原有两行引用变量：

```typescript
// 智能路由选择（若启用且有可用候选）
let routedProvider = config.activeProvider;
let routedModel: string | null = null;

if (config.smartRouting?.enabled && config.smartRouting.entries.length > 0) {
  const routeResult = await selectProvider(config, degradedModels);
  if (routeResult) {
    routedProvider = routeResult.provider;
    routedModel = routeResult.model;
  }
}

const provider = routedProvider;
const providerConfig = config.providerConfigs[routedProvider];
// 使用路由选中的模型，否则沿用 provider 默认模型
const model = routedModel ?? providerConfig.model;
```

将后续 invoke 调用中的 `model: providerConfig.model` 替换为 `model`。

- [ ] **Step 5: 在 sendStream 返回前填充 usedProvider/usedModel**

在 `streamWithEvent` 返回后填充：

```typescript
const result = await streamWithEvent(/* ... */);
if (routedModel) {
  result.usedProvider = routedProvider;
  result.usedModel = routedModel;
}
return result;
```

- [ ] **Step 6: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/aiChat.ts
git commit -m "feat: wire smartRouter into sendStream with StreamResult feedback"
```

---

### Task 5: 智能路由设置 UI

**Files:**
- Create: `src/components/SmartRoutingSettings.tsx`
- Modify: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: 创建 SmartRoutingSettings 组件**

```typescript
// 智能路由候选列表设置组件

import { useState } from 'react';
import { Plus, Trash2, GripVertical, AlertCircle, Zap } from 'lucide-react';
import type { SmartRouteEntry, SmartRoutingConfig, ProviderType } from '../store/config';
import { PROVIDERS, PROVIDER_MODELS } from '../store/config';

interface SmartRoutingSettingsProps {
  config: SmartRoutingConfig;
  configuredProviders: ProviderType[];  // 已配 API Key 的 Provider 列表
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
    // 检查重复
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
    // 交换优先级而不是交换位置（保持其他条目优先级不变）
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

  // 按优先级排序显示
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
            尚未添加候选模型，请点击"添加"选择
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
```

- [ ] **Step 2: 集成到 SettingsPanel**

在 `SettingsPanel.tsx` 中：

1. Import SmartRoutingSettings：
```typescript
import { SmartRoutingSettings } from './SmartRoutingSettings';
```

2. 在设置面板的功能开关区域之前（约第 842 行分隔线处）插入智能路由设置区域。使用 feature gate 控制显示：

```typescript
{/* 智能路由 */}
{config.featureGates?.smartRouting !== false && (
  <>
    <div className="border-t border-amber-200" />
    <SmartRoutingSettings
      config={config.smartRouting}
      configuredProviders={
        (Object.entries(config.providerConfigs) as [ProviderType, ProviderConfig][])
          .filter(([, cfg]) => cfg.apiKey?.trim())
          .map(([type]) => type)
      }
      onChange={(updates) =>
        setConfig((prev) => ({
          ...prev,
          smartRouting: { ...prev.smartRouting, ...updates },
        }))
      }
    />
  </>
)}
```

3. 在功能开关列表中添加 smartRouting 条目（约第 857 行）：

```typescript
{ key: 'smartRouting' as const, label: '智能路由', desc: '多模型之间根据网络自动切换' },
```

- [ ] **Step 3: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors from new components.

- [ ] **Step 4: Commit**

```bash
git add src/components/SmartRoutingSettings.tsx src/components/SettingsPanel.tsx
git commit -m "feat: add smart routing settings UI to settings panel"
```

---

### Task 6: 前端调用方（App.tsx）集成 degradedModels 状态

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 添加 degradedModels 状态和 sendStream 集成**

在 App.tsx 中，维护 `degradedModels` 状态：

```typescript
// session 级降级模型集合，key = `${provider}:${model}`
const [degradedModels, setDegradedModels] = useState<Set<string>>(new Set());
```

在调用 `sendStream` 时传入 `degradedModels` 作为最后一个参数。

- [ ] **Step 2: 流失败时标记降级模型**

流返回后，通过 `result.usedProvider` / `result.usedModel` 知道路由实际选中的模型。若使用了路由模型且流失败，将其加入降级列表：

```typescript
if (!result.isComplete && result.finishReason !== 'user_abort') {
  if (config.smartRouting?.enabled && result.usedProvider && result.usedModel) {
    const entryId = `${result.usedProvider}:${result.usedModel}`;
    setDegradedModels((prev) => new Set([...prev, entryId]));
  }
}
```

- [ ] **Step 3: 实现「换模型重试」按钮**

流失败时显示错误提示，附带「换模型重试」按钮。按钮点击时重新调用 `requestAssistantReply(originalQuestion)`，内部 `sendStream` 再次走 `selectProvider`，此时 `degradedModels` 已包含失败模型，自动跳过选择下一个候选。

```typescript
// 标记该条消息可通过智能路由换模型重试
const [canReroute, setCanReroute] = useState(false);
// 错误提示组件中：
// {canReroute && <button onClick={handleRetryWithReroute}>换模型重试</button>}
```

- [ ] **Step 4: 新 session 时清空降级状态**

```typescript
setDegradedModels(new Set());
```

- [ ] **Step 5: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate degradedModels session state with smart routing"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: Rust 编译验证**

Run: `cargo check`
Expected: No errors.

- [ ] **Step 2: TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: 功能验证清单**

1. 设置面板能正常打开，智能路由区域显示（feature gate 开启后）
2. 添加候选：选择 Provider + 模型后出现在列表中
3. 优先级排序：上下箭头能交换优先级
4. 删除候选：点击垃圾桶图标能移除
5. 延迟阈值滑块：拖动后数值变化
6. 总开关：切换 enabled 状态
7. 保存配置后重新打开设置面板，数据持久化不丢失
8. 关闭总开关时路由不工作（走原有 activeProvider 逻辑）
9. 开启后，pre-flight 探测执行正常
10. 全部候选挂了时兜底到 activeProvider

- [ ] **Step 4: Commit final adjustments**

```bash
git add -A
git commit -m "chore: final adjustments and verification for smart routing"
```
