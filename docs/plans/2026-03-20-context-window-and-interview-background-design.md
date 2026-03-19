# 多轮对话上下文窗口与面试背景注入 — 架构设计文档

> **版本**: v1.0  
> **日期**: 2026-03-20  
> **范围**: TODO #23 ~ #26  

---

## 一、需求概览

| # | 需求 | 优先级 | 复杂度 | 预估工时 |
|---|------|--------|--------|----------|
| 23 | 多轮对话上下文窗口（最近 N 轮问答作为历史传递给 AI） | P0 | 低 | 2h |
| 24 | 上下文窗口大小可配置（默认 5 轮，设置中可调） | P0 | 低 | 2h |
| 25 | "面试背景"快捷设置入口（公司名、岗位、JD 要点 → 自动注入系统 Prompt） | P1 | 中 | 3h |
| 26 | 上下文超长时自动生成前文摘要压缩传递 | P2 | 高 | 6-8h |

**依赖关系**: #23 → #24 → #26（串行），#25 独立可并行。

---

## 二、现状分析

### 2.1 已具备的能力

| 能力 | 代码位置 | 说明 |
|------|----------|------|
| `sendStream()` 已接受 `history` 参数 | `src/services/aiChat.ts` L114 | `history: ChatMessage[] = []`，默认空数组 |
| 后端 `messages: Vec<ChatMessage>` 支持任意长度 | `src-tauri/src/commands.rs` L44-71 | 透传给各 Provider |
| 数据库可检索完整会话消息 | `src-tauri/src/database.rs` L106-130 | `ORDER BY created_at ASC` |
| 前端已将历史消息加载到 `messages` state | `src/App.tsx` L513-519 | 切换会话时全量加载 |
| 系统 Prompt 模板化 + 自定义 | `src/store/config.ts` L138-196 | 4 个预设模板 + custom |

### 2.2 缺失的能力

- App.tsx 调用 `sendStream` 时 **未传递 history**（L239）
- 无 token 计数 / 长度检查逻辑
- 无上下文摘要生成机制
- 无"面试背景"结构化数据模型

---

## 三、功能 #23：多轮对话上下文窗口

### 3.1 设计思路

核心改动极其简单：App.tsx 在调用 `sendStream` 时，从当前 `messages` state 中提取最近 N 轮对话，作为 `history` 参数传递。

### 3.2 消息流变更

```
变更前:
  messages = [system_prompt, user_question]

变更后:
  messages = [system_prompt, ...recent_N_rounds, user_question]
```

其中 "1 轮" = 1 条 user + 1 条 assistant（共 2 条消息）。

### 3.3 核心实现

#### 3.3.1 新增工具函数 `buildContextHistory()`

**文件**: `src/services/aiChat.ts`

```typescript
/**
 * 从消息列表中提取最近 N 轮对话作为上下文
 * @param messages  当前会话的全部消息（按时间升序）
 * @param windowSize  上下文窗口大小（轮数），1轮 = 1条user + 1条assistant
 * @returns 用于传递给 AI 的 ChatMessage 数组
 */
export function buildContextHistory(
  messages: Array<{ role: string; content: string }>,
  windowSize: number,
): ChatMessage[] {
  if (windowSize <= 0 || messages.length === 0) return [];

  // 排除当前正在输入的最后一条 user 消息（它会作为 question 单独传）
  // 取最近 windowSize 轮 = windowSize * 2 条消息
  const maxMessages = windowSize * 2;
  const history = messages.slice(-maxMessages);

  return history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}
```

#### 3.3.2 修改 App.tsx 调用处

**文件**: `src/App.tsx`（`requestAssistantReply` 函数附近 L239）

```typescript
// 变更前:
await sendStream(requestText, config, onChunk);

// 变更后:
const contextHistory = buildContextHistory(
  messages.filter(m => m.role !== 'system'),  // 排除 system 消息
  config.contextWindowSize ?? 5,
);
await sendStream(requestText, config, onChunk, contextHistory);
```

### 3.4 边界处理

