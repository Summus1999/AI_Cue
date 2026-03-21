/**
 * 统一重试策略服务
 * 提供指数退避 + 抖动的可复用重试机制
 */

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 基础延迟（ms） */
  baseDelay: number;
  /** 最大延迟（ms） */
  maxDelay: number;
  /** 退避乘数 */
  backoffMultiplier: number;
  /** 是否添加随机抖动 */
  jitter: boolean;
  /** 可重试的错误类型（关键词列表） */
  retryableErrors?: string[];
}

export interface RetryState {
  /** 当前尝试次数（0 = 首次尝试） */
  attempt: number;
  /** 最后一次错误信息 */
  lastError: string | null;
  /** 下次重试倒计时（ms） */
  nextRetryIn: number;
  /** 是否正在重试中 */
  isRetrying: boolean;
}

type RetryStateListener = (state: RetryState) => void;

/**
 * 重试策略接口
 * 定义重试策略的契约，便于测试和扩展
 */
export interface IRetryStrategy {
  /** 执行带重试的操作 */
  execute<T>(
    operation: () => Promise<T>,
    onRetry?: RetryStateListener,
  ): Promise<T>;
  /** 取消当前重试操作 */
  cancel(): void;
}

/**
 * 重试策略类 - 实现指数退避 + 抖动的重试机制
 */
export class RetryStrategy implements IRetryStrategy {
  private config: RetryConfig;
  private cancelled: boolean = false;
  private currentState: RetryState = {
    attempt: 0,
    lastError: null,
    nextRetryIn: 0,
    isRetrying: false,
  };
  private isExecuting: boolean = false; // 防止并发执行

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * 执行带重试的操作
   * @param operation 要执行的操作
   * @param onRetry 重试状态变更回调
   * @returns 操作结果
   */
  async execute<T>(
    operation: () => Promise<T>,
    onRetry?: RetryStateListener,
  ): Promise<T> {
    // 防止并发执行
    if (this.isExecuting) {
      throw new Error('已有操作正在执行中，请等待完成或创建新的 RetryStrategy 实例');
    }

    this.isExecuting = true;
    this.cancelled = false;
    this.currentState = {
      attempt: 0,
      lastError: null,
      nextRetryIn: 0,
      isRetrying: false,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      this.currentState.attempt = attempt;
      this.currentState.isRetrying = attempt > 0;

      if (attempt > 0) {
        // 计算延迟
        const delay = this.calculateDelay(attempt);
        this.currentState.nextRetryIn = delay;
        onRetry?.({ ...this.currentState });

        // 等待
        await this.sleep(delay);
      }

      try {
        const result = await operation();
        this.currentState.isRetrying = false;
        this.isExecuting = false;
        onRetry?.({ ...this.currentState });
        return result;
      } catch (error) {
        lastError = error as Error;
        this.currentState.lastError = lastError.message;

        // 检查是否可重试
        if (!this.isRetryable(error)) {
          this.isExecuting = false;
          throw error;
        }

        // 最后一次尝试也失败了
        if (attempt === this.config.maxRetries) {
          throw error;
        }

        onRetry?.({ ...this.currentState });
      }
    }

    this.isExecuting = false;
    throw lastError || new Error('重试次数耗尽');
  }

  /**
   * 取消当前重试操作
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 计算第 N 次重试的延迟时间（指数退避 + Full Jitter）
   *
   * 使用 AWS 推荐的 Full Jitter 算法：
   * delay = random(0, min(baseDelay * multiplier^(attempt-1), maxDelay))
   *
   * 这种算法的优点：
   * 1. 最大随机化分散重试时间，避免重试风暴
   * 2. 在 AWS 生产环境中验证有效
   * 3. 比简单 ±20% 抖动更能均匀分布请求
   */
  private calculateDelay(attempt: number): number {
    // 指数退避: baseDelay * multiplier^(attempt-1)
    const exponentialDelay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // 限制最大延迟
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);

    // Full Jitter: 在 [0, cappedDelay] 范围内随机选择
    if (this.config.jitter) {
      return Math.floor(Math.random() * cappedDelay);
    }

    return Math.floor(cappedDelay);
  }

  /**
   * 检查错误是否可重试
   */
  private isRetryable(error: unknown): boolean {
    const errorStr = String(error).toLowerCase();

    // 如果配置了可重试错误列表，检查是否匹配
    if (this.config.retryableErrors && this.config.retryableErrors.length > 0) {
      return this.config.retryableErrors.some(keyword =>
        errorStr.includes(keyword.toLowerCase())
      );
    }

    // 默认：认证错误不可重试
    if (errorStr.includes('401') || errorStr.includes('403') ||
        errorStr.includes('unauthorized') || errorStr.includes('auth') ||
        errorStr.includes('认证失败') || errorStr.includes('api key')) {
      return false;
    }

    return true;
  }

  /**
   * 休眠指定毫秒
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 语音识别重试配置
 * - 最多重试 3 次
 * - 基础延迟 1 秒，最大 8 秒
 * - 指数退避，带抖动
 */
export const SPEECH_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 8000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: ['timeout', 'network', 'connection', 'econnrefused', 'enotfound', 'socket', 'econnreset'],
};

/**
 * API 调用重试配置
 * - 最多重试 2 次
 * - 基础延迟 2 秒，最大 10 秒
 */
export const API_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelay: 2000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: ['timeout', 'network', 'rate_limit', '429', '500', '502', '503', '服务'],
};
