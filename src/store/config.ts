// 配置管理 - 使用 Tauri Store 插件持久化（带 localStorage 备用）
import { Store } from '@tauri-apps/plugin-store';
import { createLogger } from '../services/logger';

const log = createLogger('Config');

// ==================== 填充词过滤配置 ====================

export interface FillerWordFilterConfig {
  /** 总开关（默认 true，仅在 tech 模式下生效） */
  enabled: boolean;
  /** 用户自定义填充词 */
  customWords?: string[];
  /** 支持的模板白名单（如 ['tech', 'tech-cn']），为空则按默认策略（仅 tech 模式） */
  enabledTemplates?: string[];
  /** 语言标识，用于选择默认规则集 */
  locale?: string;
}

// ==================== Provider 配置类型（新增）====================

export type ProviderType = 'qwen' | 'openai_compat' | 'claude';

// cheat 模式：AI 用超简要点格式输出，适合实时面试快速扫读
export type PromptMode = 'assistant' | 'interviewer' | 'cheat';

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

export type RagRetrievalScope = 'hybrid' | 'knowledge_base' | 'current_session';

export type RagEmbeddingProviderType = 'qwen' | 'openai_compat';

export type RagAutoReindexPolicy = 'manual' | 'changed_files' | 'on_startup';

export interface RagConfig {
  enabled: boolean;
  retrievalScope: RagRetrievalScope;
  enableOcr: boolean;
  enablePersonalMemoryForInterviewer: boolean;
  embeddingProvider: RagEmbeddingProviderType;
  embeddingModel: string;
  autoReindexPolicy: RagAutoReindexPolicy;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;             // 自定义 Base URL
  model: string;                // 当前选中的模型
  customModels?: string[];      // 用户自定义模型 ID 列表
}

// Provider 元信息（用于前端展示）
export interface ProviderMeta {
  id: ProviderType;
  name: string;
  description: string;
  defaultBaseUrl: string;
  supportsCustomUrl: boolean;
}

// Provider 列表
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'qwen',
    name: '阿里云千问 (DashScope)',
    description: '阿里云大模型平台，支持 qwen 系列模型',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    supportsCustomUrl: true,
  },
  {
    id: 'openai_compat',
    name: 'OpenAI 兼容接口',
    description: '支持 OpenAI、DeepSeek、Ollama 等兼容接口',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsCustomUrl: true,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    description: 'Anthropic Claude API',
    defaultBaseUrl: 'https://api.anthropic.com',
    supportsCustomUrl: true,
  },
];

