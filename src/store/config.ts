// 配置管理 - 使用 Tauri Store 插件持久化（带 localStorage 备用）
import { Store } from '@tauri-apps/plugin-store';

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

export type PromptMode = 'assistant' | 'interviewer';

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
    { id: 'qwen-turbo', name: 'Qwen Turbo', description: '快速响应，成本低，适合简单问题' },
    { id: 'qwen-plus', name: 'Qwen Plus', description: '平衡性能与质量，适合大多数场景' },
    { id: 'qwen-max', name: 'Qwen Max', description: '最强性能，适合复杂推理和代码问题' },
    { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', description: '专门针对编程优化' },
    { id: 'qwen-vl-max', name: 'Qwen VL Max', description: '视觉理解模型，支持截图识别' },
  ],
  openai_compat: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI 多模态旗舰模型' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: '轻量级，性价比高' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'DeepSeek 对话模型' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: 'DeepSeek 推理模型' },
  ],
  claude: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: '平衡性能与质量' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: '最强推理能力' },
    { id: 'claude-haiku-3-5-20241022', name: 'Claude 3.5 Haiku', description: '快速响应' },
  ],
};

// 快捷键配置接口
export interface ShortcutConfig {
  toggleRecording: string;  // 录制音频开始/停止
  sendMessage: string;      // 发送消息
  takeScreenshot: string;   // 截图
  togglePassthrough: string; // 切换穿透模式
  toggleCompactMode: string; // 切换紧凑模式
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
};

// 快捷键功能名称映射
export const SHORTCUT_LABELS: Record<keyof ShortcutConfig, string> = {
  toggleRecording: '录制音频 (开始/停止)',
  sendMessage: '发送消息',
  takeScreenshot: '区域截图',
  togglePassthrough: '切换穿透模式',
  toggleCompactMode: '切换紧凑模式',
};

// 支持的千问模型列表（已弃用，请使用 PROVIDER_MODELS）
/** @deprecated 请使用 PROVIDER_MODELS */
export const QWEN_MODELS = [
  { id: 'qwen-turbo', name: 'qwen-turbo', description: '快速响应，成本低，适合简单问题' },
  { id: 'qwen-plus', name: 'qwen-plus', description: '平衡性能与质量，适合大多数场景' },
  { id: 'qwen-max', name: 'qwen-max', description: '最强性能，适合复杂推理和代码问题' },
  { id: 'qwen-coder-plus', name: 'qwen-coder-plus', description: '专门针对编程优化' },
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
- 简短寒暄，请候选人做自我介绍

### 第二阶段：技术深挖（3-4个问题）
- 根据JD要求的核心技术栈，深入考察技术理解和实践能力
- 从基础概念到高级应用逐步深入
- 根据回答质量动态调整难度

### 第三阶段：项目经历（2-3个问题）
- 根据简历中的项目经历，深挖技术方案和个人贡献
- 关注：技术选型理由、遇到的挑战、解决方案、量化成果

### 第四阶段：行为面试（1-2个问题）
- 考察团队协作、问题解决、学习能力等软素质
- 使用 STAR 法则引导候选人回答

### 第五阶段：反问环节（1个问题）
- 给候选人机会反问，面试结束

## 面试规则
1. 每次只问一个问题，等候选人回答后再提下一个
2. 在提问时标注当前阶段和进度，如“【技术深挖 2/4】”
3. 对候选人的回答仅给一句简短反馈（不超过25字），严禁复述候选人的原话
4. 根据候选人回答质量自适应调整后续问题的难度和方向
5. 全程保持专业、友好但有一定压力的面试氛围
6. 面试开始时先简单自我介绍作为面试官的身份
7. 连续两轮禁止提出语义重复的问题，如发现重复必须立刻换一个新问题

请用中文进行面试。回答时请使用纯文本格式，不要使用 Markdown 标记。现在请做简短的开场白，然后请候选人做自我介绍。`,
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
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  // 多 Provider 配置
  activeProvider: 'qwen',
  providerConfigs: {
    qwen: {
      apiKey: '',
      model: 'qwen-plus',
      baseUrl: '',
    },
    openai_compat: {
      apiKey: '',
      model: 'gpt-4o',
      baseUrl: '',
    },
    claude: {
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
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
      console.log('Tauri Store 加载成功');
    } catch (err) {
      console.warn('Tauri Store 加载失败，切换到 localStorage:', err);
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

// 配置迁移：从旧配置格式迁移到新格式
function migrateConfig(parsed: any): AppConfig {
  // 如果是旧配置格式（存在顶层 apiKey 且没有 providerConfigs），自动迁移
  if (parsed.apiKey !== undefined && !parsed.providerConfigs) {
    console.log('检测到旧配置格式，自动迁移...');
    return {
      ...DEFAULT_CONFIG,
      activeProvider: 'qwen',
      providerConfigs: {
        qwen: {
          apiKey: parsed.apiKey || '',
          model: parsed.model || 'qwen-plus',
        },
        openai_compat: { apiKey: '', model: 'gpt-4o' },
        claude: { apiKey: '', model: 'claude-sonnet-4-20250514' },
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
  };
}

// 从 localStorage 加载
function loadFromLocalStorage(): AppConfig {
  try {
    const saved = localStorage.getItem('ai-cue-config');
    if (saved) {
      const parsed = JSON.parse(saved);
      console.log('从 localStorage 加载配置:', parsed);
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
    console.error('localStorage 读取失败:', err);
  }
  return DEFAULT_CONFIG;
}

// 保存到 localStorage
function saveToLocalStorage(config: AppConfig): void {
  try {
    localStorage.setItem('ai-cue-config', JSON.stringify(config));
    console.log('配置已保存到 localStorage');
  } catch (err) {
    console.error('localStorage 保存失败:', err);
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
    console.log('从 Tauri Store 加载配置...');
    
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

    // 检测是否需要迁移（有旧字段但没有新字段）
    if (oldApiKey !== undefined && oldApiKey !== null && !providerConfigs) {
      console.log('检测到旧 Store 格式，执行迁移...');
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
      });
    }

    // 新格式配置
    const contextWindowSize = await store.get<number>('contextWindowSize');
    const interviewBackground = await store.get<InterviewBackground>('interviewBackground');
    const fillerWordFilter = await store.get<FillerWordFilterConfig>('fillerWordFilter');

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
    console.error('从 Store 加载失败，切换到 localStorage:', error);
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
    await store.save();
    console.log('配置已保存到 Tauri Store');
  } catch (error) {
    console.error('保存到 Store 失败，尝试 localStorage:', error);
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
