# 智能路由降级通知 — 设计方案

> 版本: 1.0
> 日期: 2026-06-09
> 原则: 最小化修改、就地复用、非侵入式

---

## 1. 问题背景

当前智能路由 (smartRouter.ts) 在发送每条消息前执行 pre-flight 批量健康检查,
按优先级选择延迟最低且未降级的模型。当选中的模型不是用户设置的主 Provider
(activeProvider) 时,用户完全无感知——不知道:

- 实际使用了哪个模型(什么 Provider / 什么模型名)
- 哪些模型被跳过了、为什么被跳过(超时?不可达?延迟过高?)
- 当前会话已经降级了多少个模型
- 是否需要去设置页调整路由列表

**目标**: 在发生降级时,给用户一个轻量、不阻塞、可回顾的通知,
让用户知晓路由决策,但不打断聊天流程。

---

## 2. 核心设计思路

| 原则 | 说明 |
|------|------|
| 就地复用 | 利用现有的 useNetworkResilience Zustand store、NetworkStatusIndicator 组件、StreamResult 返回结构 |
| 最小修改 | 不新建 Rust 命令,不新建前端 service 文件,只修改 4 个现有文件 |
| 非侵入 | 通知以 toast 形式在聊天界面右下角短暂弹出,3 秒后自动消失,不抢占焦点 |
| 可追溯 | 降级事件写入 Zustand store,可通过悬停网络指示灯查看历史 |

---

## 3. 数据模型

### 3.1 降级事件 DegradationEvent

```typescript
// 定义在 src/store/networkResilience.ts 中新增

export interface DegradationEvent {
  /** 事件唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 原本期望的 provider（最高优先级未降级者） */
  intendedProvider: string;
  /** 原本期望的 model */
  intendedModel: string;
  /** 实际使用的 provider */
  actualProvider: string;
  /** 实际使用的 model */
  actualModel: string;
  /** 降级原因 */
  reason: DegradationReason;
  /** 被跳过的候选列表（按优先级排序） */
  skippedCandidates: SkippedCandidate[];
}

export type DegradationReason =
  | 'unreachable'    // 网络不可达
  | 'high_latency'   // 延迟超过阈值
  | 'health_failed'  // 健康检查本身失败
  | 'all_degraded';  // 所有候选都不可用，回退到 activeProvider

export interface SkippedCandidate {
  provider: string;
  model: string;
  reason: DegradationReason;
  latencyMs?: number | null;
}
```

### 3.2 Store 扩展

在 useNetworkResilience 中新增字段:

```typescript
interface NetworkResilienceState {
  // ... 现有字段保持不变 ...

  // ========== 降级通知 ==========
  /** 降级历史（当前会话，最多保留 20 条） */
  degradationEvents: DegradationEvent[];
  addDegradationEvent: (event: DegradationEvent) => void;
  clearDegradationHistory: () => void;

  /** 最新一条未读降级事件（用于 toast 触发） */
  lastUnreadDegradation: DegradationEvent | null;
  markDegradationRead: () => void;
}
```

---

## 4. 需要修改的文件（共 4 个）

### 4.1 src/services/smartRouter.ts — 丰富返回值

**当前**: selectProvider() 只返回 RouteSelection | null。

**修改**: 返回新增 degradationDetail，包含跳过的候选信息。

```diff
  export interface RouteSelection {
    provider: ProviderType;
    model: string;
    entryId: string;
+   // 降级详情：哪些候选被跳过以及原因
+   skippedCandidates?: {
+     id: string;
+     provider: ProviderType;
+     model: string;
+     reason: 'unreachable' | 'high_latency' | 'health_failed';
+     latencyMs?: number | null;
+   }[];
  }
```

在 selectProvider() 内部，遍历各优先级组时收集不可用候选。
改动量约 20 行,在已有循环中追加收集逻辑。

### 4.2 src/services/aiChat.ts — 感知降级并写入 Store

**当前**: sendStream() 调 selectProvider(),返回的 StreamResult 里有 usedProvider/usedModel。

**修改**: 在 sendStream() 中,当实际路由结果不等于期望的首选时,构造 DegradationEvent 写入 store。

核心逻辑（伪代码）:

```
路由结果中的 actualProvider/actualModel
  != 最高优先级首选
     (即 smartRouting.entries 中 priority 最小
      且未被 session 降级的条目)
  => 触发降级通知
  => 构造 DegradationEvent {
       intendedProvider: 首选 provider,
       intendedModel:   首选 model,
       actualProvider:  路由实际选中的 provider,
       actualModel:     路由实际选中的 model,
       reason:          'unreachable' | 'high_latency',
       skippedCandidates: [...被跳过的候选],
     }
  => useNetworkResilience.getState().addDegradationEvent(event)
```

额外: 如果所有候选都不可用导致 selectProvider 返回 null，
兜底使用 activeProvider 也算降级,原因记为 all_degraded。

改动量约 30 行,在 sendStream() 函数中追加。

### 4.3 src/store/networkResilience.ts — 新增降级事件存储

