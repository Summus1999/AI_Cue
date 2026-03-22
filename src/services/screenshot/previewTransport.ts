/**
 * 截图预览传输模块
 * 
 * 实现截图预览数据的内存优先传输：
 * - 分辨率 ≤ 2560x1440：使用 Base64 内存传输
 * - 分辨率 > 2560x1440：回退到磁盘链路
 */

import { invoke } from '@tauri-apps/api/core';

// 预览传输类型
export type PreviewTransportType = 'memory' | 'disk';

// 预览数据结构（Tauri 会将 Rust 的 snake_case 转为 camelCase）
export interface PreviewData {
  captureId: string;
  logicalWidth: number;
  logicalHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  transportType: PreviewTransportType;  // "memory" 或 "disk"
  payloadRef: string;    // 内存传输：Base64；磁盘传输：文件路径
}

// 分辨率阈值：超过此值使用磁盘传输
const MEMORY_THRESHOLD_WIDTH = 2560;
const MEMORY_THRESHOLD_HEIGHT = 1440;

/**
 * 判断是否应使用内存传输
 */
export function shouldUseMemoryTransport(width: number, height: number): boolean {
  return width <= MEMORY_THRESHOLD_WIDTH && height <= MEMORY_THRESHOLD_HEIGHT;
}

/**
 * 执行截图并返回预览数据
 */
export async function captureWithPreview(): Promise<PreviewData> {
  return invoke<PreviewData>('capture_with_preview');
}

/**
 * 将 Base64 数据转换为 Blob URL
 */
export function base64ToBlobUrl(base64Data: string): string {
  // 移除可能的 data URL 前缀
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'image/png' });
  
  return URL.createObjectURL(blob);
}

/**
 * 释放 Blob URL
 */
export function revokeBlobUrl(blobUrl: string): void {
  URL.revokeObjectURL(blobUrl);
}
