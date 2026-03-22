/**
 * 截图控制器
 * 
 * 封装截图链路的核心逻辑，实现内存优先传输：
 * 1. 使用 capture_with_preview 命令获取截图
 * 2. 分辨率 ≤ 2560x1440：使用 Base64 内存传输
 * 3. 分辨率 > 2560x1440：回退到磁盘链路
 * 4. 统一管理窗口切换、事件监听、资源清理
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { 
  perfScreenshotStart, 
  perfScreenshotCaptureDone, 
  perfScreenshotWindowCreated, 
  perfScreenshotComplete, 
  perfScreenshotCancelled, 
  perfScreenshotError 
} from '../perf/perfInstrumentation';
import { isPassthroughEnabled, setPassthrough } from '../windowManager';

// 截图结果类型
interface ScreenCaptureResult {
  source_path: string;
  screen_x: number;
  screen_y: number;
  logical_width: number;
  logical_height: number;
  physical_width: number;
  physical_height: number;
}

// 截图完成载荷
export interface ScreenshotCompletePayload {
  imageData: number[];
  debugPath: string;
}

// 截图完成回调
export type ScreenshotCompleteCallback = (imageBase64: string, debugPath: string) => void;
// 截图取消回调
export type ScreenshotCancelledCallback = () => void;
// 截图错误回调
export type ScreenshotErrorCallback = (error: string) => void;

// 截图窗口配置
interface ScreenshotWindowConfig {
  captureId: string;
  transportType: 'memory' | 'disk';
  payloadRef: string;
  logicalWidth: number;
  logicalHeight: number;
  physicalWidth: number;
  physicalHeight: number;
}

/**
 * 截图控制器
 * 管理截图链路的整个生命周期
 */
export class ScreenshotController {
  private cleanupListeners: () => void = () => {};
  private wasPassthroughEnabled = false;
  private pendingCallbacks: {
    onComplete?: ScreenshotCompleteCallback;
    onCancel?: ScreenshotCancelledCallback;
    onError?: ScreenshotErrorCallback;
  } = {};
  private currentConfig: ScreenshotWindowConfig | null = null;

  /**
   * 执行截图
   * @param callbacks 回调函数
   */
  async capture(callbacks: {
    onComplete?: ScreenshotCompleteCallback;
    onCancel?: ScreenshotCancelledCallback;
    onError?: ScreenshotErrorCallback;
  }): Promise<void> {
    // 记录截图开始
    perfScreenshotStart();
    
    // 保存回调
    this.pendingCallbacks = callbacks;
    
    const mainWindow = getCurrentWindow();
    const existingScreenshotWindow = await WebviewWindow.getByLabel("screenshot");
    
    // 截图前临时关闭穿透模式（穿透模式下无法接收截图窗口的鼠标事件）
    this.wasPassthroughEnabled = isPassthroughEnabled();
    if (this.wasPassthroughEnabled) {
      await setPassthrough(false);
    }

    try {
      // 关闭已存在的截图窗口
      if (existingScreenshotWindow) {
        await existingScreenshotWindow.close();
      }

      // 隐藏主窗口
      await mainWindow.hide();

      // 执行截图（使用原来的磁盘模式，稳定可靠）
      // 注意：内存传输方案因 URL 长度限制暂不可行，需要另寻方案
      const capture = await invoke<ScreenCaptureResult>('capture_full_screen');
      
      // 保存当前截图配置
      this.currentConfig = {
        captureId: '',
        transportType: 'disk',
        payloadRef: capture.source_path,
        logicalWidth: capture.logical_width,
        logicalHeight: capture.logical_height,
        physicalWidth: capture.physical_width,
        physicalHeight: capture.physical_height,
      };
      
      // 记录截图捕获完成
      perfScreenshotCaptureDone({
        logicalWidth: capture.logical_width,
        logicalHeight: capture.logical_height,
        physicalWidth: capture.physical_width,
        physicalHeight: capture.physical_height,
        transportType: 'disk',
      });

      // 设置事件监听
      await this.setupListeners();

      // 构建截图 URL
      const screenshotUrl = `/screenshot.html?` +
        `transportType=disk` +
        `&payloadRef=${encodeURIComponent(capture.source_path)}` +
        `&logicalWidth=${capture.logical_width}` +
        `&logicalHeight=${capture.logical_height}` +
        `&physicalWidth=${capture.physical_width}` +
        `&physicalHeight=${capture.physical_height}`;

      // 创建截图窗口
      new WebviewWindow('screenshot', {
        url: screenshotUrl,
        x: capture.screen_x,
        y: capture.screen_y,
        width: capture.logical_width,
        height: capture.logical_height,
        decorations: false,
        transparent: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: true,
        resizable: false,
      });
      
      // 记录截图窗口创建
      perfScreenshotWindowCreated();
    } catch (err) {
      this.cleanup();
      // 记录截图错误
      perfScreenshotError(err instanceof Error ? err.message : String(err));
      await this.restoreMainWindow();
      callbacks.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 设置事件监听
   */
  private async setupListeners(): Promise<void> {
    const cleanupCallbacks: UnlistenFn[] = [];

    const unlistenComplete = await listen<ScreenshotCompletePayload>('screenshot-complete', (event) => {
      this.cleanup();
      void (async () => {
        try {
          await this.restoreMainWindow();
          const bytes = new Uint8Array(event.payload.imageData);
          const imageBase64 = this.bytesToBase64(bytes);
          // 记录截图完成
          perfScreenshotComplete();
          this.pendingCallbacks.onComplete?.(imageBase64, event.payload.debugPath);
        } catch (error) {
          await this.restoreMainWindow();
          this.pendingCallbacks.onError?.(error instanceof Error ? error.message : String(error));
        }
      })();
    });
    cleanupCallbacks.push(unlistenComplete);

    const unlistenCancel = await listen('screenshot-cancelled', () => {
      this.cleanup();
      // 记录截图取消
      perfScreenshotCancelled();
      void this.restoreMainWindow();
      this.pendingCallbacks.onCancel?.();
    });
    cleanupCallbacks.push(unlistenCancel);

    this.cleanupListeners = () => {
      cleanupCallbacks.forEach((callback) => callback());
      cleanupCallbacks.length = 0;
    };
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.cleanupListeners();
    this.cleanupListeners = () => {};
    this.currentConfig = null;
  }

  /**
   * 恢复主窗口
   */
  async restoreMainWindow(): Promise<void> {
    try {
      const mainWindow = getCurrentWindow();
      await mainWindow.show();
      await mainWindow.setFocus();
      // 截图结束后恢复穿透模式
      if (this.wasPassthroughEnabled) {
        await setPassthrough(true);
      }
    } catch {
      // 忽略恢复失败
    }
  }

  /**
   * 取消截图（由截图页调用）
   */
  async cancel(sourcePath?: string): Promise<void> {
    this.cleanup();
    perfScreenshotCancelled();
    
    try {
      await invoke("cancel_screenshot", { sourcePath: sourcePath || '' });
    } catch {
      // 忽略清理失败
    }
    await this.restoreMainWindow();
    this.pendingCallbacks.onCancel?.();
  }

  /**
   * 将字节数组转换为 Base64
   */
  private bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 8192;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  /**
   * 获取当前截图配置（用于截图页获取预览数据）
   */
  getCurrentConfig(): ScreenshotWindowConfig | null {
    return this.currentConfig;
  }
}

// 导出单例
export const screenshotController = new ScreenshotController();
