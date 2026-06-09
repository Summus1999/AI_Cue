// TTS 语音合成前端服务
// 调用 Rust 后端的 Windows SAPI TTS，实现离线语音朗读

import { invoke } from '@tauri-apps/api/core';
import { createLogger } from './logger';

const log = createLogger('SpeechSynthesis');

let isSpeaking = false;

// 去除 markdown 标记，提取纯文本用于朗读
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')  // 代码块替换为空格
    .replace(/`([^`]+)`/g, '$1')       // 行内代码
    .replace(/【([^】]*)】/g, '$1')     // 高亮标记
    .replace(/[*_~#>\-\[]/g, ' ')      // markdown 符号
    .replace(/\s+/g, ' ')
    .trim();
}

export async function speakText(text: string, rate?: number, volume?: number): Promise<void> {
  isSpeaking = true;
  try {
    const cleanText = stripMarkdown(text);
    if (!cleanText) return;
    await invoke('tts_speak', {
      text: cleanText,
      rate: rate ?? 2,
      volume: volume ?? 100,
    });
  } catch (err) {
    log.warn('TTS 朗读失败:', err);
    isSpeaking = false;
  }
}

export async function stopSpeaking(): Promise<void> {
  isSpeaking = false;
  try {
    await invoke('tts_stop');
  } catch (err) {
    log.warn('TTS 停止失败:', err);
  }
}

export function isTtsSpeaking(): boolean {
  return isSpeaking;
}

// 用户手动停止后多久内不自动播放（ms）
const AUTO_PLAY_COOLDOWN = 5000;
let lastManualStopTime = 0;

export function markManualStop(): void {
  lastManualStopTime = Date.now();
  isSpeaking = false;
}

export function canAutoPlay(): boolean {
  return Date.now() - lastManualStopTime > AUTO_PLAY_COOLDOWN;
}
