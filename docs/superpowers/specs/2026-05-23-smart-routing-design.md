# Smart Routing 智能路由设计

## 目标

在多个 AI Provider/模型之间实现基于网络状态的无缝自动切换。
用户设定模型优先级，同优先级内系统自动选延迟最低的；当前模型不可达、报错或延迟过高时自动降级。

## 需求摘要

| 需求 | 决策 |
|---|---|
| 选择策略 | 用户手动排优先级，同优先级内自动选延迟最低 |
| 触发条件 | 网络不可达 + API 错误(5xx/429) + 响应延迟超阈值 |
| 阈值 | 用户可配置（默认 3000ms），不重试直接切换 |
| 恢复策略 | 会话级保持，下一条消息时重新尝试优先模型 |
| 功能开关 | Feature Gate 控制，默认关闭 |

---

## 数据模型

### 新增类型

```typescript
// 单个候选 Provider 条目
interface SmartRouteEntry {
  id: string;               // 唯一标识，如 "qwen-max"
  provider: ProviderType;   // 'qwen' | 'openai_compat' | 'claude'
  model: string;            // 具体模型 ID
  priority: number;         // 优先级 1=最高，数字越大优先级越低
}

// 智能路由配置
interface SmartRoutingConfig {
  enabled: boolean;
  latencyThreshold: number; // 延迟阈值 ms，默认 3000
  entries: SmartRouteEntry[];
}
```

### AppConfig 新增字段

```typescript
smartRouting: SmartRoutingConfig;
```

### 默认值

```typescript
smartRouting: {
  enabled: false,
  latencyThreshold: 3000,
  entries: [],
}
```

---

## 前端架构

### 新增/修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/services/smartRouter.ts` | **新增** | 路由决策核心模块 |
| `src/components/SmartRoutingSettings.tsx` | **新增** | 设置面板中的路由配置 UI |
| `src/store/config.ts` | 修改 | 新增 smartRouting 字段和类型 |
| `src/services/aiChat.ts` | 修改 | `sendStream` 入口接入路由 |
| `src/components/SettingsPanel.tsx` | 修改 | 新增路由设置 Tab/区域 |
| `src/components/FeatureGate.tsx` | 修改 | 按 smartRouting feature gate 控制入口 |

### smartRouter.ts 核心流程

```
用户发消息
    │
    ▼
SmartRouter.selectProvider(config, sessionDegradedModels)
    │
    ├─ enabled == false？ → 直接用 config.activeProvider
    ├─ entries 为空？     → 直接用 config.activeProvider
    ├─ 所有候选都不可用？  → 用 config.activeProvider 兜底
    │
    └─ 按 priority 分组 → 从最高优先级组开始
            │
            ├─ sessionDegradedModels 中的模型跳过（本 session 已失败过）
            ├─ 调用 invoke('batch_health_check', candidates)
            ├─ 过滤 reachable && latency < threshold 的
            ├─ 选延迟最低的
            │
            └─ 该组全挂 → 降级到下一个优先级组
```

### 两个关键行为

1. **Session 降级记忆**
   - `useChat` 中维护 `degradedModels: Set<string>`（本 session 内已失败的模型 ID）
   - 流返回失败（网络错误/超时/5xx）时，将当前模型加入 degradedModels
   - 流返回成功时，不清理该 Set（会话级保持）
   - 下一条消息重新从最高优先级开始尝试（自动跳过 degradedModels 中的模型）

2. **Pre-flight 批量探测**
   - 发消息前，对最高优先级组批量探测延迟
   - 并行调用后端 `batch_health_check`，单个候选超时 5 秒
   - 只探测需要决策的优先级组，不浪费请求
   - 如果探测全部超时，直接用 `config.activeProvider` 兜底

### 修改 aiChat.ts

在 `sendStream` 函数入口处（现有 `const provider = config.activeProvider` 之前）插入路由逻辑：

```typescript
// 智能路由：选择最优 Provider
let selectedProvider = config.activeProvider;
let selectedModel = providerConfig.model;

if (config.smartRouting.enabled && config.smartRouting.entries.length > 0) {
  const result = await selectProvider(config, degradedModels);
  if (result) {
    selectedProvider = result.provider;
    selectedModel = result.model;
  }
}
```

### API 重试配置（复用）

`retryStrategy.ts` 中新增路由专用配置：

```typescript
export const SMART_ROUTE_RETRY_CONFIG: RetryConfig = {
  maxRetries: 0,       // 不重试当前模型，直接切换
  baseDelay: 0,
  maxDelay: 0,
  backoffMultiplier: 1,
  jitter: false,
};
```

---

## 后端架构

### 新增 Rust Command

```rust
#[tauri::command]
pub async fn batch_health_check(
    candidates: Vec<HealthCheckCandidate>,
    timeout_ms: u64,
) -> Result<BatchHealthCheckResult, String>
```

### 输入输出类型

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthCheckCandidate {
    id: String,
    provider_type: String,
    base_url: Option<String>,
    api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchHealthCheckResult {
    results: Vec<CandidateHealthStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateHealthStatus {
    id: String,
    reachable: bool,
    latency_ms: Option<u64>,
    error_detail: Option<String>,
}
```

### 实现要点

- `tokio::join_all` 并行发起 HEAD 请求到各候选的 base URL
- 每个候选独立超时（由 `timeout_ms` 控制），不影响其他候选
- 完全复用现有 `check_network_health` 的 HTTP 判别逻辑（200-499 = 可达）
- 在 `lib.rs` 注册为 Tauri command

---

## 设置面板 UI

在设置面板中新增「智能路由」Tab/区域，包含：

1. **总开关**（Toggle）：启用/禁用智能路由
2. **延迟阈值滑块**（Range）：1-10 秒，默认 3 秒
3. **候选列表**（可排序列表）：
   - 每行：Provider 名称 + 模型名称 + 优先级标签
   - 支持拖拽排序调整优先级
   - 「添加候选」按钮：弹出选择框（已配 API Key 的 Provider + 其下模型）
   - 「删除」按钮
4. **一键添加**：自动扫描所有已配置 API Key 的 Provider，全部加入候选列表

### Feature Gate 入口

```typescript
// featureGates 新增
smartRouting: boolean;  // 默认 false（新功能灰度关闭）
```

关闭时：路由功能完全跳过，设置面板不显示智能路由入口。

---

## 错误处理

| 场景 | 处理 |
|---|---|
| 所有候选不可达 | 使用 config.activeProvider 兜底 |
| 兜底也失败 | 显示 FriendlyErrorCard，引导用户检查网络或设置 |
| batch_health_check 超时 | 5 秒后返回部分结果，超时的标记为 unreachable |
| 候选 Provider API Key 未配置 | 跳过该候选 |
| 路由结果选择了一个模型但流返回失败 | 该模型加入 degradedModels，显示错误并提供"重试（自动选下一候选）"按钮 |

---

## 测试要点

1. 开关关闭时不触发路由逻辑
2. 候选列表为空时直接使用 activeProvider
3. 同优先级选延迟最低
4. 高优先级挂了降级到低优先级
5. session 降级模型不会被选中
6. 全部候选挂了兜底到 activeProvider
7. batch_health_check 并行性验证
8. 延迟阈值过滤逻辑
