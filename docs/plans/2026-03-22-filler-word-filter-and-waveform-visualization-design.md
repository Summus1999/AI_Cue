# 填充词识别与忽略 + 音量波形实时可视化 — 架构设计文档

> **版本**: v1.0  
> **日期**: 2026-03-22  
> **范围**: TODO #47 ~ #48  

---

## 一、文档概述

### 1.1 需求背景

在面试辅助场景下，用户语音识别结果中常包含大量无实意的填充词（如"嗯"、"那个"、"就是"等），这些词语会干扰 AI 对核心问题的理解。同时，用户在录音过程中缺乏实时音量反馈，无法确认麦克风是否正常工作。

本设计文档覆盖以下两个需求：

| # | 需求 | 优先级 | 复杂度 | 预估工时 |
|---|------|--------|--------|----------|
| 47 | 填充词识别与忽略（仅技术专家模式） | P1 | 中 | 4h |
| 48 | 音量波形实时可视化 | P1 | 高 | 8-10h |

### 1.2 设计目标

- **可扩展**：填充词规则可配置，波形可视化模式可扩展
- **可维护**：模块职责单一，代码结构清晰
- **高性能**：实时数据处理不影响录音质量和 UI 响应
- **代码安全**：防止 XSS 注入、内存泄漏、线程安全问题

### 1.3 依赖关系

```
#47 (填充词过滤) ─ 独立，可并行开发
#48 (波形可视化) ─ 独立，需修改 Rust 后端
```

---

## 二、现状分析

### 2.1 已具备的能力

| 能力 | 代码位置 | 说明 |
|------|----------|------|
| 语音识别服务 | `src/services/speechRecognition.ts` | `recognizeSpeech()` 返回识别文本 |
| 音频录制后端 | `src-tauri/src/audio/` | WASAPI 采集循环，状态机管理 |
| Prompt 模板配置 | `src/store/config.ts` | `PROMPT_TEMPLATES` 支持 `tech` 模式判断 |
| Tauri 事件系统 | `src-tauri/src/lib.rs` | 已有 `ai-stream` 事件机制 |
| NLS 语音识别 | `src-tauri/src/nls.rs` | 阿里云 ASR 集成 |

### 2.2 缺失的能力

- 语音识别无文本后处理逻辑，结果直接返回
- WASAPI 采集循环无实时数据回调机制
- 无音量/波形实时事件发射
- 前端无波形渲染组件

### 2.3 关键限制

**音频采集循环现状**（`windows_wasapi.rs`）：

```
循环: capture_packets()
  → GetNextPacketSize() → GetBuffer() → append_packet_samples() → ReleaseBuffer()
  → 监听 stop_rx（停止信号）
  → 所有样本存入 samples: Vec<f32>
  → 最终通过 worker.join() 返回完整 CapturedAudio
```

工作线程仅在结束时返回数据，无法在录音过程中获取中间数据。

---

## 三、功能 #47：填充词识别与忽略

### 3.1 需求分析

#### 功能范围

- 识别并过滤中文语境下的填充词
- 常见填充词：`嗯`、`那个`、`就是`、`然后`、`啊`、`呃`、`额`、`这个`、`所以说`、`对吧`
- 仅对文本层面过滤，不影响原始录音数据

#### 触发条件

- **仅在 `promptTemplateId === 'tech'`（技术专家模式）时生效**
- 其他模式（面试官、自定义等）保持原样

#### 边界约束

- 过滤后文本不能为空（全是填充词时保留原文）
- 保留标点和语句结构
- 避免误删有意义的词（上下文感知）

### 3.2 架构方案

**选择在前端服务层（TypeScript）实现**

理由：
- 可直接访问 config 判断模式，无需跨 IPC 传递模式信息
- 便于调试和热更新填充词库
- 填充词过滤是轻量文本操作，前端性能足够
- 与现有 `speechRecognition.ts` 集成自然

#### 模块设计

新建文件：`src/services/fillerWordFilter.ts`

