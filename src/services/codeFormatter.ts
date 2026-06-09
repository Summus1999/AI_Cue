/**
 * 代码格式化服务
 * 支持 Prettier 和 Monaco 内置格式化
 */

export interface FormatOptions {
  tabWidth?: number;
  useTabs?: boolean;
  printWidth?: number;
  semi?: boolean;
  singleQuote?: boolean;
}

export interface FormatterPlugin {
  readonly name: string;
  readonly supportedLanguages: string[];
  format(code: string, language: string, options?: FormatOptions): Promise<string>;
}

class CodeFormatterService {
  private plugins: Map<string, FormatterPlugin> = new Map();
  private languageToPlugin: Map<string, string> = new Map();
  private worker: Worker | null = null;
  private workerMessageHandler: ((event: MessageEvent) => void) | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor() {
    // 注册默认插件
    this.register(new PrettierFormatterPlugin(this));
    this.register(new MonacoFormatterPlugin());
  }

  // 注册格式化插件
  register(plugin: FormatterPlugin): void {
    this.plugins.set(plugin.name, plugin);
    
    for (const lang of plugin.supportedLanguages) {
      // 优先使用先注册的插件
      if (!this.languageToPlugin.has(lang)) {
        this.languageToPlugin.set(lang, plugin.name);
      }
    }
  }

  // 获取语言对应的格式化器
  getFormatter(language: string): FormatterPlugin | null {
    const pluginName = this.languageToPlugin.get(language);
    return pluginName ? this.plugins.get(pluginName) || null : null;
  }

  // 格式化代码
  async format(code: string, language: string, options?: FormatOptions): Promise<string> {
    const formatter = this.getFormatter(language);
    
    if (!formatter) {
      throw new Error(`不支持 ${language} 语言的格式化`);
    }
    
    return formatter.format(code, language, options);
  }

  // 检查语言是否支持格式化
  isSupported(language: string): boolean {
    return this.languageToPlugin.has(language);
  }

  // 获取或创建 Worker
  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/prettierWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      // 设置消息处理器并保存引用以便清理
      this.workerMessageHandler = (event: MessageEvent) => {
        const { requestId, formatted, error } = event.data;
        const pending = this.pendingRequests.get(requestId);
        
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);
          
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(formatted);
          }
        }
      };
      this.worker.onmessage = this.workerMessageHandler;
      
      // 处理 Worker 错误
      this.worker.onerror = (error) => {
        console.error('Prettier Worker error:', error); // Worker context - no logger available
        // 拒绝所有待处理请求
        for (const pending of this.pendingRequests.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Worker 执行错误'));
        }
        this.pendingRequests.clear();
      };
    }
    
    return this.worker;
  }

  // 在 Worker 中格式化
  formatInWorker(code: string, language: string, options?: FormatOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('格式化超时（5秒）'));
      }, 5000);
      
      this.pendingRequests.set(id, { resolve, reject, timeout });
      
      this.getWorker().postMessage({
        requestId: id,
        code,
        language,
        options,
      });
    });
  }

  // 清理资源
  dispose(): void {
    if (this.worker) {
      // 移除消息处理器
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.workerMessageHandler = null;
      // 终止 Worker
      this.worker.terminate();
      this.worker = null;
    }
    
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('格式化服务已关闭'));
    }
    this.pendingRequests.clear();
  }
}

// Prettier 格式化插件
class PrettierFormatterPlugin implements FormatterPlugin {
  readonly name = 'prettier';
  readonly supportedLanguages = [
    'javascript', 'typescript', 'jsx', 'tsx',
    'json', 'css', 'scss', 'less',
    'html', 'markdown', 'yaml',
  ];

  constructor(private service: CodeFormatterService) {}

  async format(code: string, language: string, options?: FormatOptions): Promise<string> {
    return this.service.formatInWorker(code, language, options);
  }
}

// Monaco 内置格式化插件（基础缩进规范化）
class MonacoFormatterPlugin implements FormatterPlugin {
  readonly name = 'monaco-builtin';
  readonly supportedLanguages = ['cpp', 'c', 'java', 'go', 'rust', 'python', 'sql'];

  async format(code: string, language: string): Promise<string> {
    const lines = code.split('\n');
    let indentLevel = 0;
    const indentSize = 2;
    const formattedLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 减少缩进的情况
      if (trimmed.startsWith('}') || trimmed.startsWith(')') || trimmed.startsWith(']')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      
      // 添加缩进
      if (trimmed) {
        formattedLines.push(' '.repeat(indentLevel * indentSize) + trimmed);
      } else {
        formattedLines.push('');
      }
      
      // 增加缩进的情况
      if (trimmed.endsWith('{') || trimmed.endsWith('(') || trimmed.endsWith('[') ||
          (trimmed.endsWith(':') && ['python'].includes(language))) {
        indentLevel++;
      }
    }
    
    return formattedLines.join('\n');
  }
}

export const codeFormatter = new CodeFormatterService();