// Provider 默认模型
export const PROVIDER_MODELS: Record<ProviderType, { id: string; name: string; description: string }[]> = {
  qwen: [
    { id: 'qwen3.7-max', name: 'Qwen 3.7 Max', description: '当前最强性能，适合复杂推理和代码问题' },
    { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', description: '平衡性能与质量，适合大多数场景' },
    { id: 'qwen3.6-flash', name: 'Qwen 3.6 Flash', description: '快速响应，成本低，适合简单问题' },
    { id: 'qwen3-coder-plus', name: 'Qwen 3 Coder Plus', description: '专门针对编程优化' },
    { id: 'qwen3-vl-max', name: 'Qwen 3 VL Max', description: '视觉理解模型，支持截图识别' },
  ],
  openai_compat: [
    { id: 'gpt-5.5', name: 'GPT-5.5', description: 'OpenAI 当前旗舰对话模型' },
    { id: 'gpt-5.4', name: 'GPT-5.4', description: 'OpenAI 高性能多模态模型' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: '轻量级，性价比高' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'DeepSeek 旗舰推理模型' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'DeepSeek 高速低成本模型' },
  ],
  claude: [
    { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', description: '最强推理能力' },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: '平衡性能与质量' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', description: '快速响应' },
  ],
};

export const RAG_RETRIEVAL_SCOPE_OPTIONS: { id: RagRetrievalScope; name: string; description: string }[] = [
  {
    id: 'hybrid',
    name: '混合检索',
    description: '同时检索当前会话语义与知识库文档，适合通用问答。',
  },
  {
    id: 'knowledge_base',
    name: '仅知识库',
    description: '只引用已导入并完成索引的知识库文档。',
  },
  {
    id: 'current_session',
    name: '仅当前会话',
    description: '只使用当前聊天会话中已向量化的消息内容。',
  },
];

export const RAG_EMBEDDING_PROVIDERS: { id: RagEmbeddingProviderType; name: string; description: string }[] = [
  {
    id: 'qwen',
    name: 'Qwen Embedding',
    description: '使用千问兼容 embedding 接口，默认模型为 text-embedding-v2。',
  },
  {
    id: 'openai_compat',
    name: 'OpenAI Compatible Embedding',
    description: '使用 OpenAI 兼容 embedding 接口，默认模型为 text-embedding-3-small。',
  },
];

export const RAG_EMBEDDING_MODELS: Record<RagEmbeddingProviderType, { id: string; name: string; description: string }[]> = {
  qwen: [
    { id: 'text-embedding-v2', name: 'text-embedding-v2', description: '千问默认 embedding 模型。' },
  ],
  openai_compat: [
    { id: 'text-embedding-3-small', name: 'text-embedding-3-small', description: 'OpenAI 默认轻量 embedding 模型。' },
    { id: 'text-embedding-3-large', name: 'text-embedding-3-large', description: '更高质量的 OpenAI 兼容 embedding 模型。' },
  ],
};

export const RAG_AUTO_REINDEX_POLICY_OPTIONS: { id: RagAutoReindexPolicy; name: string; description: string }[] = [
  {
    id: 'manual',
    name: '仅手动',
    description: '只在用户显式触发时重建索引。',
  },
  {
    id: 'changed_files',
    name: '仅变更文件',
    description: '后续发现文件 fingerprint 变化时自动重建对应索引。',
  },
  {
    id: 'on_startup',
    name: '启动时扫描',
    description: '应用启动后恢复上次中断的 indexing 文档，避免状态长期卡死。',
  },
];

export function getDefaultRagEmbeddingModel(provider: RagEmbeddingProviderType): string {
  return RAG_EMBEDDING_MODELS[provider][0]?.id || 'text-embedding-v2';
}

// 功能开关：用户可在设置页独立控制各模块的启用/禁用
// 注意：基础聊天和模型配置不受开关控制，始终可用
export interface FeatureGates {
  rag: boolean;        // RAG 知识库增强检索 + 知识库面板入口
  review: boolean;     // 面试复盘报告 + 趋势对比
  templates: boolean;  // 面试训练模板选择器
  training: boolean;   // 7天训练计划面板入口
  voice: boolean;      // 语音输入按钮 + 波形可视化
  screenshot: boolean; // 截图题解按钮
  export: boolean;     // 会话导出（Markdown/PDF）
  smartRouting: boolean; // 智能路由，默认 false
}

// 默认全部开启，智能路由默认关闭（新功能灰度）
export const DEFAULT_FEATURE_GATES: FeatureGates = {
  rag: true,
  review: true,
  templates: true,
  training: true,
  voice: true,
  screenshot: true,
  export: true,
  smartRouting: false,
};

// 快捷键配置接口
export interface ShortcutConfig {
  toggleRecording: string;  // 录制音频开始/停止
  sendMessage: string;      // 发送消息
  takeScreenshot: string;   // 截图
  togglePassthrough: string; // 切换穿透模式
  toggleCompactMode: string; // 切换紧凑模式
  panicHide: string;         // 紧急隐藏/显示窗口
}

// 窗口边界配置
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 窗口配置接口
export interface WindowConfig {
  opacity: number;              // 0.2~1.0，默认 0.8
  hoverRestore: {
    enabled: boolean;           // 默认 true
  };
  bounds: {
    main: WindowBounds | null;
    compact: WindowBounds | null;
  };
  compactMode: {
    enabled: boolean;           // 默认 false
  };
}

// 面试背景配置接口
export interface InterviewBackground {
  /** 是否启用面试背景注入 */
  enabled: boolean;
  /** 公司名称 */
  company: string;
  /** 目标岗位 */
  position: string;
  /** 岗位 JD 全文 */
  jd: string;
  /** 个人简历文本 */
  resume: string;
}

// 面试问题计时记录
export interface QuestionTiming {
  questionIndex: number;
  questionContent: string;
  askedAt: number;
  answeredAt: number;
  durationMs: number;
}

// 默认快捷键配置
export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  toggleRecording: 'CommandOrControl+Shift+R',
  sendMessage: 'CommandOrControl+Enter',
  takeScreenshot: 'CommandOrControl+Shift+S',
  togglePassthrough: 'CommandOrControl+Shift+T',
  toggleCompactMode: 'CommandOrControl+Shift+M',
  panicHide: 'CommandOrControl+Shift+H',
};

// 快捷键功能名称映射
export const SHORTCUT_LABELS: Record<keyof ShortcutConfig, string> = {
  toggleRecording: '录制音频 (开始/停止)',
  sendMessage: '发送消息',
  takeScreenshot: '区域截图',
  togglePassthrough: '切换穿透模式',
  toggleCompactMode: '切换紧凑模式',
  panicHide: '紧急隐藏/显示窗口',
};

