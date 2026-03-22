// 插件 Provider 注册表服务 - 管理动态 Provider

import { invoke } from '@tauri-apps/api/core';
import type {
  ProviderDescriptor,
  ProviderMeta,
  ConnectionTestResult,
  ExtendedProviderType,
} from '../types/provider';
import { createLogger } from './logger';

const log = createLogger('PluginProviderRegistry');

/**
 * 插件 Provider 注册表服务
 */
class PluginProviderRegistry {
  private cachedProviders: ProviderMeta[] | null = null;

  /**
   * 获取所有可用 Provider（含内置和动态）
   */
  async getAllProviders(): Promise<ProviderMeta[]> {
    if (this.cachedProviders) {
      return this.cachedProviders;
    }

    try {
      const providers = await invoke<ProviderMeta[]>('ai_list_providers');
      this.cachedProviders = providers;
      log.info('获取 Provider 列表成功', { count: providers.length });
      return providers;
    } catch (error) {
      log.error('获取 Provider 列表失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 注册动态 Provider
   */
  async registerProvider(descriptor: ProviderDescriptor): Promise<void> {
    try {
      await invoke('ai_register_provider', { descriptor });
      this.invalidateCache();
      log.info('注册动态 Provider 成功', { id: descriptor.id });
    } catch (error) {
      log.error('注册动态 Provider 失败', { id: descriptor.id, error: String(error) });
      throw error;
    }
  }

  /**
   * 注销动态 Provider
   */
  async unregisterProvider(providerId: string): Promise<void> {
    try {
      await invoke('ai_unregister_provider', { providerId });
      this.invalidateCache();
      log.info('注销动态 Provider 成功', { id: providerId });
    } catch (error) {
      log.error('注销动态 Provider 失败', { id: providerId, error: String(error) });
      throw error;
    }
  }

  /**
   * 测试动态 Provider 连通性
   */
  async testConnection(
    providerId: string,
    apiKey: string,
    baseUrl?: string
  ): Promise<ConnectionTestResult> {
    try {
      log.info('测试 Provider 连通性', { providerId });

      const result = await invoke<ConnectionTestResult>('ai_test_connection_dynamic', {
        providerId,
        config: {
          apiKey,
          baseUrl: baseUrl || null,
          extra: null,
        },
      });

      log.info('Provider 连通性测试结果', {
        providerId,
        success: result.success,
        latencyMs: result.latencyMs,
      });

      return result;
    } catch (error) {
      log.error('Provider 连通性测试失败', { providerId, error: String(error) });
      throw error;
    }
  }

  /**
   * 刷新缓存
   */
  invalidateCache(): void {
    this.cachedProviders = null;
    log.debug('Provider 缓存已失效');
  }

  /**
   * 判断是否为内置 Provider
   */
  isBuiltin(providerType: ExtendedProviderType | string): boolean {
    if (typeof providerType === 'string') {
      return ['qwen', 'openai_compat', 'claude'].includes(providerType);
    }
    return providerType.type === 'builtin';
  }

  /**
   * 判断是否为动态 Provider
   */
  isDynamic(providerType: ExtendedProviderType | string): boolean {
    if (typeof providerType === 'string') {
      return providerType.startsWith('dynamic:');
    }
    return providerType.type === 'dynamic';
  }

  /**
   * 从 providerType 提取 ID
   */
  extractProviderId(providerType: string): string {
    if (providerType.startsWith('dynamic:')) {
      return providerType.substring(8);
    }
    return providerType;
  }

  /**
   * 获取 Provider 类型
   */
  getProviderType(providerType: string): ExtendedProviderType {
    if (['qwen', 'openai_compat', 'claude'].includes(providerType)) {
      return { type: 'builtin', id: providerType as 'qwen' | 'openai_compat' | 'claude' };
    }
    if (providerType.startsWith('dynamic:')) {
      return { type: 'dynamic', id: providerType.substring(8) };
    }
    // 未知类型，默认为内置
    return { type: 'builtin', id: 'qwen' };
  }
}

export const pluginProviderRegistry = new PluginProviderRegistry();
