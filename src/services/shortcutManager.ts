// 快捷键管理服务 - 使用 Tauri 全局快捷键插件
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { ShortcutConfig, DEFAULT_SHORTCUT_CONFIG } from '../store/config';
import { createLogger } from './logger';

const log = createLogger('Shortcut');

// 快捷键回调函数类型
export type ShortcutCallback = () => void;

// 快捷键处理器映射
interface ShortcutHandlers {
  toggleRecording?: ShortcutCallback;
  sendMessage?: ShortcutCallback;
  takeScreenshot?: ShortcutCallback;
  togglePassthrough?: ShortcutCallback;
  toggleCompactMode?: ShortcutCallback;
  panicHide?: ShortcutCallback;
}

// 当前注册的快捷键
let currentShortcuts: ShortcutConfig = { ...DEFAULT_SHORTCUT_CONFIG };

// 快捷键处理器
let handlers: ShortcutHandlers = {};

// 初始化状态
let isInitialized = false;

/**
 * 设置快捷键处理器
 */
export function setShortcutHandlers(newHandlers: ShortcutHandlers): void {
  handlers = { ...handlers, ...newHandlers };
}

/**
 * 注册所有快捷键（先全部注销再重新注册）
 */
async function registerAllShortcuts(config: ShortcutConfig): Promise<void> {
  // 先注销所有，避免 isRegistered hang 问题
  try {
    await unregisterAll();
  } catch (err) {
    log.warn('注销快捷键失败（可忽略）:', err);
  }

  // 注册录音快捷键
  try {
    await register(config.toggleRecording, () => {
      if (handlers.toggleRecording) {
        handlers.toggleRecording();
      }
    });
  } catch (err) {
    log.error(`注册快捷键 ${config.toggleRecording} 失败:`, err);
  }

  // 注册发送快捷键
  try {
    await register(config.sendMessage, () => {
      if (handlers.sendMessage) {
        handlers.sendMessage();
      }
    });
  } catch (err) {
    log.error(`注册快捷键 ${config.sendMessage} 失败:`, err);
  }

  // 注册截图快捷键
  try {
    await register(config.takeScreenshot, () => {
      if (handlers.takeScreenshot) {
        handlers.takeScreenshot();
      }
    });
  } catch (err) {
    log.error(`注册快捷键 ${config.takeScreenshot} 失败:`, err);
  }

  // 注册切换穿透模式快捷键
  if (config.togglePassthrough) {
    try {
      await register(config.togglePassthrough, () => {
        if (handlers.togglePassthrough) {
          handlers.togglePassthrough();
        }
      });
    } catch (err) {
      log.error(`注册快捷键 ${config.togglePassthrough} 失败:`, err);
    }
  }

  // 注册切换紧凑模式快捷键
  if (config.toggleCompactMode) {
    try {
      await register(config.toggleCompactMode, () => {
        if (handlers.toggleCompactMode) {
          handlers.toggleCompactMode();
        }
      });
    } catch (err) {
      log.error(`注册快捷键 ${config.toggleCompactMode} 失败:`, err);
    }
  }

  // 注册紧急隐藏快捷键
  if (config.panicHide) {
    try {
      await register(config.panicHide, () => {
        if (handlers.panicHide) {
          handlers.panicHide();
        }
      });
    } catch (err) {
      log.error(`注册快捷键 ${config.panicHide} 失败:`, err);
    }
  }
}

/**
 * 初始化快捷键
 */
export async function initializeShortcuts(config: ShortcutConfig): Promise<void> {
  await registerAllShortcuts(config);
  currentShortcuts = { ...config };
  isInitialized = true;
}

/**
 * 更新快捷键配置（热更新，立即生效）
 */
export async function updateShortcuts(newConfig: ShortcutConfig): Promise<void> {
  await registerAllShortcuts(newConfig);
  currentShortcuts = { ...newConfig };
}

/**
 * 注销所有快捷键
 */
export async function unregisterAllShortcuts(): Promise<void> {
  try {
    await unregisterAll();
    isInitialized = false;
  } catch (err) {
    log.error('注销所有快捷键失败:', err);
  }
}

/**
 * 获取当前快捷键配置
 */
export function getCurrentShortcuts(): ShortcutConfig {
  return { ...currentShortcuts };
}

/**
 * 检查是否已初始化
 */
export function isShortcutsInitialized(): boolean {
  return isInitialized;
}