// 支持的千问模型列表（已弃用，请使用 PROVIDER_MODELS）
/** @deprecated 请使用 PROVIDER_MODELS */
export const QWEN_MODELS = [
  { id: 'qwen3.7-max', name: 'qwen3.7-max', description: '当前最强性能，适合复杂推理和代码问题' },
  { id: 'qwen3.6-plus', name: 'qwen3.6-plus', description: '平衡性能与质量，适合大多数场景' },
  { id: 'qwen3.6-flash', name: 'qwen3.6-flash', description: '快速响应，成本低，适合简单问题' },
  { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus', description: '专门针对编程优化' },
] as const;

// NLS region options for speech recognition
export const NLS_REGIONS = [
  { id: 'cn-shanghai', name: '华东2（上海）' },
  { id: 'cn-beijing', name: '华北2（北京）' },
  { id: 'cn-shenzhen', name: '华南1（深圳）' },
] as const;

// PromptTemplate 接口定义
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  mode: PromptMode;
}

// 预设 Prompt 模板
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tech',
    name: '技术专家',
    description: '作为技术应聘者，深度回答技术问题，展现扎实功底与项目经验',
    mode: 'assistant',
    prompt: `你是一位技术能力扎实且软技能出色的优秀应聘者，正在参加一场技术面试。当面试官向你提问时，你需要：

1. 理解问题意图：快速识别面试官想考察的技术点或软技能
2. 结构化回答：
   - 技术问题：先给出核心答案，再展开原理，必要时用代码示例说明
   - 行为问题：使用 STAR 法则（情境-任务-行动-结果）组织回答
3. 展现技术深度：
   - 回答准确、有深度，体现扎实的技术功底
   - 解释底层原理和最佳实践
   - 适当提及实际项目经验作为支撑
4. 展现软技能：
   - 表达清晰、逻辑严谨
   - 体现团队协作、问题解决、学习能力
   - 展现对技术的热情和持续学习的态度
5. 互动感：语气自然，像真实面试对话，避免过于机械

请用中文回答，技术术语可保留英文。回答要专业但自然，让面试官感受到你的能力和潜力。重要：回答时请使用纯文本格式，不要使用 Markdown 标记（如**粗体**、*斜体*、列表符号等）。`,
  },
  {
    id: 'behavioral',
    name: '大厂面试官',
    description: 'AI扮演大厂面试官，按结构化流程进行面试',
    mode: 'interviewer',
    prompt: `你是一位资深大厂技术面试官，拥有丰富的面试经验。你将按照以下结构化流程进行面试：

## 面试流程

### 第一阶段：开场（1个问题）
- 简短寒暄，请候选人做自我介绍（引导其说出简历中的亮点项目）

### 第二阶段：技术深挖（3-4个问题）
- 根据JD要求，从基础概念到高级应用逐步深入考察核心技术能力
- 根据候选人回答质量动态调整难度

### 第三阶段：项目经历（2-3个问题）
- 围绕简历中的项目，深挖技术方案和个人贡献
- 关注：技术选型理由、架构设计、遇到的挑战、量化成果

### 第四阶段：行为面试（1-2个问题）
- 考察团队协作、问题解决、学习能力等软素质
- 使用 STAR 法则引导候选人回答

### 第五阶段：反问环节（1个问题）
- 给候选人机会反问，面试结束

## 面试规则
1. 每次只问一个问题，等候选人回答后再提下一个
2. 在提问时标注当前阶段和进度，如"【技术深挖 2/4】"
3. 对候选人的回答仅给一句简短反馈（不超过25字），严禁复述候选人原话
4. 根据候选人回答质量自适应调整后续问题的难度和方向
5. 全程保持专业、友好但有一定压力的面试氛围
6. 连续两轮禁止提出语义重复的问题，如发现重复必须立刻换一个新问题

请用中文进行面试。回答时请使用纯文本格式，不要使用 Markdown 标记。现在请做简短的开场白，然后请候选人做自我介绍。`,
  },
  {
    id: 'cheat',
    name: '极速模式（面试速答）',
    description: 'AI 用最短要点输出，适合实时面试快速扫读',
    mode: 'assistant',
    prompt: `你是一个实时面试辅助系统，帮助候选人回答面试官的问题。你的输出会被候选人在2-3秒内快速扫读并口头转述。

你会收到候选人的背景信息（目标公司、岗位、JD、简历），请根据这些信息给出个性化回答：
- 提到具体技术栈时，优先提及候选人简历中的项目经验
- 结合目标公司的技术文化和面试风格
- 用候选人熟悉的术语和行业背景来组织语言

规则：
1. 第一行：用一句话（不超过30字）总结核心观点
2. 然后用3-5个要点，每个要点不超过20字
3. 关键术语、数字、指标用【】包裹突出显示，方便候选人一眼定位
4. 整体输出不超过200字
5. 语言风格：口语化、自然，像真人说话
6. 不要使用"首先/其次/最后"等冗余连接词，直接用-要点
7. 不要使用任何Markdown格式标记
8. 不要输出代码块，用一句话描述算法思路即可

示例输出：
使用【双指针】解决，时间复杂度【O(n)】
- 左指针从【0】开始，右指针从【末尾】开始
- 每次移动数值较小的指针【向内收缩】
- 记录最大面积【maxArea = max(maxArea, 当前面积)】`,
  },
  {
    id: 'custom',
    name: '自定义',
    description: '完全自定义提示词，满足特殊需求',
    mode: 'assistant',
    prompt: '',
  },
];