| 场景 | 处理策略 |
|------|----------|
| 新会话、无历史消息 | `history` 为空数组，行为与当前一致 |
| 消息数 < N 轮 | 传递所有可用消息，不补零 |
| 包含图片消息 | 图片消息的 `content` 仅传递文本部分（图片 base64 不传入历史，防止 token 爆炸） |
| 正在流式输出时 | 不将未完成的 assistant 消息纳入历史 |

---

## 四、功能 #24：上下文窗口大小可配置

### 4.1 配置层改动

#### 4.1.1 扩展 AppConfig

**文件**: `src/store/config.ts`

```typescript
export interface AppConfig {
  // ... 现有字段 ...

  /** 上下文窗口大小（轮数），默认 5 */
  contextWindowSize: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  // ... 现有默认值 ...
  contextWindowSize: 5,
};
```

#### 4.1.2 扩展 loadConfig / saveConfig

```typescript
// loadConfig() 中新增:
const contextWindowSize = await store.get<number>('contextWindowSize');
if (contextWindowSize !== null && contextWindowSize !== undefined) {
  config.contextWindowSize = contextWindowSize;
}

// saveConfig() 中新增:
await store.set('contextWindowSize', config.contextWindowSize);
```

### 4.2 设置面板 UI

**文件**: `src/components/SettingsPanel.tsx`

在 "Prompt 设置" 区域下方新增"对话上下文"配置区：

```
┌─────────────────────────────────────────┐
│ 对话上下文                               │
│                                         │
│ 上下文轮数:  [-] [  5  ] [+]           │
│ (每次发送消息时携带最近 5 轮对话历史)     │
│                                         │
│ 范围: 1 ~ 20 轮                         │
└─────────────────────────────────────────┘
```

**交互设计**:
- 数字输入框 + 增减按钮
- 最小值 1，最大值 20
- 实时显示描述文字："每次发送消息时携带最近 {N} 轮对话历史"
- 值为 0 时特殊含义：不传递历史（兼容单轮模式）

### 4.3 配置值校验

```typescript
function validateContextWindowSize(value: number): number {
  return Math.max(0, Math.min(20, Math.floor(value)));
}
```

---

## 五、功能 #25："面试背景"快捷设置入口

### 5.1 设计方案

面试背景本质是**结构化数据 → 系统 Prompt 片段**的映射。用户填写公司名、岗位、JD 要点后，系统自动将其格式化并追加到系统 Prompt 末尾。

### 5.2 数据模型

#### 5.2.1 新增 InterviewBackground 接口

**文件**: `src/store/config.ts`

```typescript
export interface InterviewBackground {
  /** 是否启用面试背景注入 */
  enabled: boolean;
  /** 公司名称 */
  company: string;
  /** 目标岗位 */
  position: string;
  /** JD 关键要点（支持多行文本） */
  jdHighlights: string;
}

export interface AppConfig {
  // ... 现有字段 ...
  contextWindowSize: number;
  interviewBackground: InterviewBackground;
}

export const DEFAULT_CONFIG: AppConfig = {
  // ... 现有默认值 ...
  contextWindowSize: 5,
  interviewBackground: {
    enabled: false,
    company: '',
    position: '',
    jdHighlights: '',
  },
};
```

### 5.3 Prompt 注入机制

#### 5.3.1 修改 getSystemPrompt()

**文件**: `src/services/aiChat.ts`

```typescript
function getSystemPrompt(config: AppConfig): string {
  // 1. 获取基础 Prompt（现有逻辑不变）
  let basePrompt: string;
  if (config.promptTemplateId === 'custom') {
    basePrompt = config.customPrompt?.trim() || PROMPT_TEMPLATES[0].prompt;
  } else {
    const template = PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId);
    basePrompt = template?.prompt || PROMPT_TEMPLATES[0].prompt;
  }

  // 2. 注入面试背景（新增）
  const bg = config.interviewBackground;
  if (bg?.enabled && (bg.company || bg.position || bg.jdHighlights)) {
    const bgSection = buildInterviewBackgroundPrompt(bg);
    return `${basePrompt}\n\n${bgSection}`;
  }

  return basePrompt;
}

function buildInterviewBackgroundPrompt(bg: InterviewBackground): string {
  const parts: string[] = ['---', '## 当前面试背景'];

  if (bg.company) {
    parts.push(`- **目标公司**: ${bg.company}`);
  }
  if (bg.position) {
    parts.push(`- **应聘岗位**: ${bg.position}`);
  }
  if (bg.jdHighlights) {
    parts.push(`- **JD 要点**:\n${bg.jdHighlights}`);
  }

  parts.push('');
  parts.push('请根据以上面试背景，调整你的回答风格和侧重点，使回答更加贴合该公司和岗位的要求。');

  return parts.join('\n');
}
```