```typescript
// ============== 类型定义 ==============

/**
 * 填充词匹配规则
 */
interface FillerWordRule {
  /** 匹配模式（正则表达式） */
  pattern: RegExp;
  /** 匹配类型 */
  type: 'exact' | 'contextual';
  /** 优先级（数值越大越先处理） */
  priority: number;
  /** 规则描述（调试用） */
  description?: string;
}

/**
 * 过滤器配置
 */
interface FilterConfig {
  /** 是否启用过滤 */
  enabled: boolean;
  /** 过滤规则集 */
  rules: FillerWordRule[];
  /** 是否保留原文（用于调试） */
  preserveOriginal?: boolean;
}

/**
 * 过滤结果
 */
interface FilterResult {
  /** 过滤后文本 */
  filtered: string;
  /** 原始文本 */
  original: string;
  /** 被移除的词列表 */
  removedWords: string[];
  /** 是否实际应用了过滤 */
  filterApplied: boolean;
}

// ============== 核心类 ==============

class FillerWordFilter {
  private rules: FillerWordRule[];
  
  constructor(customRules?: FillerWordRule[]) {
    this.rules = customRules || this.getDefaultRules();
    // 按优先级排序
    this.rules.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * 过滤文本中的填充词
   */
  filter(text: string, config: FilterConfig): FilterResult {
    if (!config.enabled || !text.trim()) {
      return {
        filtered: text,
        original: text,
        removedWords: [],
        filterApplied: false,
      };
    }
    
    // 1. 合并规则：自定义规则优先
    const activeRules = config.rules?.length
      ? [...config.rules, ...this.rules]
      : this.rules;
    
    // 2. 执行规则匹配（按优先级排序）
    let result = text;
    const removedWords: string[] = [];
    
    for (const rule of activeRules.sort((a, b) => b.priority - a.priority)) {
      const matches = result.match(rule.pattern);
      if (matches) {
        removedWords.push(...matches);
        result = result.replace(rule.pattern, '');
      }
    }
    
    // 3. 后处理：清理多余空格
    result = this.cleanSpaces(result);
    
    // 4. 安全检查：过滤后不能为空
    if (!result.trim()) {
      return {
        filtered: text,
        original: text,
        removedWords: [],
        filterApplied: false,
      };
    }
    
    return {
      filtered: result,
      original: config.preserveOriginal ? text : '',
      removedWords: [...new Set(removedWords)],
      filterApplied: removedWords.length > 0,
    };
  }
  
  /**
   * 默认中文填充词规则集
   */
  private getDefaultRules(): FillerWordRule[] {
    return [
      // 精确匹配：独立的语气词
      {
        pattern: /(?<=[。，！？\s]|^)[嗯恩唔][嗯恩唔]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '独立语气词：嗯、恩、唔',
      },
      {
        pattern: /(?<=[。，！？\s]|^)[啊呀哦哇嘿][啊呀哦哇嘿]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '独立感叹词',
      },
      {
        pattern: /(?<=[。，！？\s]|^)[呃额][呃额]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '犹豫词：呃、额',
      },
      // 上下文匹配：句首填充短语
      {
        pattern: /(?<=[。！？]|^)\s*那个[，,]?\s*/g,
        type: 'contextual',
        priority: 80,
        description: '句首"那个"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*这个[，,]?\s*/g,
        type: 'contextual',
        priority: 80,
        description: '句首"这个"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*就是说?[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"就是/就是说"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*然后[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"然后"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*所以说?[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"所以/所以说"',
      },
      // 句尾填充
      {
        pattern: /[，,]?\s*对吧[。？]?\s*$/g,
        type: 'contextual',
        priority: 60,
        description: '句尾"对吧"',
      },
      {
        pattern: /[，,]?\s*是吧[。？]?\s*$/g,
        type: 'contextual',
        priority: 60,
        description: '句尾"是吧"',
      },
    ];
  }
  
  /**
   * 清理多余空格和标点
   */
  private cleanSpaces(text: string): string {
    return text
      .replace(/\s+/g, ' ')           // 合并多余空格
      .replace(/^[，,。！？\s]+/g, '') // 清理句首无意义标点
      .replace(/[，,]{2,}/g, '，')     // 合并连续逗号
      .trim();
  }
  
  /**
   * 添加自定义规则
   */
  addRule(rule: FillerWordRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * 从字符串数组创建精确匹配规则
   */
  addExactWords(words: string[], priority = 50): void {
    const pattern = new RegExp(
      `(?<=[。，！？\\s]|^)(${words.join('|')})(?=[。，！？\\s]|$)`,
      'g'
    );
    this.addRule({
      pattern,
      type: 'exact',
      priority,
      description: `自定义词汇: ${words.join(', ')}`,
    });
  }
}

// ============== 导出函数 ==============

/**
 * 根据配置判断是否应启用填充词过滤
 */
function shouldEnableFilter(config: AppConfig): boolean {
  const filterCfg = config.fillerWordFilter;
  if (!filterCfg?.enabled) return false;
  
  // 若配置了白名单模板，则按白名单判断
  if (filterCfg.enabledTemplates?.length) {
    return filterCfg.enabledTemplates.includes(config.promptTemplateId);
  }
  
  // 默认策略：仅 tech 模式
  return config.promptTemplateId === 'tech';
}

/**
 * 创建带配置的过滤器实例
 */
function createFilter(config: AppConfig): FillerWordFilter {
  const filter = new FillerWordFilter();
  
  // 添加用户自定义填充词
  if (config.fillerWordFilter?.customWords?.length) {
    filter.addExactWords(config.fillerWordFilter.customWords);
  }
  
  return filter;
}
```

### 3.3 集成方案

#### 修改 `speechRecognition.ts`

在 `recognizeSpeech()` 返回结果后应用过滤：

