/**
 * 音频可视化服务
 * 监听 Rust 后端发射的音频电平事件，提供给 WaveformVisualizer 组件使用
 */
import { createLogger } from './logger';

const log = createLogger('AudioVisualizer');

import { listen, UnlistenFn } from '@tauri-apps/api/event';

// ============== 类型定义 ==============

/**
 * 波形数据
 */
export interface WaveformData {
  /** RMS 音量值（0.0 ~ 1.0） */
  rms: number;
  /** 峰值（0.0 ~ 1.0） */
  peak: number;
  /** 波形采样点数组 */
  waveform: number[];
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 音频源标识 ("microphone" | "system") */
  source: string;
}

/**
 * 波形数据回调函数类型
 */
export type WaveformCallback = (data: WaveformData) => void;

// ============== 环形缓冲区 ==============

/**
 * 环形缓冲区，用于存储历史波形数据
 */
class RingBuffer<T> {
  private buffer: T[] = [];
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(item: T): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  getLatest(): T | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  clear(): void {
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }
}

// ============== 核心服务类 ==============

/**
 * 音频可视化服务单例
 */
class AudioVisualizerService {
  private static instance: AudioVisualizerService | null = null;

  /** 数据缓冲区，保留最近 100 帧（约 5 秒） */
  private buffer: RingBuffer<WaveformData>;

  /** 回调函数集合 */
  private listeners: Set<WaveformCallback> = new Set();

  /** 取消监听函数 */
  private unlistenFn: UnlistenFn | null = null;

  /** 是否正在监听 */
  private isActive = false;

  /** 订阅者计数 */
  private subscriberCount = 0;

  private constructor() {
    this.buffer = new RingBuffer<WaveformData>(100);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AudioVisualizerService {
    if (!AudioVisualizerService.instance) {
      AudioVisualizerService.instance = new AudioVisualizerService();
    }
    return AudioVisualizerService.instance;
  }

  /**
   * 开始监听音频电平事件
   * 内部方法，由 subscribe 自动调用
   */
  private async startListening(): Promise<void> {
    if (this.isActive) return;

    try {
      log.debug('Starting to listen for audio-level events...');
      this.unlistenFn = await listen<WaveformData>('audio-level', (event) => {
        const data = event.payload;
        log.trace('Received audio-level event:', { rms: data.rms.toFixed(4), peak: data.peak.toFixed(4), points: data.waveform.length });
        this.buffer.push(data);

        // 通知所有订阅者
        this.listeners.forEach((callback) => {
          try {
            callback(data);
          } catch (e) {
            log.error('Waveform callback error:', e);
          }
        });
      });

      this.isActive = true;
      log.debug('Successfully started listening for audio-level events');
    } catch (error) {
      log.error('Failed to start listening:', error);
      this.isActive = false;
    }
  }

  /**
   * 停止监听
   * 内部方法，由 unsubscribe 自动调用
   */
  private stopListening(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.buffer.clear();
    this.isActive = false;
    log.debug('停止监听音频电平事件');
  }

  /**
   * 订阅波形数据更新
   * 当首次有订阅者时自动启动监听，当最后一个订阅者取消时自动停止
   * @returns 取消订阅函数
   */
  subscribe(callback: WaveformCallback): () => void {
    this.listeners.add(callback);
    this.subscriberCount += 1;

    // 首次订阅时自动启动
    if (!this.isActive) {
      void this.startListening();
    }

    // 返回取消订阅函数
    return () => {
      this.listeners.delete(callback);
      this.subscriberCount -= 1;

      // 最后一个订阅者取消时自动停止
      if (this.subscriberCount === 0) {
        this.stopListening();
      }
    };
  }

  /**
   * 获取最新数据
   */
  getLatestData(): WaveformData | undefined {
    return this.buffer.getLatest();
  }

  /**
   * 获取历史数据
   */
  getHistoryData(): WaveformData[] {
    return this.buffer.getAll();
  }

  /**
   * 是否正在活动
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * 获取当前 RMS 值（用于音量指示）
   */
  getCurrentRms(): number {
    const latest = this.buffer.getLatest();
    return latest?.rms ?? 0;
  }

  /**
   * 获取当前峰值（用于音量指示）
   */
  getCurrentPeak(): number {
    const latest = this.buffer.getLatest();
    return latest?.peak ?? 0;
  }
}

// ============== 导出 ==============

export const audioVisualizer = AudioVisualizerService.getInstance();
