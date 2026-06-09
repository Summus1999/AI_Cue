/**
 * 网络状态指示灯组件
 * 显示实时网络连接状态（绿/黄/红/脉冲动画）
 * 集成智能路由降级通知（toast + tooltip 历史）
 */

import { useState, useEffect, useRef } from 'react';
import { networkMonitor, NetworkStatus } from '../services/networkMonitor';
import { useNetworkResilience } from '../store/networkResilience';

interface Props {
  className?: string;
}

const REASON_LABELS: Record<string, string> = {
  unreachable: '不可达',
  high_latency: '延迟过高',
  health_failed: '健康检查失败',
  all_degraded: '全部不可用',
};

export function NetworkStatusIndicator({ className }: Props) {
  const [status, setStatus] = useState<NetworkStatus>(networkMonitor.getStatus());
  const [showTooltip, setShowTooltip] = useState(false);
  const [showDegradationHistory, setShowDegradationHistory] = useState(false);
  const [toastEvent, setToastEvent] = useState<import('../store/networkResilience').DegradationEvent | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const lastUnreadDegradation = useNetworkResilience((s) => s.lastUnreadDegradation);
  const degradationEvents = useNetworkResilience((s) => s.degradationEvents);
  const markDegradationRead = useNetworkResilience((s) => s.markDegradationRead);

  // 新降级事件 → 弹出 toast，3 秒自动消除
  useEffect(() => {
    if (!lastUnreadDegradation) return;
    setToastEvent(lastUnreadDegradation);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastEvent(null);
      markDegradationRead();
    }, 3000);
  }, [lastUnreadDegradation, markDegradationRead]);

  // 网络监控生命周期
  useEffect(() => {
    const unsubscribe = networkMonitor.onStatusChange(setStatus);
    networkMonitor.startMonitoring();
    return () => {
      unsubscribe();
      networkMonitor.stopMonitoring();
      clearTimeout(toastTimer.current);
    };
  }, []);

  const dismissToast = () => {
    clearTimeout(toastTimer.current);
    setToastEvent(null);
    markDegradationRead();
  };

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

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* 降级 Toast */}
      {toastEvent && (
        <div className="fixed bottom-4 right-4 z-[100] animate-slide-up">
          <div className="bg-amber-900/95 backdrop-blur text-amber-50 rounded-xl px-4 py-3 shadow-2xl border border-amber-600/50 max-w-sm">
            {/* 标题行 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-400 text-base">&#9888;</span>
              <span className="font-semibold text-sm">智能路由降级</span>
            </div>

            {/* 路由信息 */}
            <div className="text-xs space-y-1 mb-2">
              <div className="text-amber-300">
                首选
                <span className="text-amber-100 font-medium mx-1">
                  {toastEvent.intendedModel}
                </span>
                {REASON_LABELS[toastEvent.reason] || '不可用'}
              </div>
              <div className="text-amber-300">
                已切换至
                <span className="text-emerald-300 font-medium mx-1">
                  {toastEvent.actualModel || toastEvent.actualProvider}
                </span>
              </div>
            </div>

            {/* 跳过的候选 */}
            {toastEvent.skippedCandidates.length > 0 && (
              <div className="text-[10px] text-amber-500/80 mb-2 truncate">
                跳过:{' '}
                {toastEvent.skippedCandidates.slice(0, 3).map((c, i) => (
                  <span key={i}>
                    {i > 0 && ' '}
                    {c.model}({REASON_LABELS[c.reason] || c.reason})
                  </span>
                ))}
                {toastEvent.skippedCandidates.length > 3 && ' ...'}
              </div>
            )}

            {/* 按钮行 */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={dismissToast}
                className="text-xs text-amber-400 hover:text-amber-200 transition-colors px-2 py-0.5"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 指示灯本体 */}
      <div
        className={`relative ${className}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => {
          setShowTooltip(false);
          setShowDegradationHistory(false);
        }}
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

              {/* 降级历史折叠区 */}
              {degradationEvents.length > 0 && (
                <>
                  <div className="border-t border-amber-700/50 my-2" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDegradationHistory(!showDegradationHistory);
                    }}
                    className="flex items-center gap-1 text-amber-400 hover:text-amber-200 transition-colors w-full text-left"
                  >
                    <span className="text-[10px]">
                      {showDegradationHistory ? '▲' : '▼'}
                    </span>
                    <span className="text-[10px]">
                      本次会话路由降级 ({degradationEvents.length}次)
                    </span>
                  </button>

                  {showDegradationHistory && (
                    <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                      {degradationEvents.slice(0, 10).map((evt) => (
                        <div key={evt.id} className="text-[10px] text-amber-400/80 flex items-start gap-1">
                          <span className="text-amber-500 flex-shrink-0">{formatTime(evt.timestamp)}</span>
                          <span className="truncate">
                            {evt.intendedModel}
                            <span className="text-amber-600 mx-0.5">&rarr;</span>
                            {evt.actualModel || evt.actualProvider}
                          </span>
                        </div>
                      ))}
                      {degradationEvents.length > 10 && (
                        <div className="text-[10px] text-amber-600">
                          ...及其他 {degradationEvents.length - 10} 条
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* 小三角 */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-amber-900 border-l border-t border-amber-700 rotate-45" />
          </div>
        )}
      </div>
    </>
  );
}
