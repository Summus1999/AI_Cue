// 前端日志服务 - 统一日志管理

import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 前端日志服务（单例）
 */
class Logger {
  private static instance: Logger;

  /** 内存环形缓冲 */
  private buffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;

  /** 当前日志级别 */
  private level: LogLevel = 'info';

  /** 日志级别优先级 */
  private readonly levelPriority: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  };

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** 设置日志级别 */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** 创建模块化 logger */
  createModuleLogger(module: string) {
    return {
      trace: (message: string, data?: unknown) =>
        this.log('trace', module, message, data),
      debug: (message: string, data?: unknown) =>
        this.log('debug', module, message, data),
      info: (message: string, data?: unknown) =>
        this.log('info', module, message, data),
      warn: (message: string, data?: unknown) =>
        this.log('warn', module, message, data),
      error: (message: string, data?: unknown) =>
        this.log('error', module, message, data),
    };
  }

  /** 记录日志 */
  private log(
    level: LogLevel,
    module: string,
    message: string,
    data?: unknown
  ): void {
    // 级别过滤
    if (this.levelPriority[level] < this.levelPriority[this.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      module,
      message: this.sanitize(message),
      timestamp: Date.now(),
      data: data ? this.sanitizeData(data) : undefined,
    };

    // 添加到缓冲
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // 控制台输出
    const consoleMethod = level === 'trace' ? 'log' : level;
    const prefix = `[${module}]`;
    if (data) {
      console[consoleMethod](prefix, message, data);
    } else {
      console[consoleMethod](prefix, message);
    }

    // 桥接到后端（仅 warn/error）
    if (level === 'warn' || level === 'error') {
      this.bridgeToBackend(entry);
    }
  }

  /** 获取缓冲中的日志 */
  getBufferedLogs(): LogEntry[] {
    return [...this.buffer];
  }

  /** 清空缓冲 */
  clearBuffer(): void {
    this.buffer = [];
  }

  /** 导出日志为 JSON 字符串 */
  async exportLogs(): Promise<string> {
    const logs = this.buffer.map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp).toISOString(),
    }));
    return JSON.stringify(logs, null, 2);
  }

  /** 导出日志到文件 */
  async exportLogsToFile(
    format: 'text' | 'json' = 'json',
    includeFrontend: boolean = true
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const frontendLogs = includeFrontend ? await this.exportLogs() : undefined;

      const result = await invoke<{
        success: boolean;
        filePath?: string;
        fileSize?: number;
        error?: string;
      }>('export_logs', {
        format,
        includeFrontend,
        frontendLogs,
      });

      return {
        success: result.success,
        filePath: result.filePath,
        error: result.error,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 敏感信息脱敏 - 字符串 */
  private sanitize(value: string): string {
    return value
      // OpenAI API Key
      .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]')
      // Bearer Token
      .replace(/Bearer\s+[a-zA-Z0-9\-_.]+/gi, 'Bearer [REDACTED]')
      // 阿里云 Access Key
      .replace(/(LTAI|STS)[a-zA-Z0-9]{20,}/g, '[REDACTED]');
  }

  /** 将任意类型安全转为可脱敏对象 */
  private sanitizeData(data: unknown): Record<string, unknown> {
    if (data instanceof Error) {
      return { error: data.message, stack: data.stack };
    }
    if (typeof data === 'string') {
      return { message: this.sanitize(data) };
    }
    if (typeof data === 'object' && data !== null) {
      return this.sanitizeObject(data as Record<string, unknown>);
    }
    return { value: String(data) };
  }

  /** 敏感信息脱敏 - 对象 */
  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      'apiKey',
      'api_key',
      'token',
      'password',
      'secret',
      'accessKeyId',
      'accessKeySecret',
    ];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        result[key] = this.sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /** 桥接到后端 */
  private async bridgeToBackend(entry: LogEntry): Promise<void> {
    try {
      await invoke('log_from_frontend', {
        level: entry.level,
        module: entry.module,
        message: entry.message,
        data: entry.data ? JSON.stringify(entry.data) : null,
      });
    } catch {
      // 静默失败，避免日志循环
    }
  }
}

export const logger = Logger.getInstance();

// 便捷导出
export const createLogger = (module: string) => logger.createModuleLogger(module);

// 全局错误处理
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logger.createModuleLogger('window').error(`未捕获的错误: ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.createModuleLogger('window').error('未处理的 Promise 拒绝', {
      reason: String(event.reason),
    });
  });
}