#### 5.3.2 Prompt 注入效果示例

```
[原始系统 Prompt]
你是一位技术能力扎实且软技能出色的优秀应聘者...

---
## 当前面试背景
- **目标公司**: 字节跳动
- **应聘岗位**: 高级前端工程师
- **JD 要点**:
  - 精通 React/Vue，有大型项目经验
  - 熟悉性能优化与监控体系
  - 有跨端开发经验优先

请根据以上面试背景，调整你的回答风格和侧重点，使回答更加贴合该公司和岗位的要求。
```

### 5.4 UI 设计

有两个入口方案，**推荐方案 A**：

#### 方案 A：设置面板中独立区域（推荐）

在 SettingsPanel 的 "Prompt 设置" 和 "语音识别" 之间新增一个折叠区域：

```
┌─────────────────────────────────────────┐
│ 面试背景  [开关: ●]                      │
│                                         │
│ 公司名称:  [字节跳动              ]      │
│ 目标岗位:  [高级前端工程师         ]      │
│ JD 要点:                                │
│ ┌─────────────────────────────────────┐ │
│ │ - 精通 React/Vue                    │ │
│ │ - 有大型项目经验                     │ │
│ │ - 熟悉性能优化                      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 💡 开启后，以上信息将自动注入系统Prompt  │
└─────────────────────────────────────────┘
```

#### 方案 B：主界面快捷入口（可选增强）

在 CompactView 顶部或 App 主界面添加一个小按钮，点击弹出轻量弹窗快速编辑面试背景，适合面试进行中临时切换场景。

### 5.5 持久化

面试背景作为 `AppConfig.interviewBackground` 的一部分，随配置一起存储到 Tauri Store / localStorage，无需额外存储逻辑。

---

## 六、功能 #26：上下文超长时自动摘要压缩

### 6.1 整体策略

当上下文窗口内的消息总长度超过阈值时，将较早的消息自动摘要为一段精简文本，作为 `system` 消息的补充传入，从而在保持上下文连贯性的同时控制 token 消耗。

### 6.2 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                   上下文构建流程                           │
│                                                          │
│  messages (全部历史)                                      │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────┐                                     │
│  │ 1.按窗口截取     │ → 最近 N 轮消息                     │
│  └────────┬────────┘                                     │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────┐       ┌──────────────────┐          │
│  │ 2.估算 token 数  │──超限→│ 3.分割为 前半/后半 │          │
│  └────────┬────────┘       └────────┬─────────┘          │
│           │未超限                    │                    │
│           │                         ▼                    │
│           │               ┌─────────────────┐            │
│           │               │ 4.前半 → AI摘要  │            │
│           │               └────────┬────────┘            │
│           │                        │                     │
│           ▼                        ▼                     │
│  ┌─────────────────────────────────────────────┐         │
│  │ 5.最终 messages:                             │         │
│  │   [system_prompt]                            │         │
│  │   [summary_of_early_context]  ← 仅超限时存在  │         │
│  │   [...recent_messages]                       │         │
│  │   [user_question]                            │         │
│  └─────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### 6.3 Token 估算

由于精确 token 计算需要 tokenizer 库（如 tiktoken），且不同模型 tokenizer 不同，这里采用**字符数近似估算**：

```typescript
/**
 * 估算消息的 token 数量
 * 中文约 1 token / 字符，英文约 0.25 token / 字符
 * 采用保守估算：1 token ≈ 2 字符
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
  // +4 是每条消息的 role/格式开销
}
```

### 6.4 配置扩展

