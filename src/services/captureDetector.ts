// 屏幕捕获自动检测服务
// 定时轮询检测会议软件进程，自动触发隐身模式

import { invoke } from '@tauri-apps/api/core';

const POLL_INTERVAL = 3000; // 3秒轮询

let isCapturing = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let autoStealthEnabled = true;
let onChangeCallbacks: Array<(capturing: boolean) => void> = [];

// 用户手动控制的隐身状态（用于"自动恢复"判断）
let manualStealthOverride = false;

export async function checkCaptureStatus(): Promise<boolean> {
  try {
    const processes = await invoke<string[]>('check_capture_status');
    return processes.length > 0;
  } catch {
    return false;
  }
}

export function isCurrentlyCapturing(): boolean {
  return isCapturing;
}

export function startAutoDetection(): void {
  if (pollTimer) return;
  // 立即执行一次
  void checkCaptureStatus().then((capturing) => {
    if (capturing !== isCapturing) {
      isCapturing = capturing;
      onChangeCallbacks.forEach(cb => cb(capturing));
    }
  });
  pollTimer = setInterval(async () => {
    if (!autoStealthEnabled) return;
    try {
      const capturing = await checkCaptureStatus();
      if (capturing !== isCapturing) {
        isCapturing = capturing;
        onChangeCallbacks.forEach(cb => cb(capturing));
      }
    } catch { /* 静默失败 */ }
  }, POLL_INTERVAL);
}

export function stopAutoDetection(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function onCaptureChange(cb: (capturing: boolean) => void): () => void {
  onChangeCallbacks.push(cb);
  return () => {
    onChangeCallbacks = onChangeCallbacks.filter(c => c !== cb);
  };
}

export function setAutoStealthEnabled(enabled: boolean): void {
  autoStealthEnabled = enabled;
}

export function isAutoStealthEnabled(): boolean {
  return autoStealthEnabled;
}

export function setManualStealthOverride(value: boolean): void {
  manualStealthOverride = value;
}

export function isManualStealthOverride(): boolean {
  return manualStealthOverride;
}
