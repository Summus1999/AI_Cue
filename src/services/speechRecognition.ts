/**
 * Alibaba Cloud NLS one-shot speech recognition service.
 * Uses Tauri Rust backend to bypass CORS restrictions.
 * 支持自动重试机制。
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '../store/config';
import { validateNlsConfig } from '../store/config';
import { RetryStrategy, SPEECH_RETRY_CONFIG, RetryState } from './retryStrategy';

/** 语音识别选项 */
export interface SpeechRecognitionOptions {
  /** 重试状态回调 */
  onRetry?: (state: RetryState) => void;
}

/**
 * Recognize speech from WAV bytes using Alibaba NLS one-shot API.
 * WAV must be 16kHz, mono, 16-bit. Long audio is segmented in backend.
 * 支持自动重试机制。
 */
export async function recognizeSpeech(
  audioData: Uint8Array,
  config: AppConfig,
  options?: SpeechRecognitionOptions,
): Promise<string> {
  const validation = validateNlsConfig(config);
  if (!validation.valid) {
    throw new Error(validation.message || '请先在设置中配置 NLS 语音识别');
  }

  const region = config.nlsRegion || 'cn-shanghai';

  const retryStrategy = new RetryStrategy(SPEECH_RETRY_CONFIG);

  return retryStrategy.execute(
    async () => {
      // 调用 Rust 后端进行语音识别（绕过 CORS）
      const result = await invoke<string>('nls_recognize_speech', {
        audioData: Array.from(audioData),
        accessKeyId: config.nlsAccessKeyId,
        accessKeySecret: config.nlsAccessKeySecret,
        appKey: config.nlsAppKey,
        region,
      });
      return result;
    },
    options?.onRetry,
  );
}

/**
 * 获取语音识别错误提示（用于 UI 显示）
 */
export function getSpeechErrorMessage(error: unknown): string {
  const errorStr = String(error).toLowerCase();

  if (errorStr.includes('timeout') || errorStr.includes('超时')) {
    return '语音识别超时，请检查网络后重试';
  }
  if (errorStr.includes('network') || errorStr.includes('连接')) {
    return '网络连接失败，请检查网络后重试';
  }
  if (errorStr.includes('auth') || errorStr.includes('认证') || errorStr.includes('key')) {
    return 'NLS 认证失败，请检查 AccessKey 配置';
  }
  if (errorStr.includes('cancel')) {
    return '语音识别已取消';
  }

  return `语音识别失败: ${error instanceof Error ? error.message : String(error)}`;
}

// Token cache no longer needed (handled in Rust backend)
export function clearTokenCache(): void {
  // No-op: Token caching is now handled in Rust backend
}
