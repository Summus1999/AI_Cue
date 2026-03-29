/**
 * 启动编排器
 * 
 * 统一管理前端启动阶段的顺序，确保：
 * 1. 关键配置只读取一次
 * 2. 启动任务按优先级执行
 * 3. 可观测启动过程
 */

import { 
  loadRuntimeConfigSnapshot, 
  RuntimeConfigSnapshot,
} from './runtimeConfigSnapshot';
import { Session, getLastActiveSession } from '../services/sessionManager';
import { 
  initWindowOpacity, 
  enableHoverRestore, 
  initCompactMode, 
  restoreWindowBounds,
} from '../services/windowManager';
import { 
  initializeShortcuts, 
  setShortcutHandlers,
} from '../services/shortcutManager';
import { 
  perfConfigLoaded,
  perfSessionRestored,
  perfShortcutsReady,
  perfWindowBoundsRestored,
} from '../services/perf/perfInstrumentation';
import { ensureRagRuntimeConfigured } from '../services/ragRuntimeConfig';
import { ragService } from '../services/ragService';

// 启动任务类型
export type BootstrapTask = 
  | 'config_snapshot'
  | 'window_opacity'
  | 'hover_restore'
  | 'compact_mode'
  | 'window_bounds'
  | 'shortcuts'
  | 'session_restore';

// 启动任务优先级（数字越小优先级越高）
const TASK_PRIORITY: Record<BootstrapTask, number> = {
  config_snapshot: 1,      // 必须最先执行
  window_opacity: 2,      // 窗口状态
  hover_restore: 3,        // 窗口状态
  compact_mode: 4,        // 窗口状态
  window_bounds: 5,       // 窗口位置
  shortcuts: 6,           // 快捷键
  session_restore: 7,     // 会话恢复
};

// 启动完成回调
export type BootstrapCallback = (snapshot: RuntimeConfigSnapshot) => void;

// 快捷键处理器类型
export interface ShortcutHandlers {
  toggleRecording?: () => void;
  sendMessage?: () => void;
  takeScreenshot?: () => void;
  togglePassthrough?: () => void;
  toggleCompactMode?: () => void;
}

// 编排器状态
interface BootstrapState {
  snapshot: RuntimeConfigSnapshot | null;
  completedTasks: Set<BootstrapTask>;
  isRunning: boolean;
  callbacks: BootstrapCallback[];
}

const state: BootstrapState = {
  snapshot: null,
  completedTasks: new Set(),
  isRunning: false,
  callbacks: [],
};

/**
 * 注册启动完成回调
 */
export function onBootstrapComplete(callback: BootstrapCallback): () => void {
  state.callbacks.push(callback);
  
  // 如果启动已完成，立即调用
  if (state.snapshot && state.isRunning === false) {
    callback(state.snapshot);
  }
  
  // 返回取消订阅函数
  return () => {
    const index = state.callbacks.indexOf(callback);
    if (index > -1) {
      state.callbacks.splice(index, 1);
    }
  };
}

/**
 * 获取已完成的启动任务列表
 */
export function getCompletedTasks(): BootstrapTask[] {
  return Array.from(state.completedTasks).sort(
    (a, b) => TASK_PRIORITY[a] - TASK_PRIORITY[b]
  );
}

/**
 * 初始化窗口透明度
 */
async function initWindowOpacityFromSnapshot(snapshot: RuntimeConfigSnapshot): Promise<void> {
  if (snapshot.windowOpacity !== 1) {
    await initWindowOpacity(snapshot.windowOpacity);
  }
  state.completedTasks.add('window_opacity');
}

/**
 * 初始化悬停恢复
 */
async function initHoverRestoreFromSnapshot(snapshot: RuntimeConfigSnapshot): Promise<void> {
  if (snapshot.hoverRestoreEnabled) {
    enableHoverRestore(true, snapshot.windowOpacity);
  }
  state.completedTasks.add('hover_restore');
}

/**
 * 初始化紧凑模式
 */
async function initCompactModeFromSnapshot(snapshot: RuntimeConfigSnapshot): Promise<void> {
  if (snapshot.compactModeEnabled) {
    initCompactMode(true);
  }
  state.completedTasks.add('compact_mode');
}

/**
 * 恢复窗口位置
 */