// 配置类型定义
export interface AppConfig {
  // ==================== 多 Provider 配置（新增）====================
  activeProvider: ProviderType;                       // 当前激活的 Provider
  providerConfigs: Record<ProviderType, ProviderConfig>;  // 每个 Provider 独立配置
  
  // ==================== 废弃字段（保留兼容）====================
  /** @deprecated 使用 providerConfigs.qwen.apiKey */
  apiKey?: string;
  /** @deprecated 使用 providerConfigs.qwen.model */
  model?: string;
  
  // ==================== 其他配置 ====================
  speechThreshold: number;  // 语音识别阈值，范围 0-100
  // NLS speech recognition (optional, for voice input)
  nlsAppKey: string;
  nlsAccessKeyId: string;
  nlsAccessKeySecret: string;
  nlsRegion: string;
  // Prompt 配置
  promptTemplateId: string;  // 选中的模板ID
  customPrompt: string;      // 自定义 prompt 内容
  customPromptMode?: PromptMode;  // 自定义模板的模式，默认 'assistant'
  // 高质量题解仓库（每行一个 URL）
  highQualityRepoUrls: string;
  // 本地题解文档路径（Markdown，支持 ## 到 ###### 的题号标题）
  localDocPath: string;
  // 快捷键配置
  shortcutConfig: ShortcutConfig;
  // 窗口配置
  window: WindowConfig;
  // 上下文窗口大小（轮数），默认 5
  contextWindowSize: number;
  // 面试背景配置
  interviewBackground: InterviewBackground;
  // 填充词过滤配置
  fillerWordFilter: FillerWordFilterConfig;
  // RAG 配置
  rag: RagConfig;
  // 新手引导：首次启动时弹出5步引导，完成后置为 true，不再自动显示
  onboardingCompleted: boolean;
  // 面试训练模板：当前激活的模板ID，null 表示普通聊天模式（无模板注入）
  activeTemplateId: string | null;
  // 功能开关：控制各功能模块的显示/隐藏，关闭后 UI 入口自动隐藏
  featureGates: FeatureGates;
  // 智能路由配置
  smartRouting: SmartRoutingConfig;
  // 隐身模式（面试防检测）：
  // - true: 窗口不显示在任务栏 + 窗口置顶 + 最小化按钮禁用（只能关闭）
  // - false: 正常显示在任务栏 + 可最小化到任务栏
  stealthMode: boolean;
  // TTS 语音朗读
  ttsEnabled: boolean;   // 是否启用 TTS
  ttsAutoPlay: boolean;  // 新回答自动朗读（注意：会被面试官听到，建议仅在蓝牙耳机场景使用）
  ttsSpeed: number;      // 语速 -5~5，默认 2
  ttsVolume: number;     // 音量 0~100，默认 100
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: true,
  retrievalScope: 'hybrid',
  enableOcr: false,
  enablePersonalMemoryForInterviewer: false,
  embeddingProvider: 'qwen',
  embeddingModel: getDefaultRagEmbeddingModel('qwen'),
  autoReindexPolicy: 'manual',
};

export const DEFAULT_SMART_ROUTING_CONFIG: SmartRoutingConfig = {
  enabled: false,
  latencyThreshold: 3000,
  entries: [],
};

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  // 多 Provider 配置
  activeProvider: 'qwen',
  providerConfigs: {
    qwen: {
      apiKey: '',
      model: 'qwen3.7-max',
      baseUrl: '',
    },
    openai_compat: {
      apiKey: '',
      model: 'gpt-5.5',
      baseUrl: '',
    },
    claude: {
      apiKey: '',
      model: 'claude-opus-4.8',
      baseUrl: '',
    },
  },
  // 其他配置
  speechThreshold: 30,
  nlsAppKey: '',
  nlsAccessKeyId: '',
  nlsAccessKeySecret: '',
  nlsRegion: 'cn-shanghai',
  promptTemplateId: 'tech',
  customPrompt: '',
  customPromptMode: 'assistant',
  highQualityRepoUrls: '',
  localDocPath: '',
  shortcutConfig: DEFAULT_SHORTCUT_CONFIG,
  window: {
    opacity: 0.8,
    hoverRestore: { enabled: true },
    bounds: { main: null, compact: null },
    compactMode: { enabled: false },
  },
  // 上下文窗口大小（轮数），默认 5
  contextWindowSize: 5,
  // 面试背景配置
  interviewBackground: {
    enabled: false,
    company: '',
    position: '',
    jd: '',
    resume: '',
  },
  // 填充词过滤配置
  fillerWordFilter: {
    enabled: true,
    customWords: [],
  },
  rag: DEFAULT_RAG_CONFIG,
  onboardingCompleted: false,
  activeTemplateId: null,
  featureGates: { ...DEFAULT_FEATURE_GATES },
  smartRouting: DEFAULT_SMART_ROUTING_CONFIG,
  stealthMode: false,
  ttsEnabled: false,
  ttsAutoPlay: false,
  ttsSpeed: 2,
  ttsVolume: 100,
};

