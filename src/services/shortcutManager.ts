// 快捷键管理服务 - 使用 Tauri 全局快捷键插件
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { ShortcutConfig, DEFAULT_SHORTCUT_CONFIG } from '../store/config';

// 快捷键回调函数类型
export type ShortcutCallback = () => void;

// 快捷键处理器映射
interface ShortcutHandlers {
  toggleRecording?: ShortcutCallback;
  sendMessage?: ShortcutCallback;
  takeScreenshot?: ShortcutCallback;
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
  console.log('快捷键处理器已设置:', Object.keys(handlers));
}

/**
 * 注册所有快捷键（先全部注销再重新注册）
 */
async function registerAllShortcuts(config: ShortcutConfig): Promise<void> {
  // 先注销所有，避免 isRegistered hang 问题
  try {
    await unregisterAll();
  } catch (err) {
    console.warn('注销快捷键失败（可忽略）:', err);
  }

  // 检查 handlers 是否已设置
  console.log('当前 handlers 状态:', {
    toggleRecording: !!handlers.toggleRecording,
    sendMessage: !!handlers.sendMessage,
    takeScreenshot: !!handlers.takeScreenshot
  });

  // 注册录音快捷键
  try {
    await register(config.toggleRecording, () => {
      console.log(`快捷键触发: toggleRecording, handler存在: ${!!handlers.toggleRecording}`);
      if (handlers.toggleRecording) {
        handlers.toggleRecording();
      } else {
        console.error('toggleRecording handler 未设置!');
      }
    });
    console.log(`快捷键 ${config.toggleRecording} 注册成功 -> toggleRecording`);
  } catch (err) {
    console.error(`注册快捷键 ${config.toggleRecording} 失败:`, err);
  }

  // 注册发送快捷键
  try {
    await register(config.sendMessage, () => {
      console.log(`快捷键触发: sendMessage, handler存在: ${!!handlers.sendMessage}`);
      if (handlers.sendMessage) {
        handlers.sendMessage();
      } else {
        console.error('sendMessage handler 未设置!');
      }
    });
    console.log(`快捷键 ${config.sendMessage} 注册成功 -> sendMessage`);
  } catch (err) {
    console.error(`注册快捷键 ${config.sendMessage} 失败:`, err);
  }

  // 注册截图快捷键
  try {
    await register(config.takeScreenshot, () => {
      console.log(`快捷键触发: takeScreenshot, handler存在: ${!!handlers.takeScreenshot}`);
      if (handlers.takeScreenshot) {
        handlers.takeScreenshot();
      } else {
        console.error('takeScreenshot handler 未设置!');
      }
    });
    console.log(`快捷键 ${config.takeScreenshot} 注册成功 -> takeScreenshot`);
  } catch (err) {
    console.error(`注册快捷键 ${config.takeScreenshot} 失败:`, err);
  }
}

/**
 * 初始化快捷键
 */
export async function initializeShortcuts(config: ShortcutConfig): Promise<void> {
  console.log('初始化快捷键:', config);
  await registerAllShortcuts(config);
  currentShortcuts = { ...config };
  isInitialized = true;
  console.log('快捷键初始化完成');
}

/**
 * 更新快捷键配置（热更新，立即生效）
 */
export async function updateShortcuts(newConfig: ShortcutConfig): Promise<void> {
  console.log('更新快捷键:', { old: currentShortcuts, new: newConfig });
  await registerAllShortcuts(newConfig);
  currentShortcuts = { ...newConfig };
  console.log('快捷键更新完成');
}

/**
 * 注销所有快捷键
 */
export async function unregisterAllShortcuts(): Promise<void> {
  try {
    await unregisterAll();
    isInitialized = false;
    console.log('所有快捷键已注销');
  } catch (err) {
    console.error('注销所有快捷键失败:', err);
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
