/**
 * 网络韧性状态管理
 * 统一管理网络状态、错误、重试状态和未完成消息
 */

import { create } from 'zustand';
import { NetworkStatus } from '../services/networkMonitor';
import { FriendlyError } from '../services/errorClassifier';
import { RetryState } from '../services/retryStrategy';

// ==================== 降级事件类型 ====================

export type DegradationReason =
  | 'unreachable'    // 网络不可达
  | 'high_latency'   // 延迟超过阈值
  | 'health_failed'  // 健康检查本身失败
  | 'all_degraded';  // 所有候选都不可用，回退到 activeProvider

export interface SkippedCandidate {
  provider: string;
  model: string;
  reason: DegradationReason;
  latencyMs?: number | null;
}

export interface DegradationEvent {
  /** 事件唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 原本期望的 provider（最高优先级未降级者） */
  intendedProvider: string;
  /** 原本期望的 model */
  intendedModel: string;
  /** 实际使用的 provider */
  actualProvider: string;
  /** 实际使用的 model */
  actualModel: string;
  /** 降级原因 */
  reason: DegradationReason;
  /** 被跳过的候选列表（按优先级排序） */
  skippedCandidates: SkippedCandidate[];
}

interface NetworkResilienceState {
  // ========== 网络状态 ==========
  networkStatus: NetworkStatus;
  setNetworkStatus: (status: NetworkStatus) => void;

  // ========== 活跃的错误（使用 Record 替代 Map，符合项目现有风格） ==========
  activeErrors: Record<string, FriendlyError>;
  setError: (id: string, error: FriendlyError) => void;
  clearError: (id: string) => void;
  clearAllErrors: () => void;

  // ========== 重试状态 ==========
  retryStates: Record<string, RetryState>;
  setRetryState: (id: string, state: RetryState) => void;
  clearRetryState: (id: string) => void;

  // ========== 未完成消息 ==========
  incompleteMessages: string[]; // 使用数组代替 Set，Zustand 可以正确追踪
  markIncomplete: (messageId: string) => void;
  markComplete: (messageId: string) => void;
  isIncomplete: (messageId: string) => boolean;

  // ========== 等待状态（用于显示 AI 响应等待计时） ==========
  waitingMessageId: string | null;
  waitingStartTime: number | null;
  setWaiting: (messageId: string | null) => void;
  getWaitingSeconds: () => number;

  // ========== 降级通知 ==========
  /** 降级历史（当前会话，最多保留 20 条） */
  degradationEvents: DegradationEvent[];
  addDegradationEvent: (event: DegradationEvent) => void;
  clearDegradationHistory: () => void;

  /** 最新一条未读降级事件（用于 toast 触发） */
  lastUnreadDegradation: DegradationEvent | null;
  markDegradationRead: () => void;
}

/**
 * 网络韧性状态 Store
 * 集中管理所有与网络韧性相关的状态
 */
export const useNetworkResilience = create<NetworkResilienceState>((set, get) => ({
  // ========== 初始网络状态 ==========
  networkStatus: {
    state: 'checking',
    internetConnected: true,
    providerReachable: true,
    latencyMs: null,
    lastCheck: new Date(),
    errorDetail: null,
  },
  setNetworkStatus: (status) => set({ networkStatus: status }),

  // ========== 错误管理 ==========
  activeErrors: {},
  setError: (id, error) => set((state) => ({
    activeErrors: { ...state.activeErrors, [id]: error },
  })),
  clearError: (id) => set((state) => {
    const { [id]: _, ...rest } = state.activeErrors;
    return { activeErrors: rest };
  }),
  clearAllErrors: () => set({ activeErrors: {} }),

  // ========== 重试状态管理 ==========
  retryStates: {},
  setRetryState: (id, retryState) => set((state) => ({
    retryStates: { ...state.retryStates, [id]: retryState },
  })),
  clearRetryState: (id) => set((state) => {
    const { [id]: _, ...rest } = state.retryStates;
    return { retryStates: rest };
  }),

  // ========== 未完成消息管理 ==========
  incompleteMessages: [],
  markIncomplete: (messageId) => set((state) => ({
    incompleteMessages: state.incompleteMessages.includes(messageId)
      ? state.incompleteMessages
      : [...state.incompleteMessages, messageId],
  })),
  markComplete: (messageId) => set((state) => ({
    incompleteMessages: state.incompleteMessages.filter(id => id !== messageId),
  })),
  isIncomplete: (messageId) => get().incompleteMessages.includes(messageId),

  // ========== 等待状态管理 ==========
  waitingMessageId: null,
  waitingStartTime: null,
  setWaiting: (messageId) => set({
    waitingMessageId: messageId,
    waitingStartTime: messageId ? Date.now() : null,
  }),
  getWaitingSeconds: () => {
    const { waitingStartTime } = get();
    if (!waitingStartTime) return 0;
    return Math.floor((Date.now() - waitingStartTime) / 1000);
  },

  // ========== 降级通知 ==========
  degradationEvents: [],
  addDegradationEvent: (event) => set((state) => ({
    degradationEvents: [event, ...state.degradationEvents].slice(0, 20),
    lastUnreadDegradation: event,
  })),
  clearDegradationHistory: () => set({ degradationEvents: [], lastUnreadDegradation: null }),
  lastUnreadDegradation: null,
  markDegradationRead: () => set({ lastUnreadDegradation: null }),
}));

/**
 * 获取等待提示文本
 * 根据等待时间返回不同的提示信息
 */
export function getWaitingHint(seconds: number): string {
  if (seconds < 10) return '';
  if (seconds < 30) return 'AI 正在深度思考...';
  if (seconds < 60) return '响应时间较长，请耐心等待...';
  return '响应时间异常，可能遇到问题...';
}