```typescript
export interface AppConfig {
  // ... 现有字段 ...
  contextWindowSize: number;
  interviewBackground: InterviewBackground;

  /** 上下文 token 上限，超过此值触发摘要压缩。默认 4000 */
  contextMaxTokens: number;
  /** 是否启用自动摘要压缩。默认 true */
  enableContextSummary: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  // ...
  contextMaxTokens: 4000,
  enableContextSummary: true,
};
```

### 6.5 摘要生成

#### 6.5.1 摘要函数

**文件**: `src/services/aiChat.ts`

```typescript
const SUMMARY_PROMPT = `请将以下对话内容压缩为一段简洁的摘要，保留关键信息点：
- 讨论的核心问题
- 达成的结论或给出的建议
- 重要的技术细节或关键词

要求：摘要控制在 200 字以内，使用第三人称描述。`;

/**
 * 调用 AI 生成对话摘要
 */
async function summarizeContext(
  messages: ChatMessage[],
  config: AppConfig,
): Promise<string> {
  const conversationText = messages
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n\n');

  const summaryMessages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: conversationText },
  ];

  // 使用非流式调用获取摘要（复用现有 Provider 基础设施）
  const summary = await invoke<string>('ai_chat', {
    provider: config.activeProvider,
    config: {
      apiKey: config.providerConfigs[config.activeProvider].apiKey,
      baseUrl: config.providerConfigs[config.activeProvider].baseUrl || null,
    },
    model: config.providerConfigs[config.activeProvider].model,
    messages: summaryMessages,
  });

  return summary;
}
```

> **注意**: 后端需新增非流式 `ai_chat` 命令（当前仅有 `ai_chat_stream`），或复用现有 trait 中的 `chat()` 方法。

#### 6.5.2 后端新增非流式命令

**文件**: `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub async fn ai_chat(
    registry: State<'_, ProviderRegistry>,
    provider: ProviderType,
    config: ProviderConfig,
    model: String,
    messages: Vec<crate::ai::types::ChatMessage>,
) -> Result<String, String> {
    registry
        .chat(&provider, &config, &model, messages)
        .await
        .map_err(|e| e.to_string())
}
```

### 6.6 智能上下文构建（整合 #23 + #26）

**文件**: `src/services/aiChat.ts`

```typescript
/**
 * 智能构建上下文消息列表
 * 整合窗口截取 + 超长摘要压缩
 */
export async function buildSmartContext(
  allMessages: Array<{ role: string; content: string }>,
  config: AppConfig,
): Promise<ChatMessage[]> {
  const windowSize = config.contextWindowSize ?? 5;
  const maxTokens = config.contextMaxTokens ?? 4000;
  const enableSummary = config.enableContextSummary ?? true;

  // 1. 按窗口大小截取
  const history = buildContextHistory(allMessages, windowSize);

  if (history.length === 0) return [];

  // 2. 估算 token
  const totalTokens = estimateMessagesTokens(history);

  // 3. 未超限 → 直接返回
  if (!enableSummary || totalTokens <= maxTokens) {
    return history;
  }

  // 4. 超限 → 分割并摘要
  //    策略：保留最近 2 轮（4条消息）完整，其余摘要
  const preserveCount = Math.min(4, history.length);
  const toSummarize = history.slice(0, history.length - preserveCount);
  const toPreserve = history.slice(history.length - preserveCount);

  try {
    const summary = await summarizeContext(toSummarize, config);

    return [
      {
        role: 'system' as const,
        content: `[前文摘要] ${summary}`,
      },
      ...toPreserve,
    ];
  } catch (error) {
    console.warn('摘要生成失败，降级为截断策略:', error);
    // 降级：直接截取后半部分
    return toPreserve;
  }
}
```

### 6.7 摘要缓存机制

为避免重复调用 AI 生成相同内容的摘要，引入简单的内存缓存：

```typescript
/** 摘要缓存：key = 被摘要消息的内容 hash，value = 摘要文本 */
const summaryCache = new Map<string, string>();

function getCacheKey(messages: ChatMessage[]): string {
  const raw = messages.map(m => `${m.role}:${m.content}`).join('|');
  // 简单 hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

async function summarizeWithCache(
  messages: ChatMessage[],
  config: AppConfig,
): Promise<string> {
  const key = getCacheKey(messages);

  if (summaryCache.has(key)) {
    return summaryCache.get(key)!;
  }

  const summary = await summarizeContext(messages, config);
  summaryCache.set(key, summary);

  // 限制缓存大小
  if (summaryCache.size > 50) {
    const firstKey = summaryCache.keys().next().value;
    if (firstKey) summaryCache.delete(firstKey);
  }

  return summary;
}
```