// Store 实例（延迟初始化）
let store: Store | null = null;
let useLocalStorage = false;  // 如果 Store 失败，切换到 localStorage

// 获取 Store 实例
async function getStore(): Promise<Store | null> {
  if (useLocalStorage) {
    return null;
  }
  if (!store) {
    try {
      store = await Store.load('config.json');
    } catch (err) {
      log.warn('Tauri Store 加载失败，切换到 localStorage');
      useLocalStorage = true;
      return null;
    }
  }
  return store;
}

// 面试背景迁移：处理旧配置（jdHighlights → jd）
function migrateInterviewBackground(bg: any): InterviewBackground {
  if (!bg) {
    return DEFAULT_CONFIG.interviewBackground;
  }
  return {
    enabled: typeof bg.enabled === 'boolean' ? bg.enabled : false,
    company: typeof bg.company === 'string' ? bg.company : '',
    position: typeof bg.position === 'string' ? bg.position : '',
    // 将旧的 jdHighlights 迁移到新的 jd 字段
    jd: typeof bg.jd === 'string' ? bg.jd : (typeof bg.jdHighlights === 'string' ? bg.jdHighlights : ''),
    resume: typeof bg.resume === 'string' ? bg.resume : '',
  };
}

function normalizeOptionalConfigString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRagRetrievalScope(value: unknown): value is RagRetrievalScope {
  return RAG_RETRIEVAL_SCOPE_OPTIONS.some(option => option.id === value);
}

function isRagEmbeddingProviderType(value: unknown): value is RagEmbeddingProviderType {
  return RAG_EMBEDDING_PROVIDERS.some(option => option.id === value);
}

function isRagAutoReindexPolicy(value: unknown): value is RagAutoReindexPolicy {
  return RAG_AUTO_REINDEX_POLICY_OPTIONS.some(option => option.id === value);
}

function migrateRagConfig(rag: any): RagConfig {
  const embeddingProvider = isRagEmbeddingProviderType(rag?.embeddingProvider)
    ? rag.embeddingProvider
    : DEFAULT_RAG_CONFIG.embeddingProvider;

  return {
    enabled: typeof rag?.enabled === 'boolean' ? rag.enabled : DEFAULT_RAG_CONFIG.enabled,
    retrievalScope: isRagRetrievalScope(rag?.retrievalScope)
      ? rag.retrievalScope
      : DEFAULT_RAG_CONFIG.retrievalScope,
    enableOcr: typeof rag?.enableOcr === 'boolean' ? rag.enableOcr : DEFAULT_RAG_CONFIG.enableOcr,
    enablePersonalMemoryForInterviewer:
      typeof rag?.enablePersonalMemoryForInterviewer === 'boolean'
        ? rag.enablePersonalMemoryForInterviewer
        : DEFAULT_RAG_CONFIG.enablePersonalMemoryForInterviewer,
    embeddingProvider,
    embeddingModel: normalizeOptionalConfigString(rag?.embeddingModel)
      || getDefaultRagEmbeddingModel(embeddingProvider),
    autoReindexPolicy: isRagAutoReindexPolicy(rag?.autoReindexPolicy)
      ? rag.autoReindexPolicy
      : DEFAULT_RAG_CONFIG.autoReindexPolicy,
  };
}

