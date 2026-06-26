// 智能路由服务 — pre-flight 探测 + 优先级选择

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, SmartRouteEntry, ProviderType } from '../store/config';
import { PROVIDERS } from '../store/config';
import type { SkippedCandidate, DegradationReason } from '../store/networkResilience';

// 路由选择结果
export interface RouteSelection {
  provider: ProviderType;
  model: string;
  entryId: string;
  /** 降级详情：哪些候选被跳过以及原因 */
  skippedCandidates?: SkippedCandidate[];
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
      // 优先用户自定义 URL，否则使用 Provider 默认 Base URL（与 API 请求同源）
      let baseUrl = pc.baseUrl?.trim() || null;
      if (!baseUrl) {
        const meta = PROVIDERS.find((x) => x.id === entry.provider);
        baseUrl = meta?.defaultBaseUrl || null;
      }
      return {
        id: entry.id,
        providerType: entry.provider,
        baseUrl,
      };
    });
}

// 核心选择函数
export async function selectProvider(
  config: AppConfig,
  degradedModels: Set<string>,
): Promise<RouteSelection | null> {
  const { smartRouting } = config;

  if (!smartRouting.enabled || smartRouting.entries.length === 0) {
    return null;
  }

  // 仅有一个可用候选时无需 pre-flight 探测：探测只会徒增首字延迟，
  // 且单 provider 场景下即使探测失败也无备选可切换。直接选中该候选。
  const availableEntries = smartRouting.entries.filter(
    (e) => !degradedModels.has(e.id) && config.providerConfigs[e.provider]?.apiKey?.trim(),
  );
  if (availableEntries.length <= 1) {
    if (availableEntries.length === 0) {
      return null;
    }
    const entry = availableEntries[0];
    return {
      provider: entry.provider,
      model: entry.model,
      entryId: entry.id,
      skippedCandidates: undefined,
    };
  }

  const priorityGroups = groupByPriority(smartRouting.entries);
  const allSkipped: SkippedCandidate[] = [];

  const addSkipped = (e: SmartRouteEntry, reason: DegradationReason, latencyMs?: number | null) => {
    allSkipped.push({ provider: e.provider, model: e.model, reason, latencyMs: latencyMs ?? null });
  };

  for (const [, entries] of priorityGroups) {
    // 本组中 session 已降级的直接记入跳过
    const activeEntries: SmartRouteEntry[] = [];
    for (const e of entries) {
      if (degradedModels.has(e.id)) {
        addSkipped(e, 'unreachable');
      } else {
        activeEntries.push(e);
      }
    }
    if (activeEntries.length === 0) continue;

    const candidates = entriesToCandidates(activeEntries, config);
    if (candidates.length === 0) continue;

    // 构建 id → entry 映射，避免后续重复 find
    const entryById = new Map(activeEntries.map((e) => [e.id, e]));

    let statuses: CandidateHealthStatus[];
    try {
      const result = await invoke<{ results: CandidateHealthStatus[] }>(
        'batch_health_check',
        { candidates, timeoutMs: 5000 },
      );
      statuses = result.results;
    } catch {
      for (const e of activeEntries) addSkipped(e, 'health_failed');
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

    // 记录不可达或延迟过高的候选
    for (const s of statuses) {
      if (viable.some((v) => v.id === s.id)) continue;
      const entry = entryById.get(s.id);
      if (!entry) continue;
      addSkipped(entry, s.reachable ? 'high_latency' : 'unreachable', s.latencyMs);
    }

    if (viable.length > 0) {
      const entry = entryById.get(viable[0].id);
      if (entry) {
        return {
          provider: entry.provider,
          model: entry.model,
          entryId: entry.id,
          skippedCandidates: allSkipped.length > 0 ? allSkipped : undefined,
        };
      }
    }
  }

  return null;
}

/**
 * 获取最高优先级首选条目（排除 session 已降级且已配置 API Key 者）
 */
export function getTopPriorityEntry(
  entries: SmartRouteEntry[],
  degradedModels: Set<string>,
  configuredProviders: Set<string>,
): SmartRouteEntry | null {
  // 直接遍历找最小 priority，无需完整排序
  let best: SmartRouteEntry | null = null;
  for (const e of entries) {
    if (degradedModels.has(e.id) || !configuredProviders.has(e.provider)) continue;
    if (!best || e.priority < best.priority) best = e;
  }
  return best;
}