---

## 七、最终消息构建流程（全功能整合）

整合 #23~#26 后，`sendStream` 的消息构建完整流程如下：

```
┌─────────────────────────────────────────────────────┐
│                  消息构建流程                         │
│                                                     │
│  1. 获取基础 System Prompt                           │
│     ├─ 模板 / 自定义 Prompt                          │
│     └─ 面试背景注入 (#25)                            │
│                                                     │
│  2. 构建上下文历史                                    │
│     ├─ 按窗口大小截取 (#23, #24)                     │
│     └─ 超长时自动摘要 (#26)                          │
│                                                     │
│  3. 组装最终 messages                                │
│     [                                               │
│       { role: "system",    content: prompt+背景 },   │
│       { role: "system",    content: "[前文摘要]..." },│ ← 仅超限时
│       { role: "user",      content: "早期问题" },     │ ← 保留的近期历史
│       { role: "assistant", content: "早期回答" },     │
│       { role: "user",      content: "当前问题" },     │ ← 本次提问
│     ]                                               │
│                                                     │
│  4. 发送给后端 → Provider → AI 服务                   │
└─────────────────────────────────────────────────────┘
```

---

## 八、改动文件清单

| 文件 | 改动类型 | 涉及功能 |
|------|----------|----------|
| `src/store/config.ts` | 修改 | #24 #25 #26：新增 `contextWindowSize`、`interviewBackground`、`contextMaxTokens`、`enableContextSummary` |
| `src/services/aiChat.ts` | 修改 | #23 #25 #26：新增 `buildContextHistory()`、`buildSmartContext()`、`summarizeContext()`，修改 `getSystemPrompt()` |
| `src/App.tsx` | 修改 | #23：调用 `sendStream` 时传递 history |
| `src/components/SettingsPanel.tsx` | 修改 | #24 #25：新增"对话上下文"和"面试背景"设置区域 |
| `src-tauri/src/commands.rs` | 修改 | #26：新增非流式 `ai_chat` 命令 |

---

## 九、实施路线图

```
Phase 1 (Day 1) ─ 基础上下文能力
  ├─ Task 1: 实现 buildContextHistory() + 修改 App.tsx 传递 history    (#23)
  └─ Task 2: 新增 contextWindowSize 配置 + 设置面板 UI                 (#24)

Phase 2 (Day 1-2) ─ 面试背景
  └─ Task 3: InterviewBackground 数据模型 + Prompt 注入 + 设置 UI      (#25)

Phase 3 (Day 2-3) ─ 智能摘要
  ├─ Task 4: 后端新增 ai_chat 非流式命令                               (#26 前置)
  ├─ Task 5: Token 估算 + summarizeContext() + 缓存                   (#26)
  └─ Task 6: buildSmartContext() 整合 + 降级策略                       (#26)

Phase 4 (Day 3) ─ 验证
  ├─ 单轮/多轮/超长上下文场景测试
  ├─ 面试背景注入效果验证
  └─ 摘要生成质量评估
```

---

## 十、风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| Token 估算不准确导致超限 | API 报错 / 截断 | 采用保守估算系数；捕获 API 错误后自动缩减窗口重试 |
| 摘要生成耗时影响用户体验 | 发送消息延迟明显增加 | 异步预生成；显示"正在压缩上下文..."提示；设置超时降级 |
| 摘要丢失关键信息 | AI 回答质量下降 | 摘要 Prompt 强调保留关键信息；保留最近 2 轮完整消息作为兜底 |
| 图片消息 base64 导致 token 爆炸 | 单条消息占满上下文 | 历史中的图片消息仅传递文本描述，不传 base64 |
| 面试背景注入导致 Prompt 过长 | 挤压正文空间 | 限制 JD 要点字数上限（建议 500 字） |