```typescript
import { FillerWordFilter, shouldEnableFilter, createFilter, FilterResult } from './fillerWordFilter';

/**
 * 扩展返回类型，包含过滤信息
 */
interface RecognitionResult {
  text: string;
  filterResult?: FilterResult;
}

/**
 * 识别语音并可选过滤填充词
 */
export async function recognizeSpeech(
  audioData: Uint8Array,
  config: AppConfig,
  options?: RecognizeOptions
): Promise<RecognitionResult> {
  // 1. 调用 NLS 识别（现有逻辑）
  const rawText = await invoke<string>('nls_recognize_speech', {
    audioData: Array.from(audioData),
    appKey: config.nlsAppKey,
    accessKeyId: config.nlsAccessKeyId,
    accessKeySecret: config.nlsAccessKeySecret,
  });
  
  // 2. 应用填充词过滤（新增）
  if (shouldEnableFilter(config) && config.fillerWordFilter?.enabled !== false) {
    const filter = createFilter(config);
    const filterResult = filter.filter(rawText, {
      enabled: true,
      rules: [], // 使用默认规则
    });
    
    return {
      text: filterResult.filtered,
      filterResult,
    };
  }
  
  return { text: rawText };
}
```

#### 调用方适配（App.tsx）

```typescript
// 变更前
const text = await recognizeSpeech(audioData, config);
// 使用 text...

// 变更后
const result = await recognizeSpeech(audioData, config);
const text = result.text;
// 可选：显示过滤信息
if (result.filterResult?.filterApplied) {
  console.debug('已过滤填充词:', result.filterResult.removedWords);
}
// 使用 text...
```

### 3.4 配置扩展

#### 扩展 AppConfig（`src/store/config.ts`）

```typescript
export interface FillerWordFilterConfig {
  /** 总开关（默认 true，仅在 tech 模式下生效） */
  enabled: boolean;
  /** 用户自定义填充词 */
  customWords?: string[];
  /** 支持的模板白名单（如 ['tech', 'tech-cn']） */
  enabledTemplates?: string[];
  /** 语言标识，用于选择默认规则集 */
  locale?: string;
}

export interface AppConfig {
  // ... 现有字段 ...
  
  /** 填充词过滤配置 */
  fillerWordFilter?: FillerWordFilterConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  // ... 现有默认值 ...
  fillerWordFilter: {
    enabled: true,
    customWords: [],
  },
};
```

### 3.5 可扩展性设计

| 扩展方向 | 实现方式 |
|----------|----------|
| 多语言支持 | 在 `getDefaultRules()` 中增加语言判断分支 |
| 用户自定义 | 通过 `config.fillerWordFilter.customWords` 动态添加 |
| 外部规则注入 | 通过 `FilterConfig.rules` 可注入自定义规则，自定义规则优先于内置规则执行 |
| 按语言/模板控制启用 | 通过 `fillerWordFilter.enabledTemplates` 和 `locale` 精细控制过滤适用范围 |
| 规则持久化 | 将自定义规则存入 Tauri Store |
| 过滤统计 | 累计 `FilterResult` 数据供复盘分析 |

### 3.6 安全设计

| 风险点 | 应对措施 |
|--------|----------|
| XSS 防护 | 依赖 React 默认转义机制；若需以 `dangerouslySetInnerHTML` 渲染富文本，在 UI 层单独做转义处理 |
| 纯文本处理 | FillerWordFilter 专注于纯文本内容处理，不做 HTML 层面的转义 |
| 正则 DoS | 规则数量限制 + 超时保护 |
| 语义丢失 | 空结果保护 + 上下文感知规则 |
| 内存泄漏 | 过滤器实例按需创建，无长期缓存 |

---

## 四、功能 #48：音量波形实时可视化

### 4.1 需求分析

#### 功能范围

- 录音过程中实时显示音量波形
- 帮助用户确认麦克风正常工作
- 提供直观的录音状态反馈

#### 技术挑战

- WASAPI 采集循环需要实时发射数据
- 跨线程安全传递 AppHandle
- 高频事件的性能控制
- 前端流畅渲染

### 4.2 架构设计（三层架构）

```
┌─────────────────────────────────────────────────────────────┐
│                        架构概览                              │
├─────────────────────────────────────────────────────────────┤
│  第一层：Rust 后端                                           │
│  ├─ windows_wasapi.rs  采集循环内计算 RMS/Peak              │
│  ├─ recorder.rs        管理 AppHandle 传递                  │
│  └─ types.rs           定义 AudioLevelEvent                 │
├─────────────────────────────────────────────────────────────┤
│  第二层：前端服务层                                          │
│  └─ audioVisualizer.ts  监听事件 + 数据缓冲 + 订阅管理       │
├─────────────────────────────────────────────────────────────┤
│  第三层：UI 渲染层                                           │
│  └─ WaveformVisualizer.tsx  Canvas 绑定渲染                 │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 第一层：Rust 后端实时数据发射

#### 4.3.1 数据结构定义（`types.rs`）

```rust
use serde::{Deserialize, Serialize};

