// 配置管理 - 使用 Tauri Store 插件持久化（带 localStorage 备用）
import { Store } from '@tauri-apps/plugin-store';

// 支持的千问模型列表
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
  apiKey: string;  // 必填
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  provider: 'qwen',
  model: 'qwen-turbo',
  apiKey: '',
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
    console.log('Store 数据:', { model, hasApiKey: !!apiKey });
    
    return {
      provider: 'qwen',
      model: model || DEFAULT_CONFIG.model,
      apiKey: apiKey || '',
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
