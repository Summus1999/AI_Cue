/**
 * 网络状态监控服务
 * 提供统一网络状态监控，定时检测 + 事件驱动
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '../store/config';
import { createLogger } from './logger';

const log = createLogger('NetworkMonitor');

/** 网络状态 */
export interface NetworkStatus {
  /** 状态: connected-正常, degraded-降级, disconnected-断开, checking-检测中 */
  state: 'connected' | 'degraded' | 'disconnected' | 'checking';
  /** 互联网是否连通 */
  internetConnected: boolean;
  /** Provider API 是否可达 */
  providerReachable: boolean;
  /** 延迟（ms） */
  latencyMs: number | null;
  /** 上次检测时间 */
  lastCheck: Date;
  /** 错误详情 */
  errorDetail: string | null;
}

type NetworkStatusListener = (status: NetworkStatus) => void;

/**
 * 网络监控器接口
 * 定义网络监控的契约，便于测试和扩展
 */
export interface INetworkMonitor {
  /** 开始网络监控 */
  startMonitoring(intervalMs?: number): void;
  /** 停止网络监控 */
  stopMonitoring(): void;
  /** 立即执行一次网络检测 */
  checkNow(): Promise<NetworkStatus>;
  /** 订阅状态变更 */
  onStatusChange(listener: NetworkStatusListener): () => void;
  /** 获取当前状态 */
  getStatus(): NetworkStatus;
  /** 刷新配置缓存 */
  refreshConfig(): void;
}

/**
 * 网络监控器 - 单例模式
 * 管理网络状态检测和状态变更通知
 */
class NetworkMonitor implements INetworkMonitor {
  private static instance: NetworkMonitor;
  private status: NetworkStatus;
  private listeners: Set<NetworkStatusListener> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private checkInterval: number = 30000; // 默认 30 秒
  private offlineHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private startCount: number = 0; // 引用计数，防止重复启动
  private configCache: AppConfig | null = null; // 配置缓存，避免重复动态导入
  private configLoadPromise: Promise<AppConfig> | null = null; // 防止并发加载配置

  private constructor() {
    this.status = {
      state: 'checking',
      internetConnected: true,
      providerReachable: true,
      latencyMs: null,
      lastCheck: new Date(),
      errorDetail: null,
    };
  }

  static getInstance(): NetworkMonitor {
    if (!NetworkMonitor.instance) {
      NetworkMonitor.instance = new NetworkMonitor();
    }
    return NetworkMonitor.instance;
  }

  /**
   * 开始网络监控
   * @param intervalMs 检测间隔（毫秒），默认 30000
   */
  startMonitoring(intervalMs?: number): void {
    this.startCount++;
    // 如果已经启动，只更新引用计数，不重复启动
    if (this.startCount > 1) {
      log.debug(`已启动，引用计数: ${this.startCount}`);
      return;
    }

    if (intervalMs) {
      this.checkInterval = intervalMs;
    }

    // 立即执行一次检测
    this.checkNow();

    // 定时检测
    this.intervalId = setInterval(() => {
      this.checkNow();
    }, this.checkInterval);

    // 监听浏览器离线/在线事件（作为补充检测）
    this.offlineHandler = () => {
      this.handleOffline();
    };
    this.onlineHandler = () => {
      this.handleOnline();
    };
    window.addEventListener('offline', this.offlineHandler);
    window.addEventListener('online', this.onlineHandler);

    log.info('网络监控已启动');
  }

  /**
   * 停止网络监控
   * 使用引用计数确保所有调用者都停止后才真正停止
   */
  stopMonitoring(): void {
    this.startCount--;
    // 还有引用，不真正停止
    if (this.startCount > 0) {
      log.debug(`引用计数: ${this.startCount}，暂不停止`);
      return;
    }

    // 确保计数不会为负数
    this.startCount = 0;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // 移除浏览器事件监听
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
      this.offlineHandler = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }

    log.info('网络监控已停止');
  }

  /**
   * 浏览器离线事件处理
   */
  private handleOffline(): void {
    this.updateStatus({
      state: 'disconnected',
      internetConnected: false,
      providerReachable: false,
      errorDetail: '浏览器检测到网络断开',
    });
    // 立即开始快速检测
    this.adjustCheckInterval('disconnected', this.status.state);
  }

  /**
   * 浏览器在线事件处理
   */
  private handleOnline(): void {
    // 浏览器报告在线，立即触发完整的后端检测
    this.checkNow();
  }

  /**
   * 获取配置（带缓存和并发控制）
   * 避免每次检测都动态导入配置模块
   */
  private async getConfig(): Promise<AppConfig> {
    // 如果已有缓存，直接返回
    if (this.configCache) {
      return this.configCache;
    }

    // 如果正在加载中，返回现有的 Promise
    if (this.configLoadPromise) {
      return this.configLoadPromise;
    }

    // 开始加载配置
    this.configLoadPromise = (async () => {
      const { loadConfig } = await import('../store/config');
      const config = await loadConfig();
      this.configCache = config;
      return config;
    })();

    return this.configLoadPromise;
  }

  /**
   * 刷新配置缓存
   * 当配置变更时调用
   */
  refreshConfig(): void {
    this.configCache = null;
    this.configLoadPromise = null;
    log.debug('配置缓存已刷新');
  }

  /**
   * 立即执行一次网络检测
   */
  async checkNow(): Promise<NetworkStatus> {
    const previousState = this.status.state;

    this.updateStatus({ state: 'checking' });

    try {
      // 从缓存获取配置（避免重复动态导入）
      const config = await this.getConfig();
      const provider = config.activeProvider;
      const baseUrl = config.providerConfigs[provider]?.baseUrl;

      const result = await invoke<{
        internetConnected: boolean;
        providerReachable: boolean;
        latencyMs: number | null;
        lastCheck: string;
        errorDetail: string | null;
      }>('check_network_health', {
        providerType: provider,
        baseUrl: baseUrl || null,
      });

      const newState = this.determineState(result);

      this.updateStatus({
        state: newState,
        internetConnected: result.internetConnected,
        providerReachable: result.providerReachable,
        latencyMs: result.latencyMs,
        lastCheck: new Date(result.lastCheck),
        errorDetail: result.errorDetail,
      });

      // 智能频率调节
      this.adjustCheckInterval(newState, previousState);

    } catch (error) {
      this.updateStatus({
        state: 'disconnected',
        internetConnected: false,
        providerReachable: false,
        latencyMs: null,
        lastCheck: new Date(),
        errorDetail: String(error),
      });
    }

    return this.status;
  }

  /**
   * 根据检测结果确定状态
   */
  private determineState(result: {
    internetConnected: boolean;
    providerReachable: boolean;
  }): NetworkStatus['state'] {
    if (!result.internetConnected) return 'disconnected';
    if (!result.providerReachable) return 'degraded';
    return 'connected';
  }

  /**
   * 根据状态调整检测频率
   * - disconnected: 5秒快速检测
   * - degraded: 15秒中等频率
   * - connected: 30秒低频率
   */
  private adjustCheckInterval(
    newState: NetworkStatus['state'],
    _previousState: NetworkStatus['state']
  ): void {
    // 三级频率调节
    const targetInterval =
      newState === 'disconnected' ? 5000 :     // 无网络：5秒快速检测
      newState === 'degraded' ? 15000 :        // 降级：15秒中等频率
      30000;                                    // 正常：30秒低频率

    if (targetInterval !== this.checkInterval) {
      this.checkInterval = targetInterval;

      // 重启定时器
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = setInterval(() => {
          this.checkNow();
        }, this.checkInterval);
      }
    }
  }

  /**
   * 订阅状态变更
   * @param listener 状态变更监听器
   * @returns 取消订阅函数
   */
  onStatusChange(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener);
    // 立即通知当前状态
    listener({ ...this.status });
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取当前状态
   */
  getStatus(): NetworkStatus {
    return { ...this.status };
  }

  /**
   * 更新状态并通知所有监听器
   */
  private updateStatus(partial: Partial<NetworkStatus>): void {
    this.status = { ...this.status, ...partial };
    this.listeners.forEach(listener => listener({ ...this.status }));
  }
}

// 导出单例实例
export const networkMonitor = NetworkMonitor.getInstance();