/// 音频电平事件，用于前端波形可视化
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioLevelEvent {
    /// RMS 音量值（0.0 ~ 1.0）
    pub rms: f32,
    /// 峰值（0.0 ~ 1.0）
    pub peak: f32,
    /// 波形采样点（降采样后，约 64~128 个点）
    pub waveform: Vec<f32>,
    /// 时间戳（毫秒）
    pub timestamp: u64,
    /// 音频源标识 ("microphone" | "system")
    pub source: String,
}

impl AudioLevelEvent {
    /// 从原始样本创建事件
    pub fn from_samples(
        samples: &[f32],
        source: &str,
        target_points: usize,
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        
        // 计算 RMS
        let rms = if samples.is_empty() {
            0.0
        } else {
            let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
            (sum_sq / samples.len() as f32).sqrt().min(1.0)
        };
        
        // 计算 Peak
        let peak = samples
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max)
            .min(1.0);
        
        // 降采样生成波形点
        let waveform = Self::downsample(samples, target_points);
        
        Self {
            rms,
            peak,
            waveform,
            timestamp,
            source: source.to_string(),
        }
    }
    
    /// 降采样算法：将原始样本压缩到目标点数
    fn downsample(samples: &[f32], target_points: usize) -> Vec<f32> {
        if samples.is_empty() || target_points == 0 {
            return vec![0.0; target_points];
        }
        
        let chunk_size = (samples.len() / target_points).max(1);
        let mut result = Vec::with_capacity(target_points);
        
        for chunk in samples.chunks(chunk_size) {
            // 使用 RMS 作为该区间的代表值
            let sum_sq: f32 = chunk.iter().map(|s| s * s).sum();
            let rms = (sum_sq / chunk.len() as f32).sqrt();
            result.push(rms.min(1.0));
        }
        
        // 填充不足的部分
        while result.len() < target_points {
            result.push(0.0);
        }
        
        result.truncate(target_points);
        result
    }
}
```

#### 4.3.2 采集循环改造（`windows_wasapi.rs`）

```rust
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;

/// 采集上下文，包含可选的 AppHandle 用于事件发射
pub struct CaptureContext {
    pub app_handle: Option<AppHandle>,
    pub source: String,
    /// 事件发射间隔（毫秒）
    pub emit_interval_ms: u64,
    /// 波形采样点数
    pub waveform_points: usize,
}

impl Default for CaptureContext {
    fn default() -> Self {
        Self {
            app_handle: None,
            source: "system".to_string(),
            emit_interval_ms: 50,  // 20fps
            waveform_points: 64,
        }
    }
}

/// 修改后的采集循环（关键改动部分）
fn capture_packets_with_events(
    capture_client: &IAudioCaptureClient,
    stop_rx: &Receiver<()>,
    samples: &mut Vec<f32>,
    ctx: &CaptureContext,
) -> Result<(), AudioError> {
    let mut last_emit = Instant::now();
    let emit_interval = std::time::Duration::from_millis(ctx.emit_interval_ms);
    
    // 用于累积待发射的样本
    let mut pending_samples: Vec<f32> = Vec::with_capacity(4096);
    
    loop {
        // 检查停止信号
        if stop_rx.try_recv().is_ok() {
            break;
        }
        
        // 获取音频数据（现有逻辑）
        let packet_size = unsafe { capture_client.GetNextPacketSize()? };
        
        if packet_size > 0 {
            // ... 现有的 GetBuffer / ReleaseBuffer 逻辑 ...
            let packet_samples = /* 获取到的样本 */;
            
            // 存入主缓冲区
            samples.extend_from_slice(&packet_samples);
            
            // 存入待发射缓冲区
            pending_samples.extend_from_slice(&packet_samples);
        }
        
        // 节流发射事件
        if last_emit.elapsed() >= emit_interval {
            if let Some(ref app) = ctx.app_handle {
                if !pending_samples.is_empty() {
                    let event = AudioLevelEvent::from_samples(
                        &pending_samples,
                        &ctx.source,
                        ctx.waveform_points,
                    );
                    
                    // 发射事件（忽略错误，不影响采集）
                    let _ = app.emit_all("audio-level", &event);
                    
                    pending_samples.clear();
                }
            }
            last_emit = Instant::now();
        }
        
        // 避免 CPU 空转
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    
    Ok(())
}
```

#### 4.3.3 录音器改造（`recorder.rs`）

```rust
use tauri::AppHandle;

impl AudioRecorder {
    /// 带事件发射的录音启动
    pub fn start_recording_with_events(
        &mut self,
        source: Option<&str>,
        app_handle: Option<AppHandle>,
    ) -> Result<(), AudioError> {
        // ... 现有的状态检查 ...
        
        let (stop_tx, stop_rx) = channel();
        let source_type = source.unwrap_or("system").to_string();
        
        // 构建采集上下文
        let ctx = CaptureContext {
            app_handle,
            source: source_type.clone(),
            emit_interval_ms: 50,
            waveform_points: 64,
        };
        
        // 启动工作线程
        let worker = std::thread::spawn(move || {
            // 根据 source 选择采集函数
            match source_type.as_str() {
                "microphone" => capture_microphone_with_events(stop_rx, ctx),
                _ => capture_loopback_with_events(stop_rx, ctx),
            }
        });
        
        self.session = Some(RecordingSession { stop_tx, worker });
        self.state = RecorderState::Recording;
        
        Ok(())
    }
}
```

#### 4.3.4 命令层改造（`commands.rs`）

```rust
#[tauri::command]
pub async fn start_audio_recording(
    app_handle: tauri::AppHandle,
    audio_source: Option<String>,
) -> Result<(), String> {
    let recorder = AUDIO_RECORDER.lock().map_err(|e| e.to_string())?;
    
    recorder
        .start_recording_with_events(
            audio_source.as_deref(),
            Some(app_handle),  // 传入 AppHandle
        )
        .map_err(|e| e.to_string())
}
```

### 4.4 第二层：前端服务层

#### 4.4.1 服务设计（`src/services/audioVisualizer.ts`）

```typescript
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// ============== 类型定义 ==============

interface WaveformData {
  rms: number;
  peak: number;
  waveform: number[];
  timestamp: number;
  source: string;
}

type WaveformCallback = (data: WaveformData) => void;

// ============== 环形缓冲区 ==============

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
}

