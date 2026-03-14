// 配置管理 - 使用 Tauri Store 插件持久化（带 localStorage 备用）
import { Store } from '@tauri-apps/plugin-store';

// 快捷键配置接口
export interface ShortcutConfig {
  toggleRecording: string;  // 录制音频开始/停止
  sendMessage: string;      // 发送消息
  takeScreenshot: string;   // 截图
}

// 默认快捷键配置
export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  toggleRecording: 'CommandOrControl+Shift+R',
  sendMessage: 'CommandOrControl+Enter',
  takeScreenshot: 'CommandOrControl+Shift+S',
};

// 快捷键功能名称映射
export const SHORTCUT_LABELS: Record<keyof ShortcutConfig, string> = {
  toggleRecording: '录制音频 (开始/停止)',
  sendMessage: '发送消息',
  takeScreenshot: '区域截图',
};

// 支持的千问模型列表
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

// 预设 Prompt 模板
export const PROMPT_TEMPLATES = [
  {
    id: 'default',
    name: '通用面试助手',
    description: '适合各类面试场景，平衡技术与行为问题',
    prompt: `你是一个专业的面试助手。用户会向你提供面试官的问题，你需要：
1. 理解问题的核心考察点
2. 给出清晰、有条理的回答要点
3. 回答应简洁有力，突出重点
4. 如果是技术问题，给出准确的技术解答
5. 如果是行为面试问题，使用 STAR 法则组织回答

请用中文回答，保持专业但友好的语气。重要：回答时请使用纯文本格式，不要使用 Markdown 标记（如**粗体**、*斜体*、列表符号等）。`,
  },
  {
    id: 'tech',
    name: '技术面试专家',
    description: '扮演技术能力和软技能都很强的应聘者，回答面试官的问题',
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
    name: '行为面试教练',
    description: '使用STAR法则，突出软技能和领导力',
    prompt: `你是专业的行为面试教练，擅长指导候选人回答行为类面试问题。针对用户提供的问题：
1. 识别问题考察的核心软技能（如沟通、领导力、团队协作、问题解决等）
2. 使用 STAR 法则构建回答框架：
   - Situation（情境）：简要描述背景
   - Task（任务）：明确你的职责
   - Action（行动）：详细说明你采取的行动
   - Result（结果）：量化或具体化成果
3. 提供一个示例回答作为参考
4. 给出回答技巧和注意事项

请用中文回答，帮助用户展现最佳的职业形象。重要：回答时请使用纯文本格式，不要使用 Markdown 标记（如**粗体**、*斜体*、列表符号等）。`,
  },
  {
    id: 'custom',
    name: '自定义',
    description: '完全自定义提示词，满足特殊需求',
    prompt: '',
  },
] as const;

// 配置类型定义
export interface AppConfig {
  provider: 'qwen';
  model: string;
  apiKey: string;  // DashScope API Key
  speechThreshold: number;  // 语音识别阈值，范围 0-100
  // NLS speech recognition (optional, for voice input)
  nlsAppKey: string;
  nlsAccessKeyId: string;
  nlsAccessKeySecret: string;
  nlsRegion: string;
  // Prompt 配置
  promptTemplateId: string;  // 选中的模板ID
  customPrompt: string;      // 自定义 prompt 内容
  // 高质量题解仓库（每行一个 URL）
  highQualityRepoUrls: string;
  // 本地题解文档路径（Markdown，支持 ## 到 ###### 的题号标题）
  localDocPath: string;
  // 快捷键配置
  shortcutConfig: ShortcutConfig;
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  provider: 'qwen',
  model: 'qwen-turbo',
  apiKey: '',
  speechThreshold: 30,
  nlsAppKey: '',
  nlsAccessKeyId: '',
  nlsAccessKeySecret: '',
  nlsRegion: 'cn-shanghai',
  promptTemplateId: 'default',
  customPrompt: '',
  highQualityRepoUrls: '',
  localDocPath: '',
  shortcutConfig: DEFAULT_SHORTCUT_CONFIG,
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

// 从 localStorage 加载
function loadFromLocalStorage(): AppConfig {
  try {
    const saved = localStorage.getItem('ai-cue-config');
    if (saved) {
      const parsed = JSON.parse(saved);
      console.log('从 localStorage 加载配置:', parsed);
      return {
        provider: 'qwen',
        model: parsed.model || DEFAULT_CONFIG.model,
        apiKey: parsed.apiKey || '',
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
      };
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
    const model = await store.get<string>('model');
    const apiKey = await store.get<string>('apiKey');
    const speechThreshold = await store.get<number>('speechThreshold');
    console.log('Store 数据:', { model, hasApiKey: !!apiKey, speechThreshold });
    
    const nlsAppKey = await store.get<string>('nlsAppKey');
    const nlsAccessKeyId = await store.get<string>('nlsAccessKeyId');
    const nlsAccessKeySecret = await store.get<string>('nlsAccessKeySecret');
    const nlsRegion = await store.get<string>('nlsRegion');

    const promptTemplateId = await store.get<string>('promptTemplateId');
    const customPrompt = await store.get<string>('customPrompt');
    const highQualityRepoUrls = await store.get<string>('highQualityRepoUrls');
    const localDocPath = await store.get<string>('localDocPath');
    const shortcutConfig = await store.get<ShortcutConfig>('shortcutConfig');

    return {
      provider: 'qwen',
      model: model || DEFAULT_CONFIG.model,
      apiKey: apiKey || '',
      speechThreshold: speechThreshold ?? DEFAULT_CONFIG.speechThreshold,
      nlsAppKey: nlsAppKey || '',
      nlsAccessKeyId: nlsAccessKeyId || '',
      nlsAccessKeySecret: nlsAccessKeySecret || '',
      nlsRegion: nlsRegion || DEFAULT_CONFIG.nlsRegion,
      promptTemplateId: promptTemplateId || DEFAULT_CONFIG.promptTemplateId,
      customPrompt: customPrompt || '',
      highQualityRepoUrls: highQualityRepoUrls || '',
      localDocPath: localDocPath || '',
      shortcutConfig: {
        ...DEFAULT_SHORTCUT_CONFIG,
        ...(shortcutConfig || {}),
      },
    };
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
    await store.set('provider', config.provider);
    await store.set('model', config.model);
    await store.set('apiKey', config.apiKey);
    await store.set('speechThreshold', config.speechThreshold);
    await store.set('nlsAppKey', config.nlsAppKey);
    await store.set('nlsAccessKeyId', config.nlsAccessKeyId);
    await store.set('nlsAccessKeySecret', config.nlsAccessKeySecret);
    await store.set('nlsRegion', config.nlsRegion);
    await store.set('promptTemplateId', config.promptTemplateId);
    await store.set('customPrompt', config.customPrompt);
    await store.set('highQualityRepoUrls', config.highQualityRepoUrls);
    await store.set('localDocPath', config.localDocPath);
    await store.set('shortcutConfig', config.shortcutConfig);
    await store.save();
    console.log('配置已保存到 Tauri Store');
  } catch (error) {
    console.error('保存到 Store 失败，尝试 localStorage:', error);
    useLocalStorage = true;
    saveToLocalStorage(config);
  }
}

// 验证配置是否完整（API Key 必填）
export function validateConfig(config: AppConfig): { valid: boolean; message?: string } {
  if (!config.apiKey || config.apiKey.trim() === '') {
    return { valid: false, message: '请输入阿里云 DashScope API Key' };
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