**修改**: 在 NetworkResilienceState 接口和 create() 中新增:

```typescript
// ========== store 实现 ==========

degradationEvents: [],

addDegradationEvent: (event) => set((state) => ({
  degradationEvents: [
    event,
    ...state.degradationEvents,
  ].slice(0, 20),               // 最多保留 20 条
  lastUnreadDegradation: event, // 触发 toast
})),

clearDegradationHistory: () => set({
  degradationEvents: [],
  lastUnreadDegradation: null,
}),

lastUnreadDegradation: null,

markDegradationRead: () => set({ lastUnreadDegradation: null }),
```

改动量约 25 行，追加到已有 store 定义中。

### 4.4 src/components/NetworkStatusIndicator.tsx — UI 通知

**当前**: 只显示圆点 + tooltip。

**修改**: 新增降级 toast 弹出 + tooltip 增强。

#### 4.4.1 Toast 弹出

当检测到 lastUnreadDegradation 非空时，在右下角弹出半透明 toast:

```
+------------------------------------------+
|  ! 智能路由降级                            |
|                                           |
|  首选 qwen-plus 不可用                      |
|  已切换至 Claude Sonnet 4                   |
|                                           |
|  跳过: qwen-plus(超时) qwen-max(不可达)      |
|                                           |
|  [知道了]  [调整路由]                        |
+------------------------------------------+
```

- 3 秒后自动消失（或点击「知道了」）
- 「调整路由」按钮触发跳转到设置页（通过操作 activeTab store 或 emit custom event）
- 仅在降级发生时弹出，正常路由不弹

#### 4.4.2 指示灯 tooltip 增强

在现有 tooltip 底部增加降级历史折叠区:

```
网络正常
延迟: 234ms
上次检测: 14:32:05
────────────────────────
v 本次会话路由降级 (2次)
  14:30  qwen-plus --> Claude Sonnet
  14:28  qwen-max 不可达
────────────────────────
点击刷新
```

改动量约 60 行，在现有组件中追加。

---

## 5. 数据流

```
用户发消息
  |
  v
sendStream()  [aiChat.ts]
  |
  +-- selectProvider()  [smartRouter.ts]
  |   +-- 探测 P1 级候选 -> 全不可达 -> 记录 skippedCandidates
  |   +-- 探测 P2 级候选 -> 选中最优
  |   +-- 返回 RouteSelection + skippedCandidates
  |
  +-- 比对: 实际选中 != 最高优先级首选 -> 触发降级通知
  |   +-- 构造 DegradationEvent
  |   +-- useNetworkResilience.getState().addDegradationEvent()
  |
  +-- 发送请求 -> 流式返回 -> StreamResult.usedProvider/usedModel
  |
  +-- 完成

NetworkStatusIndicator  [React]
  |
  +-- 订阅 useNetworkResilience.lastUnreadDegradation
  |   +-- 非空 -> 渲染 toast（3s 自动消除）
  |
  +-- 订阅 degradationEvents[]
      +-- tooltip 中渲染降级历史
```

---

## 6. 不复用的模块

以下现有模块不需要修改,保证改动面最小:

| 模块 | 原因 |
|------|------|
| Rust commands.rs / batch_health_check | 批量健康检查的返回值已足够,不需要新字段 |
| errorClassifier.ts | 降级不等于错误,是正常的路由行为,不应走错误分类 |
| FriendlyErrorCard.tsx | 同上,降级通知不需要错误卡片样式 |
| retryStrategy.ts | 降级发生在路由层,重试逻辑不变 |
| config.ts / types/provider.ts | 不新增配置项,不新增类型导出 |
| SettingsPanel.tsx / SmartRoutingSettings.tsx | 本次不改设置 UI,后续迭代可加降级通知开关 |

---

## 7. 边界情况处理

| 场景 | 行为 |
|------|------|
| 智能路由未启用 | 不生成任何降级事件 |
| 候选列表为空 | 不生成降级事件 |
| 所有候选都不可用 | 记录 reason: all_degraded,提示已回退到默认 Provider |
| 首选刚好就是实际选中 | 不弹 toast(正常路由,无需通知) |
| 同一条消息连续触发多次(重试场景) | 去重: 同一 (intendedProvider, intendedModel, actualProvider, actualModel) 组合 5 秒内不重复弹 |
| 会话切换/清空 | degradationEvents 只存当前会话,页面刷新即清空(store 初始化为空数组) |
| 降级历史超过 20 条 | 自动裁剪最旧的条目,保留最新 20 条 |

---

## 8. 国际化(暂不实施)

本次不做 i18n,所有文案硬编码在组件中。后续若引入 i18n,
降级通知的文案只需替换 toast 和 tooltip 中的字符串常量。

---

## 9. 后续迭代方向

1. 设置开关: 在 SmartRoutingSettings 中增加降级时通知的 checkbox
2. 音频提示: 语音播报已切换至备用模型
3. 降级统计: 在 review/TrendComparison 中增加路由降级次数的趋势图
4. 自动恢复: 健康检查发现首选恢复后,自动切回并通知用户