// ============== 核心服务类 ==============

class AudioVisualizerService {
  private static instance: AudioVisualizerService | null = null;
  
  private buffer: RingBuffer<WaveformData>;
  private listeners: Set<WaveformCallback> = new Set();
  private unlistenFn: UnlistenFn | null = null;
  private isActive = false;
  private subscriberCount = 0;
  
  private constructor() {
    this.buffer = new RingBuffer(100); // 保留最近 100 帧（约 5 秒）
  }
  
  static getInstance(): AudioVisualizerService {
    if (!AudioVisualizerService.instance) {
      AudioVisualizerService.instance = new AudioVisualizerService();
    }
    return AudioVisualizerService.instance;
  }
  
  /**
   * 开始监听音频电平事件
   */
  async start(): Promise<void> {
    if (this.isActive) return;
    
    this.unlistenFn = await listen<WaveformData>('audio-level', (event) => {
      const data = event.payload;
      this.buffer.push(data);
      
      // 通知所有订阅者
      this.listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (e) {
          console.error('Waveform callback error:', e);
        }
      });
    });
    
    this.isActive = true;
  }
  
  /**
   * 停止监听
   */
  stop(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.buffer.clear();
    this.isActive = false;
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
      void this.start();
    }
    
    return () => {
      this.listeners.delete(callback);
      this.subscriberCount -= 1;
      // 最后一个订阅者取消时自动停止
      if (this.subscriberCount === 0) {
        this.stop();
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
}

// ============== 导出 ==============

export const audioVisualizer = AudioVisualizerService.getInstance();

export type { WaveformData, WaveformCallback };
```

### 4.5 第三层：UI 渲染组件

#### 4.5.1 组件设计（`src/components/WaveformVisualizer.tsx`）

```typescript
import React, { useRef, useEffect, useCallback } from 'react';
import { audioVisualizer, WaveformData } from '../services/audioVisualizer';

// ============== 类型定义 ==============

type VisualizerMode = 'bar' | 'line' | 'circle';

interface WaveformVisualizerProps {
  /** 可视化模式 */
  mode?: VisualizerMode;
  /** 画布宽度 */
  width?: number;
  /** 画布高度 */
  height?: number;
  /** 前景色（默认咖啡色主题） */
  color?: string;
  /** 背景色 */
  backgroundColor?: string;
  /** 是否正在录音 */
  isActive: boolean;
  /** 灵敏度（0.1 ~ 2.0） */
  sensitivity?: number;
  /** 自定义类名 */
  className?: string;
}

// ============== 常量 ==============

// 咖啡色主题色
const DEFAULT_COLOR = '#8B4513';           // SaddleBrown
const DEFAULT_BG_COLOR = 'transparent';
const DEFAULT_SENSITIVITY = 1.0;

// ============== 组件实现 ==============

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  mode = 'bar',
  width = 200,
  height = 40,
  color = DEFAULT_COLOR,
  backgroundColor = DEFAULT_BG_COLOR,
  isActive,
  sensitivity = DEFAULT_SENSITIVITY,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const dataRef = useRef<WaveformData | null>(null);
  const prevDataRef = useRef<number[]>([]);
  
  // 绘制函数
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 清空画布
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    
    const data = dataRef.current;
    if (!data || !isActive) {
      // 非活动状态，绘制静态线
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    
    // 应用灵敏度
    const waveform = data.waveform.map((v) => 
      Math.min(1, v * sensitivity)
    );
    
    // 平滑过渡
    const smoothedWaveform = smoothTransition(
      prevDataRef.current,
      waveform,
      0.3
    );
    prevDataRef.current = smoothedWaveform;
    
    // 根据模式绘制
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    
    switch (mode) {
      case 'bar':
        drawBars(ctx, smoothedWaveform, width, height);
        break;
      case 'line':
        drawLine(ctx, smoothedWaveform, width, height);
        break;
      case 'circle':
        drawCircle(ctx, smoothedWaveform, width, height);
        break;
    }
    
    // 继续下一帧
    if (isActive) {
      animationRef.current = requestAnimationFrame(draw);
    }
  }, [mode, width, height, color, backgroundColor, isActive, sensitivity]);
  
  // 订阅数据更新
  useEffect(() => {
    if (!isActive) {
      dataRef.current = null;
      prevDataRef.current = [];
      return;
    }
    
    // 启动服务
    audioVisualizer.start();
    
    // 订阅更新
    const unsubscribe = audioVisualizer.subscribe((data) => {
      dataRef.current = data;
    });
    
    // 启动渲染循环
    animationRef.current = requestAnimationFrame(draw);
    
    return () => {
      unsubscribe();
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, draw]);
  
  // isActive 变化时重绘
  useEffect(() => {
    if (!isActive) {
      // 停止时绘制一次静态状态
      setTimeout(draw, 50);
    }
  }, [isActive, draw]);
  
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ display: 'block' }}
    />
  );
};