async function restoreWindowBoundsFromSnapshot(snapshot: RuntimeConfigSnapshot): Promise<void> {
  const mode = snapshot.compactModeEnabled ? 'compact' : 'main';
  await restoreWindowBounds(mode);
  perfWindowBoundsRestored({ mode });
  state.completedTasks.add('window_bounds');
}

/**
 * 初始化快捷键
 */
async function initializeShortcutsFromSnapshot(
  snapshot: RuntimeConfigSnapshot,
  handlers: ShortcutHandlers
): Promise<void> {
  setShortcutHandlers(handlers);
  await initializeShortcuts(snapshot.shortcutConfig);
  perfShortcutsReady();
  state.completedTasks.add('shortcuts');
}

/**
 * 恢复会话
 */
async function restoreSessionFromSnapshot(snapshot: RuntimeConfigSnapshot): Promise<Session | null> {
  const lastSession = await getLastActiveSession(snapshot.promptMode);
  if (lastSession) {
    perfSessionRestored({ sessionId: lastSession.id });
  }
  state.completedTasks.add('session_restore');
  return lastSession;
}

interface RagStartupRecoveryService {
  recoverStuckKnowledgeDocuments: () => Promise<{ fileName: string }[]>;
}

export async function recoverInterruptedKnowledgeIndexingOnStartup(
  snapshot: RuntimeConfigSnapshot,
  service: RagStartupRecoveryService = ragService,
): Promise<void> {
  if (snapshot.config.rag.autoReindexPolicy !== 'on_startup') {
    return;
  }

  try {
    const recoveredDocuments = await service.recoverStuckKnowledgeDocuments();
    if (recoveredDocuments.length === 0) {
      return;
    }

    console.info(
      `[Bootstrap] 已恢复 ${recoveredDocuments.length} 个上次中断的知识库索引任务`,
      recoveredDocuments.map((document) => document.fileName),
    );
  } catch (err) {
    console.warn('[Bootstrap] 恢复中断的知识库索引任务失败:', err);
  }
}

/**
 * 启动编排主函数
 * 
 * @param shortcutHandlers 快捷键处理器
 * @returns 包含快照和会话信息的对象
 */
export async function bootstrap(
  shortcutHandlers: ShortcutHandlers
): Promise<{
  snapshot: RuntimeConfigSnapshot;
  lastSession: Session | null;
}> {
  if (state.isRunning) {
    // 等待启动完成
    while (state.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (state.snapshot) {
      return {
        snapshot: state.snapshot,
        lastSession: (await getLastActiveSession(state.snapshot.promptMode)) ?? null,
      };
    }
  }

  state.isRunning = true;

  try {
    // 1. 加载配置快照（最高优先级）
    const snapshot = await loadRuntimeConfigSnapshot();
    perfConfigLoaded({ source: 'bootstrap' });
    state.snapshot = snapshot;
    state.completedTasks.add('config_snapshot');

    // 1.5 启动阶段同步 RAG Embedding Provider 到后端运行时
    await ensureRagRuntimeConfigured(snapshot.config, 'startup');
    await recoverInterruptedKnowledgeIndexingOnStartup(snapshot);

    // 2. 并行执行窗口状态初始化
    await Promise.all([
      initWindowOpacityFromSnapshot(snapshot),
      initHoverRestoreFromSnapshot(snapshot),
      initCompactModeFromSnapshot(snapshot),
    ]);

    // 3. 恢复窗口位置
    await restoreWindowBoundsFromSnapshot(snapshot);

    // 4. 初始化快捷键
    await initializeShortcutsFromSnapshot(snapshot, shortcutHandlers);

    // 5. 恢复会话（异步，不阻塞）
    const lastSessionPromise = restoreSessionFromSnapshot(snapshot);

    // 6. 通知所有回调
    for (const callback of state.callbacks) {
      try {
        callback(snapshot);
      } catch (err) {
        console.error('[Bootstrap] 启动完成回调执行失败:', err);
      }
    }

    // 7. 等待会话恢复
    const lastSession = await lastSessionPromise;

    return { snapshot, lastSession };
  } finally {
    state.isRunning = false;
  }
}

/**
 * 获取当前启动状态
 */
export function getBootstrapState(): {
  isRunning: boolean;
  snapshotLoaded: boolean;
  completedTasks: BootstrapTask[];
} {
  return {
    isRunning: state.isRunning,
    snapshotLoaded: state.snapshot !== null,
    completedTasks: getCompletedTasks(),
  };
}