// 配置迁移：从旧配置格式迁移到新格式
function migrateConfig(parsed: any): AppConfig {
  // 如果是旧配置格式（存在顶层 apiKey 且没有 providerConfigs），自动迁移
  if (parsed.apiKey !== undefined && !parsed.providerConfigs) {
    return {
      ...DEFAULT_CONFIG,
      activeProvider: 'qwen',
      providerConfigs: {
        qwen: {
          apiKey: parsed.apiKey || '',
          model: parsed.model || 'qwen3.7-max',
        },
        openai_compat: { apiKey: '', model: 'gpt-5.5' },
        claude: { apiKey: '', model: 'claude-opus-4.8' },
      },
      speechThreshold: parsed.speechThreshold ?? DEFAULT_CONFIG.speechThreshold,
      nlsAppKey: parsed.nlsAppKey || '',
      nlsAccessKeyId: parsed.nlsAccessKeyId || '',
      nlsAccessKeySecret: parsed.nlsAccessKeySecret || '',
      nlsRegion: parsed.nlsRegion || DEFAULT_CONFIG.nlsRegion,
      promptTemplateId: parsed.promptTemplateId || DEFAULT_CONFIG.promptTemplateId,
      customPrompt: parsed.customPrompt || '',
      highQualityRepoUrls: parsed.highQualityRepoUrls || '',
      localDocPath: parsed.localDocPath || '',
      shortcutConfig: {
        ...DEFAULT_SHORTCUT_CONFIG,
        ...(parsed.shortcutConfig || {}),
      },
      window: parsed.window || DEFAULT_CONFIG.window,
      rag: migrateRagConfig(parsed.rag),
      featureGates: parsed.featureGates || DEFAULT_FEATURE_GATES,
      smartRouting: parsed.smartRouting || DEFAULT_SMART_ROUTING_CONFIG,
    };
  }

  // 新配置格式，直接合并
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    providerConfigs: {
      ...DEFAULT_CONFIG.providerConfigs,
      ...(parsed.providerConfigs || {}),
    },
    shortcutConfig: {
      ...DEFAULT_SHORTCUT_CONFIG,
      ...(parsed.shortcutConfig || {}),
    },
    contextWindowSize: parsed.contextWindowSize ?? DEFAULT_CONFIG.contextWindowSize,
    interviewBackground: migrateInterviewBackground(parsed.interviewBackground),
    rag: migrateRagConfig(parsed.rag),
    featureGates: parsed.featureGates || DEFAULT_FEATURE_GATES,
    smartRouting: parsed.smartRouting || DEFAULT_SMART_ROUTING_CONFIG,
  };
}

// 从 localStorage 加载
function loadFromLocalStorage(): AppConfig {
  try {
    const saved = localStorage.getItem('ai-cue-config');
    if (saved) {
      const parsed = JSON.parse(saved);
      const config = migrateConfig(parsed);
      // 补充 customPromptMode 默认值
      if (!config.customPromptMode) {
        config.customPromptMode = 'assistant';
      }
      // 迁移：default 模板已删除，自动切换到 tech
      if (config.promptTemplateId === 'default') {
        config.promptTemplateId = 'tech';
      }
    
      return validateAndFixConfig(config);
    }
  } catch (err) {
    log.error('localStorage 读取失败:', err);
  }
  return DEFAULT_CONFIG;
}

// 保存到 localStorage
function saveToLocalStorage(config: AppConfig): void {
  try {
    localStorage.setItem('ai-cue-config', JSON.stringify(config));
  } catch (err) {
    log.error('localStorage 保存失败:', err);
    throw err;
  }
}

