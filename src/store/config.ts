// 配置管理 - 使用 Tauri Store 插件持久化
import { Store } from '@tauri-apps/plugin-store';

// 支持的千问模型
export const QWEN_MODELS = [
  { id: 'qwen-turbo', name: 'qwen-turbo', description: '快速响应，成本低，适合简单问题' },
  { id: 'qwen-plus', name: 'qwen-plus', description: '平衡性能与质量，适合大多数场景' },
  { id: 'qwen-max', name: 'qwen-max', description: '最强性能，适合复杂推理和代码问题' },
  { id: 'qwen-coder-plus', name: 'qwen-coder-plus', description: '专门针对编程优化' },
] as const;

// 配置类型定义
export interface AppConfig {
  provider: 'qwen';
  model: string;
  apiKey?: string;
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  provider: 'qwen',
  model: 'qwen-turbo',
};

// Store 实例（延迟初始化）
let store: Store | null = null;

// 获取 Store 实例
async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('config.json');
  }
  return store;
}

// 加载配置
export async function loadConfig(): Promise<AppConfig> {
  try {
    const store = await getStore();
    const provider = await store.get<string>('provider');
    const model = await store.get<string>('model');
    const apiKey = await store.get<string>('apiKey');
    
    return {
      provider: (provider as 'qwen') || DEFAULT_CONFIG.provider,
      model: model || DEFAULT_CONFIG.model,
      apiKey: apiKey || undefined,
    };
  } catch (error) {
    console.error('加载配置失败:', error);
    return DEFAULT_CONFIG;
  }
}

// 保存配置
export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set('provider', config.provider);
    await store.set('model', config.model);
    if (config.apiKey) {
      await store.set('apiKey', config.apiKey);
    }
    await store.save();
  } catch (error) {
    console.error('保存配置失败:', error);
    throw error;
  }
}