// ============== 绘制函数 ==============

/** 柱状图模式 */
function drawBars(
  ctx: CanvasRenderingContext2D,
  waveform: number[],
  width: number,
  height: number
): void {
  const barCount = waveform.length;
  const barWidth = width / barCount - 2;
  const centerY = height / 2;
  
  waveform.forEach((value, i) => {
    const barHeight = value * height * 0.9;
    const x = i * (barWidth + 2);
    const y = centerY - barHeight / 2;
    
    ctx.fillRect(x, y, barWidth, barHeight);
  });
}

/** 波形线模式 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  waveform: number[],
  width: number,
  height: number
): void {
  const centerY = height / 2;
  const step = width / (waveform.length - 1);
  
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  waveform.forEach((value, i) => {
    const x = i * step;
    const y = centerY - value * centerY * 0.9;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  
  // 绘制镜像下半部分
  for (let i = waveform.length - 1; i >= 0; i--) {
    const x = i * step;
    const y = centerY + waveform[i] * centerY * 0.9;
    ctx.lineTo(x, y);
  }
  
  ctx.closePath();
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
}

/** 环形模式 */
function drawCircle(
  ctx: CanvasRenderingContext2D,
  waveform: number[],
  width: number,
  height: number
): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * 0.25;
  const maxRadius = Math.min(width, height) * 0.45;
  
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  waveform.forEach((value, i) => {
    const angle = (i / waveform.length) * Math.PI * 2 - Math.PI / 2;
    const radius = baseRadius + value * (maxRadius - baseRadius);
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  
  ctx.closePath();
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
}

/** 平滑过渡函数 */
function smoothTransition(
  prev: number[],
  current: number[],
  factor: number
): number[] {
  if (prev.length !== current.length || prev.length === 0) {
    return current;
  }
  
  return current.map((value, i) => {
    const prevValue = prev[i] || 0;
    return prevValue + (value - prevValue) * factor;
  });
}

// ============== 导出 ==============

export default WaveformVisualizer;
export type { WaveformVisualizerProps, VisualizerMode };
```

### 4.6 数据流设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        完整数据流                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WASAPI capture_packets() 循环                                  │
│       │                                                         │
│       │ (每次 GetBuffer)                                        │
│       ▼                                                         │
│  ┌──────────────────────┐                                       │
│  │ 样本存入主缓冲区      │                                       │
│  │ 样本存入待发射缓冲区  │                                       │
│  └──────────┬───────────┘                                       │
│             │                                                   │
│             │ (每 50ms 节流)                                     │
│             ▼                                                   │
│  ┌──────────────────────┐                                       │
│  │ AudioLevelEvent::    │                                       │
│  │   from_samples()     │                                       │
│  │ - 计算 RMS           │                                       │
│  │ - 计算 Peak          │                                       │
│  │ - 降采样波形 (64点)  │                                        │
│  └──────────┬───────────┘                                       │
│             │                                                   │
│             │ emit_all("audio-level", event)                    │
│             ▼                                                   │
│  ═══════════════════════════════════════════  Tauri IPC 边界    │
│             │                                                   │
│             ▼                                                   │
│  ┌──────────────────────┐                                       │
│  │ AudioVisualizerService│                                      │
│  │ - listen()            │                                      │
│  │ - RingBuffer 存储     │                                      │
│  │ - 通知订阅者          │                                      │
│  └──────────┬───────────┘                                       │
│             │                                                   │
│             │ callback(data)                                    │
│             ▼                                                   │
│  ┌──────────────────────┐                                       │
│  │ WaveformVisualizer   │                                       │
│  │ - dataRef.current    │                                       │
│  └──────────┬───────────┘                                       │
│             │                                                   │
│             │ requestAnimationFrame                             │
│             ▼                                                   │
│  ┌──────────────────────┐                                       │
│  │ Canvas 绑定渑染       │                                       │
│  │ - 平滑过渡插值        │                                       │
│  │ - 绘制柱状/波形/环形  │                                       │
│  └──────────────────────┘                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.7 性能优化策略

| 层级 | 优化措施 |
|------|----------|
| Rust 采集层 | 节流发射（50ms）；降采样减少数据量；忽略发射失败 |
| IPC 传输层 | 事件数据精简（仅传输 64 个 f32）；避免传输原始音频 |
| 前端服务层 | 环形缓冲区限制内存；单例模式避免重复监听；订阅计数自动停止机制 |
| UI 渲染层 | requestAnimationFrame 驱动；离屏暂停渲染；平滑插值 |

#### 离屏暂停渲染实现策略

为避免页面不可见时浪费 CPU 资源，`WaveformVisualizer` 组件应实现以下策略：

1. **页面可见性监听**：使用 `document.visibilityState` + `visibilitychange` 事件，页面不可见时暂停 RAF，可见时恢复
2. **可选视口检测**：使用 `IntersectionObserver` 处理组件滑出视口的场景

示例实现：

```typescript
// 在 WaveformVisualizer 组件中添加
useEffect(() => {
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      cancelAnimationFrame(animationRef.current);
    } else if (isActive) {
      animationRef.current = requestAnimationFrame(draw);
    }
  }
  
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, [isActive, draw]);
```

#### 订阅计数自动停止机制

`AudioVisualizerService` 采用订阅计数策略自动管理生命周期：

- 当首次订阅者加入时自动调用 `start()`，开始 Tauri 事件监听
- 当最后一个订阅者取消订阅时自动调用 `stop()`，释放 Tauri 事件监听与内存
- 生命周期闭环：录音完成/组件卸载 → `unsubscribe()` → 无订阅者 → 自动 `stop()`

### 4.8 安全设计

| 风险点 | 应对措施 |
|--------|----------|
| 线程安全 | AppHandle 通过 clone 传入线程（Tauri AppHandle 是 Send + Sync） |
| 内存泄漏 | 环形缓冲区固定容量；useEffect 清理订阅和动画 |
| IPC 拥堵 | 节流发射；事件数据小于 1KB |
| 隐私保护 | 仅传输统计数据，不传输原始音频 |
| CPU 占用 | 采集循环 sleep 1ms；前端使用 rAF 而非 setInterval |

### 4.9 可扩展性设计

| 扩展方向 | 实现方式 |
|----------|----------|
| 新增可视化模式 | 在 `WaveformVisualizer` 中添加新的 `draw*` 函数 |
| FFT 频域分析 | 在 Rust 层引入 FFT 库，事件数据增加 `spectrum` 字段 |
| 多音源显示 | 根据 `source` 字段区分显示 |
| 设置页音频测试 | 复用 `WaveformVisualizer` 组件 |
| 录音时长统计 | 根据 `timestamp` 差值计算 |

---

## 五、改动文件清单

| 文件 | 改动类型 | 涉及功能 |
|------|----------|----------|
| `src/services/fillerWordFilter.ts` | **新增** | #47：填充词过滤核心模块 |
| `src/services/speechRecognition.ts` | 修改 | #47：集成填充词过滤 |
| `src/store/config.ts` | 修改 | #47：新增 `fillerWordFilter` 配置 |
| `src/services/audioVisualizer.ts` | **新增** | #48：前端事件监听与数据管理 |
| `src/components/WaveformVisualizer.tsx` | **新增** | #48：波形渲染组件 |
| `src-tauri/src/audio/types.rs` | 修改 | #48：新增 `AudioLevelEvent` |
| `src-tauri/src/audio/windows_wasapi.rs` | 修改 | #48：采集循环内事件发射 |
| `src-tauri/src/audio/recorder.rs` | 修改 | #48：AppHandle 传递 |
| `src-tauri/src/commands.rs` | 修改 | #48：命令签名增加 AppHandle |
| `src/App.tsx` | 修改 | #47 #48：集成过滤结果显示 + 波形组件 |

---

## 六、分阶段实施路线图

```
Phase 1 (Day 1) ─ 填充词过滤核心
  ├─ Task 1.1: 创建 fillerWordFilter.ts，实现 FillerWordFilter 类
  ├─ Task 1.2: 集成到 speechRecognition.ts
  └─ Task 1.3: 扩展 AppConfig，添加 fillerWordFilter 配置