// 加载配置
export async function loadConfig(): Promise<AppConfig> {
  const store = await getStore();
  
  if (!store) {
    return loadFromLocalStorage();
  }
  
  try {
    // 加载旧字段用于迁移检测
    const oldApiKey = await store.get<string>('apiKey');
    const oldModel = await store.get<string>('model');
    
    // 加载新配置字段
    const activeProvider = await store.get<ProviderType>('activeProvider');
    const providerConfigs = await store.get<Record<ProviderType, ProviderConfig>>('providerConfigs');
    
    const speechThreshold = await store.get<number>('speechThreshold');
    const nlsAppKey = await store.get<string>('nlsAppKey');
    const nlsAccessKeyId = await store.get<string>('nlsAccessKeyId');
    const nlsAccessKeySecret = await store.get<string>('nlsAccessKeySecret');
    const nlsRegion = await store.get<string>('nlsRegion');
    const promptTemplateId = await store.get<string>('promptTemplateId');
    const customPrompt = await store.get<string>('customPrompt');
    const highQualityRepoUrls = await store.get<string>('highQualityRepoUrls');
    const localDocPath = await store.get<string>('localDocPath');
    const shortcutConfig = await store.get<ShortcutConfig>('shortcutConfig');
    const windowConfig = await store.get<WindowConfig>('window');
    const rag = await store.get<RagConfig>('rag');

    // 检测是否需要迁移（有旧字段但没有新字段）
    if (oldApiKey !== undefined && oldApiKey !== null && !providerConfigs) {
      return migrateConfig({
        apiKey: oldApiKey,
        model: oldModel,
        speechThreshold,
        nlsAppKey,
        nlsAccessKeyId,
        nlsAccessKeySecret,
        nlsRegion,
        promptTemplateId,
        customPrompt,
        highQualityRepoUrls,
        localDocPath,
        shortcutConfig,
        window: windowConfig,
        rag,
      });
    }

    // 新格式配置
    const contextWindowSize = await store.get<number>('contextWindowSize');
    const interviewBackground = await store.get<InterviewBackground>('interviewBackground');
    const fillerWordFilter = await store.get<FillerWordFilterConfig>('fillerWordFilter');
    const featureGates = await store.get<FeatureGates>('featureGates');
    const smartRouting = await store.get<SmartRoutingConfig>('smartRouting');
    const onboardingCompleted = await store.get<boolean>('onboardingCompleted');
    const activeTemplateId = await store.get<string | null>('activeTemplateId');
    const stealthMode = await store.get<boolean>('stealthMode');
    const ttsEnabled = await store.get<boolean>('ttsEnabled');
    const ttsAutoPlay = await store.get<boolean>('ttsAutoPlay');
    const ttsSpeed = await store.get<number>('ttsSpeed');
    const ttsVolume = await store.get<number>('ttsVolume');

    const customPromptMode = await store.get<PromptMode>('customPromptMode');

    const config: AppConfig = {
      activeProvider: activeProvider || DEFAULT_CONFIG.activeProvider,
      providerConfigs: providerConfigs || DEFAULT_CONFIG.providerConfigs,
      speechThreshold: speechThreshold ?? DEFAULT_CONFIG.speechThreshold,
      nlsAppKey: nlsAppKey || '',
      nlsAccessKeyId: nlsAccessKeyId || '',
      nlsAccessKeySecret: nlsAccessKeySecret || '',
      nlsRegion: nlsRegion || DEFAULT_CONFIG.nlsRegion,
      promptTemplateId: promptTemplateId || DEFAULT_CONFIG.promptTemplateId,
      customPrompt: customPrompt || '',
      customPromptMode: customPromptMode || 'assistant',
      highQualityRepoUrls: highQualityRepoUrls || '',
      localDocPath: localDocPath || '',
      shortcutConfig: {
        ...DEFAULT_SHORTCUT_CONFIG,
        ...(shortcutConfig || {}),
      },
      window: windowConfig || DEFAULT_CONFIG.window,
      contextWindowSize: contextWindowSize ?? DEFAULT_CONFIG.contextWindowSize,
      interviewBackground: interviewBackground || DEFAULT_CONFIG.interviewBackground,
      fillerWordFilter: fillerWordFilter || DEFAULT_CONFIG.fillerWordFilter,
      rag: migrateRagConfig(rag),
      onboardingCompleted: onboardingCompleted ?? false,
      activeTemplateId: activeTemplateId ?? null,
      featureGates: featureGates || DEFAULT_FEATURE_GATES,
      smartRouting: smartRouting || DEFAULT_SMART_ROUTING_CONFIG,
      stealthMode: stealthMode ?? false,
      ttsEnabled: ttsEnabled ?? false,
      ttsAutoPlay: ttsAutoPlay ?? false,
      ttsSpeed: ttsSpeed ?? 2,
      ttsVolume: ttsVolume ?? 100,
    };

    // 补充 customPromptMode 默认值
    if (!config.customPromptMode) {
      config.customPromptMode = 'assistant';
    }

    // 迁移：default 模板已删除，自动切换到 tech
    if (config.promptTemplateId === 'default') {
      config.promptTemplateId = 'tech';
    }

    return validateAndFixConfig(config);
  } catch (error) {
    log.error('从 Store 加载失败，切换到 localStorage:', error);
    useLocalStorage = true;
    return loadFromLocalStorage();
  }
}

// 保存配置
export async function saveConfig(config: AppConfig): Promise<void> {
  const store = await getStore();
  
  if (!store) {
    saveToLocalStorage(config);
    return;
  }
  
  try {
    // 新格式配置
    await store.set('activeProvider', config.activeProvider);
    await store.set('providerConfigs', config.providerConfigs);
    
    // 保留旧字段兼容（可选）
    const currentProviderConfig = config.providerConfigs[config.activeProvider];
    await store.set('apiKey', currentProviderConfig.apiKey);
    await store.set('model', currentProviderConfig.model);
    
    await store.set('speechThreshold', config.speechThreshold);
    await store.set('nlsAppKey', config.nlsAppKey);
    await store.set('nlsAccessKeyId', config.nlsAccessKeyId);
    await store.set('nlsAccessKeySecret', config.nlsAccessKeySecret);
    await store.set('nlsRegion', config.nlsRegion);
    await store.set('promptTemplateId', config.promptTemplateId);
    await store.set('customPrompt', config.customPrompt);
    await store.set('customPromptMode', config.customPromptMode);
    await store.set('highQualityRepoUrls', config.highQualityRepoUrls);
    await store.set('localDocPath', config.localDocPath);
    await store.set('shortcutConfig', config.shortcutConfig);
    await store.set('window', config.window);
    await store.set('contextWindowSize', config.contextWindowSize);
    await store.set('interviewBackground', config.interviewBackground);
    await store.set('fillerWordFilter', config.fillerWordFilter);
    await store.set('rag', config.rag);
    await store.set('onboardingCompleted', config.onboardingCompleted);
    await store.set('activeTemplateId', config.activeTemplateId);
    await store.set('featureGates', config.featureGates);
    await store.set('smartRouting', config.smartRouting);
    await store.set('stealthMode', config.stealthMode);
    await store.set('ttsEnabled', config.ttsEnabled);
    await store.set('ttsAutoPlay', config.ttsAutoPlay);
    await store.set('ttsSpeed', config.ttsSpeed);
    await store.set('ttsVolume', config.ttsVolume);
    await store.save();
  } catch (error) {
    log.error('保存到 Store 失败，切换到 localStorage:', error);
    useLocalStorage = true;
    saveToLocalStorage(config);
  }
}

