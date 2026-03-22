/**
 * 运行时配置快照
 * 
 * 用于在启动阶段只读取一次配置，后续模块从快照获取数据，
 * 避免多次 loadConfig() 造成的重复 IPC 和重复解析。
 */

import { AppConfig, loadConfig, PromptMode, getPromptMode, WindowBounds, ShortcutConfig } from '../store/config';

// 快照类型定义
export interface RuntimeConfigSnapshot {
  // 完整配置
  config: AppConfig;
  // Prompt 模式
  promptMode: PromptMode;
  // 紧凑模式是否启用
  compactModeEnabled: boolean;
  // 窗口不透明度
  windowOpacity: number;
  // 悬停恢复是否启用
  hoverRestoreEnabled: boolean;
  // 快捷键配置
  shortcutConfig: ShortcutConfig;
  // 窗口边界
  windowBounds: {
    main: WindowBounds | null;
    compact: WindowBounds | null;
  };
  // 快照创建时间
  createdAt: number;
}

// 单例快照实例
let configSnapshot: RuntimeConfigSnapshot | null = null;

// 快照是否正在加载
let isLoading = false;

// 快照加载 Promise（用于防止并发加载）
let loadingPromise: Promise<RuntimeConfigSnapshot> | null = null;

/**
 * 加载并缓存运行时配置快照
 * 多次调用只执行一次实际加载，后续返回缓存
 */
export async function loadRuntimeConfigSnapshot(): Promise<RuntimeConfigSnapshot> {
  // 如果已有快照，直接返回
  if (configSnapshot) {
    return configSnapshot;
  }

  // 如果正在加载，返回进行中的 Promise
  if (loadingPromise) {
    return loadingPromise;
  }

  // 如果正在加载但没有 Promise（理论上不应发生）
  if (isLoading) {
    // 等待一段时间后重试
    await new Promise(resolve => setTimeout(resolve, 50));
    return loadRuntimeConfigSnapshot();
  }

  // 开始加载
  isLoading = true;
  loadingPromise = (async () => {
    try {
      const config = await loadConfig();
      const snapshot: RuntimeConfigSnapshot = {
        config,
        promptMode: getPromptMode(config),
        compactModeEnabled: config.window?.compactMode?.enabled ?? false,
        windowOpacity: config.window?.opacity ?? 0.8,
        hoverRestoreEnabled: config.window?.hoverRestore?.enabled ?? true,
        shortcutConfig: config.shortcutConfig,
        windowBounds: {
          main: config.window?.bounds?.main ?? null,
          compact: config.window?.bounds?.compact ?? null,
        },
        createdAt: Date.now(),
      };

      configSnapshot = snapshot;
      return snapshot;
    } finally {
      isLoading = false;
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * 获取已缓存的配置快照
 * 如果快照尚未加载，返回 null
 */
export function getCachedConfigSnapshot(): RuntimeConfigSnapshot | null {
  return configSnapshot;
}

/**
 * 检查配置快照是否已加载
 */
export function isConfigSnapshotLoaded(): boolean {
  return configSnapshot !== null;
}

/**
 * 获取 Prompt 模式
 * 如果快照已加载，从快照获取；否则触发加载
 */
export async function getPromptModeFromSnapshot(): Promise<PromptMode> {
  const snapshot = await loadRuntimeConfigSnapshot();
  return snapshot.promptMode;
}

/**
 * 获取紧凑模式状态
 */
export function getCompactModeFromSnapshot(): boolean | null {
  return configSnapshot?.compactModeEnabled ?? null;
}

/**
 * 获取窗口透明度
 */
export function getWindowOpacityFromSnapshot(): number | null {
  return configSnapshot?.windowOpacity ?? null;
}

/**
 * 获取悬停恢复状态
 */
export function getHoverRestoreFromSnapshot(): boolean | null {
  return configSnapshot?.hoverRestoreEnabled ?? null;
}

/**
 * 获取快捷键配置
 */
export function getShortcutConfigFromSnapshot(): ShortcutConfig | null {
  return configSnapshot?.shortcutConfig ?? null;
}

/**
 * 获取窗口边界
 */
export function getWindowBoundsFromSnapshot(): { main: WindowBounds | null; compact: WindowBounds | null } | null {
  return configSnapshot?.windowBounds ?? null;
}

/**
 * 更新快照中的配置（当配置被修改时调用）
 */
export function updateConfigSnapshot(newConfig: AppConfig): void {
  if (!configSnapshot) {
    return;
  }

  configSnapshot = {
    ...configSnapshot,
    config: newConfig,
    promptMode: getPromptMode(newConfig),
    compactModeEnabled: newConfig.window?.compactMode?.enabled ?? false,
    windowOpacity: newConfig.window?.opacity ?? 0.8,
    hoverRestoreEnabled: newConfig.window?.hoverRestore?.enabled ?? true,
    shortcutConfig: newConfig.shortcutConfig,
    windowBounds: {
      main: newConfig.window?.bounds?.main ?? null,
      compact: newConfig.window?.bounds?.compact ?? null,
    },
  };
}

/**
 * 清除配置快照（用于测试或重置）
 */
export function clearConfigSnapshot(): void {
  configSnapshot = null;
  isLoading = false;
  loadingPromise = null;
}
