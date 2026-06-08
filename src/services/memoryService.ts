// 个人面试记忆管理服务 - 前端 CRUD 与维护入口

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// ==================== 类型定义 ====================

/** 记忆类型 */
export type MemoryType = 'episodic' | 'semantic' | 'profile' | 'procedural';

/** 记忆来源 */
export type MemorySourceType = 'assistant_chat' | 'explicit' | 'manual_review';

/** 记忆状态 */
export type MemoryStatus = 'active' | 'archived';

/** 单条记忆记录（对应后端 MemoryRecord） */
export interface MemoryRecord {
  id: string;
  memoryType: MemoryType;
  sourceType: MemorySourceType;
  content: string;
  structuredJson: Record<string, unknown>;
  importance: number;
  embeddingModelId: string | null;
  sourceSessionId: string | null;
  occurrenceCount: number;
  decayScore: number;
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastRetrievedAt: number | null;
}

/** 记忆更新输入 */
export interface UpdateMemoryInput {
  content?: string;
  structuredJson?: Record<string, unknown>;
  importance?: number;
  decayScore?: number;
  status?: MemoryStatus;
  lastRetrievedAt?: number | null;
}

/** 记忆维护请求（对应后端 MemoryMaintenanceRequest） */
export interface MemoryMaintenanceRequest {
  provider: string;
  config: { apiKey: string; baseUrl: string | null };
  model: string;
  embeddingConfig: {
    provider: string;
    apiKey: string;
    baseUrl: string | null;
    model: string | null;
  };
  reflectionThreshold?: number;
  decayImportanceMax?: number;
  decayDaysThreshold?: number;
  similarityThreshold?: number;
}

/** 记忆维护结果摘要 */
export interface MemoryMaintenanceSummary {
  decayedCount: number;
  reflectionTriggered: boolean;
  reflectionProfileCount: number;
  activeSourceCount: number;
}

// ==================== 类型标签映射 ====================

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  episodic: '情景记忆',
  semantic: '语义记忆',
  profile: '画像记忆',
  procedural: '程序记忆',
};

const SOURCE_TYPE_LABELS: Record<MemorySourceType, string> = {
  assistant_chat: '助手对话',
  explicit: '显式指令',
  manual_review: '复盘录入',
};

const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  episodic: 'bg-blue-100 text-blue-700',
  semantic: 'bg-emerald-100 text-emerald-700',
  profile: 'bg-amber-100 text-amber-700',
  procedural: 'bg-purple-100 text-purple-700',
};

export function getMemoryTypeLabel(type: MemoryType): string {
  return MEMORY_TYPE_LABELS[type] ?? type;
}

export function getSourceTypeLabel(source: MemorySourceType): string {
  return SOURCE_TYPE_LABELS[source] ?? source;
}

export function getMemoryTypeColor(type: MemoryType): string {
  return MEMORY_TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700';
}

// ==================== API 调用 ====================

/** 列出全部记忆（status 为 null 时不过滤） */
export async function listMemories(status?: MemoryStatus | null): Promise<MemoryRecord[]> {
  return tauriInvoke<MemoryRecord[]>('memory_list', {
    status: status ?? null,
  });
}

/** 获取单条记忆详情 */
export async function getMemory(memoryId: string): Promise<MemoryRecord | null> {
  return tauriInvoke<MemoryRecord | null>('memory_get', { memoryId });
}

/** 更新记忆 */
export async function updateMemory(
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<MemoryRecord> {
  return tauriInvoke<MemoryRecord>('memory_update', { memoryId, input });
}

/** 删除记忆 */
export async function deleteMemory(memoryId: string): Promise<void> {
  return tauriInvoke('memory_delete', { memoryId });
}

/** 执行记忆维护（衰减 + 条件反思） */
export async function runMemoryMaintenance(
  request: MemoryMaintenanceRequest,
): Promise<MemoryMaintenanceSummary> {
  return tauriInvoke<MemoryMaintenanceSummary>('memory_run_maintenance', { request });
}
