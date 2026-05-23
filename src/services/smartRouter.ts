// 智能路由服务 — pre-flight 探测 + 优先级选择

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, SmartRouteEntry, ProviderType } from '../store/config';

// 路由选择结果
export interface RouteSelection {
  provider: ProviderType;
  model: string;
  entryId: string;
}

// 后端批量健康检查返回
interface CandidateHealthStatus {
  id: string;
  reachable: boolean;
  latencyMs: number | null;
  errorDetail: string | null;
}

// 前端调用参数
interface HealthCheckCandidate {
  id: string;
  providerType: string;
  baseUrl: string | null;
}

// 按优先级分组
function groupByPriority(entries: SmartRouteEntry[]): Map<number, SmartRouteEntry[]> {
  const groups = new Map<number, SmartRouteEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.priority);
    if (list) {
      list.push(entry);
    } else {
      groups.set(entry.priority, [entry]);
    }
  }
  // 按优先级升序排序（1 最高）
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

// 将 SmartRouteEntry 转换为 HealthCheckCandidate
function entriesToCandidates(
  entries: SmartRouteEntry[],
  config: AppConfig,
): HealthCheckCandidate[] {
  return entries
    .filter((entry) => {
      const pc = config.providerConfigs[entry.provider];
      return pc?.apiKey?.trim();
    })
    .map((entry) => {
      const pc = config.providerConfigs[entry.provider];
      return {
        id: entry.id,
        providerType: entry.provider,
        baseUrl: pc.baseUrl?.trim() || null,
      };
    });
}

// 核心选择函数
export async function selectProvider(
  config: AppConfig,
  degradedModels: Set<string>,
): Promise<RouteSelection | null> {
  const { smartRouting } = config;

  // 开关未启用或无候选列表，不干预
  if (!smartRouting.enabled || smartRouting.entries.length === 0) {
    return null;
  }

  const priorityGroups = groupByPriority(smartRouting.entries);

  // 从高优先级到低优先级尝试
  for (const [, entries] of priorityGroups) {
    // 过滤本 session 已降级的模型
    const activeEntries = entries.filter((e) => !degradedModels.has(e.id));
    if (activeEntries.length === 0) continue;

    // 同优先级的候选进行批量探测
    const candidates = entriesToCandidates(activeEntries, config);
    if (candidates.length === 0) continue;

    let statuses: CandidateHealthStatus[];
    try {
      const result = await invoke<{ results: CandidateHealthStatus[] }>(
        'batch_health_check',
        { candidates, timeoutMs: 5000 },
      );
      statuses = result.results;
    } catch {
      // 健康检查本身失败，跳过该优先级组
      continue;
    }

    // 筛选可达且延迟低于阈值的候选
    const viable = statuses
      .filter(
        (s) =>
          s.reachable &&
          s.latencyMs !== null &&
          s.latencyMs <= smartRouting.latencyThreshold,
      )
      .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));

    if (viable.length > 0) {
      const best = viable[0];
      const entry = activeEntries.find((e) => e.id === best.id);
      if (entry) {
        return {
          provider: entry.provider,
          model: entry.model,
          entryId: entry.id,
        };
      }
    }
  }

  // 所有候选都不可用，返回 null 让调用方用 activeProvider 兜底
  return null;
}
