/**
 * Alibaba Cloud NLS one-shot speech recognition service.
 * Uses Tauri Rust backend to bypass CORS restrictions.
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '../store/config';
import { validateNlsConfig } from '../store/config';

/**
 * Recognize speech from WAV bytes using Alibaba NLS one-shot API.
 * WAV must be 16kHz, mono, 16-bit. Max 60 seconds.
 */
export async function recognizeSpeech(audioData: Uint8Array, config: AppConfig): Promise<string> {
  const validation = validateNlsConfig(config);
  if (!validation.valid) {
    throw new Error(validation.message || '请先在设置中配置 NLS 语音识别');
  }

  const region = config.nlsRegion || 'cn-shanghai';

  // 调用 Rust 后端进行语音识别（绕过 CORS）
  const result = await invoke<string>('nls_recognize_speech', {
    audioData: Array.from(audioData),
    accessKeyId: config.nlsAccessKeyId,
    accessKeySecret: config.nlsAccessKeySecret,
    appKey: config.nlsAppKey,
    region,
  });

  return result;
}

// Token cache no longer needed (handled in Rust backend)
export function clearTokenCache(): void {
  // No-op: Token caching is now handled in Rust backend
}