Phase 2 (Day 1-2) ─ 音量波形后端
  ├─ Task 2.1: types.rs 新增 AudioLevelEvent 结构体
  ├─ Task 2.2: windows_wasapi.rs 改造采集循环，支持事件发射
  ├─ Task 2.3: recorder.rs 支持 AppHandle 传递
  └─ Task 2.4: commands.rs 修改命令签名

Phase 3 (Day 2-3) ─ 波形前端渲染
  ├─ Task 3.1: 创建 audioVisualizer.ts 服务
  ├─ Task 3.2: 创建 WaveformVisualizer.tsx 组件
  └─ Task 3.3: 集成到 App.tsx 录音区域

Phase 4 (Day 3) ─ 配置 UI 与优化
  ├─ Task 4.1: SettingsPanel 添加填充词过滤开关
  ├─ Task 4.2: 添加波形灵敏度调节
  └─ Task 4.3: 性能测试与调优
```

---

## 七、风险评估与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| WASAPI 事件发射影响采集性能 | 中 | 高 | 严格节流（50ms）；emit 失败时静默忽略；必要时降级为无波形模式 |
| 不同音频设备波形差异大 | 中 | 中 | 提供灵敏度调节；RMS 归一化处理 |
| 填充词误删导致语义丢失 | 中 | 中 | 上下文感知规则；空结果保护；保留原文可查 |
| 跨线程 AppHandle 传递失败 | 低 | 高 | Tauri AppHandle 天然支持 Send + Sync；添加错误处理 |
| 前端高频渲染导致卡顿 | 低 | 中 | rAF 节流；离屏暂停；平滑插值减少视觉抖动 |
| IPC 事件积压 | 低 | 中 | 环形缓冲区限制；事件数据精简 |

---

## 八、测试策略

### 8.1 单元测试要点

**填充词过滤 (`fillerWordFilter.test.ts`)**
- 基础过滤：验证常见填充词被正确移除
- 边界情况：全填充词文本、空文本、纯标点
- 上下文感知：验证有意义的词不被误删
- 安全性：XSS 字符被正确转义
- 自定义规则：用户添加的词被正确处理

**音频数据处理 (`types.rs` 单元测试)**
- RMS 计算：验证静音、满幅、正弦波的 RMS 值
- Peak 计算：验证峰值检测准确性
- 降采样：验证不同输入长度的输出正确性

### 8.2 集成测试要点

**端到端录音 + 波形**
- 启动录音后事件正常发射
- 停止录音后事件停止
- 前端正确接收并渲染
- 多次录音启停无状态异常

**填充词过滤集成**
- 技术专家模式下过滤生效
- 其他模式下不过滤
- 过滤结果正确传递到 AI 请求

### 8.3 性能测试要点

| 测试项 | 指标要求 |
|--------|----------|
| 事件发射延迟 | < 10ms |
| 前端渲染帧率 | ≥ 30fps |
| 内存占用增量 | < 10MB |
| CPU 占用增量 | < 5% |
| IPC 数据量 | < 1KB/event |

### 8.4 测试用例示例

```typescript
// 填充词过滤测试
describe('FillerWordFilter', () => {
  it('should filter standalone filler words', () => {
    const filter = new FillerWordFilter();
    const result = filter.filter('嗯，这个问题很好。', { enabled: true, rules: [] });
    expect(result.filtered).toBe('这个问题很好。');
    expect(result.removedWords).toContain('嗯');
  });
  
  it('should preserve meaningful context', () => {
    const filter = new FillerWordFilter();
    const result = filter.filter('就是说，这就是答案。', { enabled: true, rules: [] });
    // "就是说" 被删，"就是" 在 "这就是" 中保留
    expect(result.filtered).toBe('这就是答案。');
  });
  
  it('should not return empty result', () => {
    const filter = new FillerWordFilter();
    const result = filter.filter('嗯嗯嗯', { enabled: true, rules: [] });
    expect(result.filtered).toBe('嗯嗯嗯'); // 保留原文
    expect(result.filterApplied).toBe(false);
  });
});
```

---

## 九、UI 集成建议

### 9.1 波形组件位置

建议在录音按钮旁边显示波形，使用紧凑的柱状图模式：

```
┌──────────────────────────────────────┐
│                                      │
│   [|||||||  ] 🎙️ 正在录音... 00:15   │
│    波形图     按钮    状态    时长     │
│                                      │
└──────────────────────────────────────┘
```

### 9.2 颜色主题

与咖啡色主题保持一致：

```typescript
const THEME_COLORS = {
  waveform: '#8B4513',        // SaddleBrown - 主波形色
  waveformActive: '#A0522D',  // Sienna - 活动状态
  waveformPeak: '#CD853F',    // Peru - 峰值高亮
};
```

### 9.3 过滤提示（可选）

```
┌────────────────────────────────────────────┐
│ 💬 "那个，我觉得这个方案..."                 │
│                                            │
│ ℹ️ 已过滤填充词: 那个                       │
└────────────────────────────────────────────┘
```

---

## 十、附录：常见中文填充词参考

| 类别 | 词汇 |
|------|------|
| 犹豫词 | 嗯、恩、唔、呃、额、啊 |
| 指示词 | 那个、这个、那啥 |
| 连接词 | 就是、然后、所以、所以说 |
| 确认词 | 对吧、是吧、你知道吧 |
| 口癖 | 反正、其实、基本上 |

> **注意**：以上词汇在特定语境下可能有实际意义，规则设计需考虑上下文。
