// Provider 注册表服务 - 提供 Provider 元数据和工具函数

import { invoke } from '@tauri-apps/api/core';
import type { ProviderType, ProviderConfig, ProviderMeta } from '../store/config';
import { PROVIDERS, PROVIDER_MODELS } from '../store/config';

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * 获取所有可用的 Provider 列表
 */
export function getAvailableProviders(): ProviderMeta[] {
  return PROVIDERS;
}

/**
 * 获取指定 Provider 的元数据
 */
export function getProviderMeta(provider: ProviderType): ProviderMeta | undefined {
  return PROVIDERS.find(p => p.id === provider);
}

/**
 * 获取指定 Provider 的默认模型列表
 */
export function getDefaultModels(provider: ProviderType): ModelInfo[] {
  return PROVIDER_MODELS[provider] || [];
}

/**
 * 获取指定 Provider 和模型的信息
 */
export function getModelInfo(provider: ProviderType, modelId: string): ModelInfo | undefined {
  const models = PROVIDER_MODELS[provider];
  return models?.find(m => m.id === modelId);
}

/**
 * 获取模型显示名称
 */
export function getModelDisplayName(provider: ProviderType, modelId: string): string {
  const model = getModelInfo(provider, modelId);
  return model?.name || modelId;
}

/**
 * 测试 Provider 连通性
 */
export async function testProviderConnection(
  provider: ProviderType,
  config: ProviderConfig,
): Promise<ConnectionTestResult> {
  try {
    const result = await invoke<{
      success: boolean;
      latency_ms: number;
      message: string;
    }>('ai_test_connection', {
      provider,
      config: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || null,
      },
    });

    return {
      success: result.success,
      latencyMs: result.latency_ms,
      message: result.message,
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: 0,
      message: String(error),
    };
  }
}

/**
 * 获取默认的 Provider 配置
 */
export function getDefaultProviderConfig(provider: ProviderType): ProviderConfig {
  const defaultModels: Record<ProviderType, string> = {
    qwen: 'qwen3.7-max',
    openai_compat: 'gpt-5.5',
    claude: 'claude-opus-4.8',
  };

  return {
    apiKey: '',
    model: defaultModels[provider],
    baseUrl: '',
    customModels: [],
  };
}

/**
 * 验证 Provider 配置是否有效
 */
export function validateProviderConfig(config: ProviderConfig): { valid: boolean; message?: string } {
  if (!config.apiKey?.trim()) {
    return { valid: false, message: '请输入 API Key' };
  }
  if (!config.model?.trim()) {
    return { valid: false, message: '请选择模型' };
  }
  return { valid: true };
}