// 验证并修复配置
function validateAndFixConfig(config: AppConfig): AppConfig {
  const validatedConfig = { ...config };
  
  // 验证 window 配置
  if (!validatedConfig.window) {
    validatedConfig.window = DEFAULT_CONFIG.window;
  } else {
    if (typeof validatedConfig.window.opacity !== 'number' || 
        validatedConfig.window.opacity < 0.2 || 
        validatedConfig.window.opacity > 1.0) {
      validatedConfig.window.opacity = DEFAULT_CONFIG.window.opacity;
    }
    if (!validatedConfig.window.hoverRestore) {
      validatedConfig.window.hoverRestore = DEFAULT_CONFIG.window.hoverRestore;
    }
    if (!validatedConfig.window.bounds) {
      validatedConfig.window.bounds = DEFAULT_CONFIG.window.bounds;
    }
    if (!validatedConfig.window.compactMode) {
      validatedConfig.window.compactMode = DEFAULT_CONFIG.window.compactMode;
    }
  }

  // 验证 contextWindowSize（范围：0-40）
  if (typeof validatedConfig.contextWindowSize !== 'number' ||
      validatedConfig.contextWindowSize < 0 ||
      validatedConfig.contextWindowSize > 40 ||
      !Number.isInteger(validatedConfig.contextWindowSize)) {
    validatedConfig.contextWindowSize = DEFAULT_CONFIG.contextWindowSize;
  }

  // 验证 interviewBackground
  if (!validatedConfig.interviewBackground) {
    validatedConfig.interviewBackground = DEFAULT_CONFIG.interviewBackground;
  } else {
    // 确保 enabled 是 boolean
    if (typeof validatedConfig.interviewBackground.enabled !== 'boolean') {
      validatedConfig.interviewBackground.enabled = false;
    }
    // 确保字符串字段为字符串类型
    if (typeof validatedConfig.interviewBackground.company !== 'string') {
      validatedConfig.interviewBackground.company = '';
    }
    if (typeof validatedConfig.interviewBackground.position !== 'string') {
      validatedConfig.interviewBackground.position = '';
    }
    if (typeof validatedConfig.interviewBackground.jd !== 'string') {
      validatedConfig.interviewBackground.jd = '';
    }
    if (typeof validatedConfig.interviewBackground.resume !== 'string') {
      validatedConfig.interviewBackground.resume = '';
    }
  }

  validatedConfig.rag = migrateRagConfig(validatedConfig.rag);
  
  return validatedConfig;
}

// 获取当前配置的 Prompt 模式
export function getPromptMode(config: AppConfig): PromptMode {
  if (config.promptTemplateId === 'custom') {
    return config.customPromptMode || 'assistant';
  }
  const template = PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId);
  return template?.mode || 'assistant';
}

// 验证配置是否完整（当前 Provider 的 API Key 必填）
export function validateConfig(config: AppConfig): { valid: boolean; message?: string } {
  const providerConfig = config.providerConfigs[config.activeProvider];
  if (!providerConfig.apiKey || providerConfig.apiKey.trim() === '') {
    const providerName = PROVIDERS.find(p => p.id === config.activeProvider)?.name || config.activeProvider;
    return { valid: false, message: `请输入 ${providerName} 的 API Key` };
  }
  return { valid: true };
}

// 验证特定 Provider 配置
export function validateProviderConfig(provider: ProviderType, config: ProviderConfig): { valid: boolean; message?: string } {
  if (!config.apiKey || config.apiKey.trim() === '') {
    const providerName = PROVIDERS.find(p => p.id === provider)?.name || provider;
    return { valid: false, message: `请输入 ${providerName} 的 API Key` };
  }
  return { valid: true };
}

// 验证 NLS 配置是否完整（语音识别可选）
export function validateNlsConfig(config: AppConfig): { valid: boolean; message?: string } {
  if (!config.nlsAppKey?.trim()) {
    return { valid: false, message: '请输入 NLS Appkey' };
  }
  if (!config.nlsAccessKeyId?.trim()) {
    return { valid: false, message: '请输入 AccessKey ID' };
  }
  if (!config.nlsAccessKeySecret?.trim()) {
    return { valid: false, message: '请输入 AccessKey Secret' };
  }
  return { valid: true };
}
