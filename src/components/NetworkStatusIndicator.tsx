/**
 * 网络状态指示灯组件
 * 显示实时网络连接状态（绿/黄/红/脉冲动画）
 */

import { useState, useEffect } from 'react';
import { networkMonitor, NetworkStatus } from '../services/networkMonitor';

interface Props {
  className?: string;
}

/**
 * 网络状态指示灯
 * - 绿色：一切正常（connected）
 * - 琥珀色：网络连通但 AI 服务不可达（degraded）
 * - 红色：无网络连接（disconnected）
 * - 脉冲动画：检测中（checking）
 */
export function NetworkStatusIndicator({ className }: Props) {
  const [status, setStatus] = useState<NetworkStatus>(networkMonitor.getStatus());
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const unsubscribe = networkMonitor.onStatusChange(setStatus);
    networkMonitor.startMonitoring();

    return () => {
      unsubscribe();
      networkMonitor.stopMonitoring();
    };
  }, []);

  // 颜色方案（与咖啡色主题协调）
  const colors = {
    connected: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    disconnected: 'bg-red-500',
    checking: 'bg-amber-400 animate-pulse',
  };

  const labels: Record<NetworkStatus['state'], string> = {
    connected: '网络正常',
    degraded: 'AI 服务不可用',
    disconnected: '网络已断开',
    checking: '检测中...',
  };

  // 点击刷新
  const handleClick = () => {
    networkMonitor.checkNow();
  };

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* 指示灯 */}
      <div
        className={`w-2 h-2 rounded-full ${colors[status.state]} cursor-pointer transition-colors duration-300`}
        onClick={handleClick}
        title="点击刷新"
      />

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
          <div className="bg-amber-900 text-amber-50 text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap border border-amber-700">
            <div className="font-medium">{labels[status.state]}</div>
            {status.latencyMs !== null && (
              <div className="text-amber-200 mt-1">延迟: {status.latencyMs}ms</div>
            )}
            <div className="text-amber-300 mt-1">
              上次检测: {status.lastCheck.toLocaleTimeString()}
            </div>
            {status.errorDetail && (
              <div className="text-red-300 mt-1 max-w-48 truncate">
                {status.errorDetail}
              </div>
            )}
          </div>
          {/* 小三角 */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-amber-900 border-l border-t border-amber-700 rotate-45" />
        </div>
      )}
    </div>
  );
}
