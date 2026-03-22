/**
 * 性能埋点服务
 * 
 * 统一的前端性能埋点基础设施，用于记录启动链路、截图链路等关键时间点。
 * 遵循低噪声设计原则，默认仅在开发环境输出详细日志。
 */

// 埋点事件枚举 - 统一命名
export type PerfEvent =
  // 应用启动链路
  | 'app_bootstrap_start'
  | 'config_loaded'
  | 'core_ui_ready'
  | 'session_restored'
  | 'shortcuts_ready'
  | 'window_bounds_restored'
  // 截图链路
  | 'screenshot_click'
  | 'screenshot_capture_done'
  | 'screenshot_window_created'
  | 'screenshot_image_ready'
  | 'screenshot_interactive'
  | 'screenshot_crop_done'
  | 'screenshot_complete'
  | 'screenshot_cancelled'
  | 'screenshot_error'
  // 应用关闭
  | 'app_shutdown';

// 埋点数据结构
interface PerfRecord {
  event: PerfEvent;
  timestamp: number;
  duration?: number; // 毫秒，从上一个锚点事件开始的耗时
  metadata?: Record<string, unknown>;
}

// 环境判断
const isDevelopment = import.meta.env.DEV;

// 存储所有埋点记录（内存中）
const perfRecords: PerfRecord[] = [];

// 上一个锚点事件的时间戳（用于计算duration）
let lastAnchorTimestamp: number | null = null;

// 锚点事件列表（用于计算duration）
const anchorEvents: PerfEvent[] = [
  'app_bootstrap_start',
  'screenshot_click',
];

function isAnchorEvent(event: PerfEvent): boolean {
  return anchorEvents.includes(event);
}

/**
 * 记录性能埋点
 * @param event 事件名称
 * @param metadata 额外元数据
 */
export function recordPerf(event: PerfEvent, metadata?: Record<string, unknown>): void {
  const timestamp = performance.now();
  const record: PerfRecord = {
    event,
    timestamp,
    metadata,
  };

  // 如果是锚点事件，计算duration
  if (isAnchorEvent(event)) {
    if (lastAnchorTimestamp !== null) {
      record.duration = timestamp - lastAnchorTimestamp;
    }
    lastAnchorTimestamp = timestamp;
  }

  perfRecords.push(record);

  // 开发环境输出详细日志
  if (isDevelopment) {
    const durationStr = record.duration !== undefined 
      ? ` [${record.duration.toFixed(2)}ms]` 
      : '';
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.debug(`[PERF] ${event}${durationStr}${metaStr}`);
  }
}

/**
 * 获取所有埋点记录
 */
export function getPerfRecords(): PerfRecord[] {
  return [...perfRecords];
}

/**
 * 获取指定事件的耗时
 */
export function getEventDuration(event: PerfEvent): number | undefined {
  const record = perfRecords.find(r => r.event === event);
  return record?.duration;
}

/**
 * 获取两个事件之间的时间差
 */
export function getIntervalDuration(
  startEvent: PerfEvent, 
  endEvent: PerfEvent
): number | undefined {
  const start = perfRecords.find(r => r.event === startEvent);
  const end = perfRecords.find(r => r.event === endEvent);
  
  if (start && end) {
    return end.timestamp - start.timestamp;
  }
  return undefined;
}

/**
 * 清除所有埋点记录
 */
export function clearPerfRecords(): void {
  perfRecords.length = 0;
  lastAnchorTimestamp = null;
}

/**
 * 导出埋点数据用于调试
 */
export function exportPerfData(): {
  records: PerfRecord[];
  summary: Record<string, { count: number; avgDuration?: number }>;
} {
  const summary: Record<string, { count: number; avgDuration?: number }> = {};
  
  for (const record of perfRecords) {
    if (!summary[record.event]) {
      summary[record.event] = { count: 0 };
    }
    summary[record.event].count++;
    
    if (record.duration !== undefined) {
      if (summary[record.event].avgDuration === undefined) {
        summary[record.event].avgDuration = record.duration;
      } else {
        // 简单移动平均
        summary[record.event].avgDuration = 
          (summary[record.event].avgDuration! * (summary[record.event].count - 1) + record.duration) 
          / summary[record.event].count;
      }
    }
  }
  
  return { records: perfRecords, summary };
}

// ============ 便捷的埋点辅助函数 ============

/**
 * 截图链路埋点：记录截图开始
 */
export function perfScreenshotStart(): void {
  recordPerf('screenshot_click');
}

/**
 * 截图链路埋点：记录截图完成
 */
export function perfScreenshotCaptureDone(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_capture_done', metadata);
}

/**
 * 截图链路埋点：记录截图窗口创建
 */
export function perfScreenshotWindowCreated(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_window_created', metadata);
}

/**
 * 截图链路埋点：记录图片加载完成
 */
export function perfScreenshotImageReady(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_image_ready', metadata);
}

/**
 * 截图链路埋点：记录截图可交互
 */
export function perfScreenshotInteractive(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_interactive', metadata);
}

/**
 * 截图链路埋点：记录截图裁剪完成
 */
export function perfScreenshotCropDone(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_crop_done', metadata);
}

/**
 * 截图链路埋点：记录截图完成
 */
export function perfScreenshotComplete(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_complete', metadata);
}

/**
 * 截图链路埋点：记录截图取消
 */
export function perfScreenshotCancelled(metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_cancelled', metadata);
}

/**
 * 截图链路埋点：记录截图错误
 */
export function perfScreenshotError(error: string, metadata?: Record<string, unknown>): void {
  recordPerf('screenshot_error', { error, ...metadata });
}

/**
 * 启动链路埋点：记录应用启动开始
 */
export function perfAppBootstrapStart(metadata?: Record<string, unknown>): void {
  recordPerf('app_bootstrap_start', metadata);
}

/**
 * 启动链路埋点：记录配置加载完成
 */
export function perfConfigLoaded(metadata?: Record<string, unknown>): void {
  recordPerf('config_loaded', metadata);
}

/**
 * 启动链路埋点：记录核心UI就绪
 */
export function perfCoreUiReady(metadata?: Record<string, unknown>): void {
  recordPerf('core_ui_ready', metadata);
}

/**
 * 启动链路埋点：记录会话恢复完成
 */
export function perfSessionRestored(metadata?: Record<string, unknown>): void {
  recordPerf('session_restored', metadata);
}

/**
 * 启动链路埋点：记录快捷键就绪
 */
export function perfShortcutsReady(metadata?: Record<string, unknown>): void {
  recordPerf('shortcuts_ready', metadata);
}

/**
 * 启动链路埋点：记录窗口位置恢复完成
 */
export function perfWindowBoundsRestored(metadata?: Record<string, unknown>): void {
  recordPerf('window_bounds_restored', metadata);
}
