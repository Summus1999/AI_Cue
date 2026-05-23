import type { ReactNode } from 'react';
import { loadConfig } from '../store/config';
import type { FeatureGates } from '../store/config';
import { useState, useEffect } from 'react';

type FeatureKey = keyof FeatureGates;

interface FeatureGateProps {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
  /** 同步提供开关状态以消除异步闪烁 */
  enabled?: boolean;
}

/**
 * 功能开关包装组件
 *
 * 使用方式：
 *   <FeatureGate feature="rag" enabled={featureGates.rag}>
 *     <button>打开知识库</button>
 *   </FeatureGate>
 *
 * 工作原理：
 *   1. 优先使用父组件通过 enabled prop 同步传入的状态（无闪烁）
 *   2. 若未传 enabled，则异步从 config 加载（适合非首屏组件）
 *   3. 开关关闭时返回 fallback（默认 null，即隐藏内容）
 *
 * 核心功能（基础聊天、模型配置）不经过此开关，始终可用。
 * 需要受控的功能入口：知识库、训练计划、导出、语音、截图、模板选择器。
 */
export function FeatureGate({ feature, children, fallback = null, enabled: syncEnabled }: FeatureGateProps) {
  const [asyncEnabled, setAsyncEnabled] = useState(true);

  useEffect(() => {
    if (syncEnabled !== undefined) {
      return;
    }

    let cancelled = false;

    loadConfig()
      .then((config) => {
        if (!cancelled) {
          setAsyncEnabled(config.featureGates[feature] ?? true);
        }
      })
      .catch(() => {
        if (!cancelled) setAsyncEnabled(true);
      });

    return () => {
      cancelled = true;
    };
  }, [feature, syncEnabled]);

  const enabled = syncEnabled ?? asyncEnabled;

  if (!enabled) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * 获取某个功能开关的当前状态（用于命令式判断）
 */
export async function isFeatureEnabled(feature: FeatureKey): Promise<boolean> {
  try {
    const config = await loadConfig();
    return config.featureGates[feature] ?? true;
  } catch {
    return true;
  }
}

export default FeatureGate;
