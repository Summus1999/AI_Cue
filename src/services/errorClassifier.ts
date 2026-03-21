/**
 * 错误分类器服务
 * 将技术性错误转换为用户友好的提示信息
 */

/** 错误分类枚举 */
export enum ErrorCategory {
  Timeout = 'timeout',
  Network = 'network',
  Auth = 'auth',
  RateLimit = 'rate_limit',
  ServerError = 'server_error',
  Unknown = 'unknown',
}

/** 友好错误信息结构 */
export interface FriendlyError {
  /** 错误分类 */
  category: ErrorCategory;
  /** 简短标题 */
  title: string;
  /** 友好描述（非技术性） */
  message: string;
  /** 建议操作 */
  suggestion: string;
  /** 显示图标 */
  icon: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 建议重试延迟（秒） */
  retryDelay?: number;
}

/** 错误匹配规则 */
interface ErrorMatchRule {
  /** 匹配正则模式列表 */
  patterns: RegExp[];
  /** 错误分类 */
  category: ErrorCategory;
  /** 友好错误信息（不含 category） */
  friendlyError: Omit<FriendlyError, 'category'>;
}

/**
 * 错误分类器 - 将技术错误映射为用户友好提示
 */
class ErrorClassifier {
  private rules: ErrorMatchRule[] = [
    // 超时错误
    {
      patterns: [/timeout/i, /请求超时/i, /timed? ?out/i, /deadline/i],
      category: ErrorCategory.Timeout,
      friendlyError: {
        title: '响应超时',
        message: 'AI 正在思考中，但等待时间过长',
        suggestion: '请稍后重试，或尝试缩短问题长度',
        icon: '⏱️',
        retryable: true,
        retryDelay: 5,
      },
    },
    // 网络错误
    {
      patterns: [
        /network/i, /connection/i, /ECONNREFUSED/i, /ENOTFOUND/i,
        /网络错误/i, /无法连接/i, /连接失败/i, /ECONNRESET/i,
        /socket/i, /offline/i, /unreachable/i,
      ],
      category: ErrorCategory.Network,
      friendlyError: {
        title: '网络连接失败',
        message: '无法连接到 AI 服务',
        suggestion: '请检查网络连接后重试',
        icon: '🌐',
        retryable: true,
        retryDelay: 3,
      },
    },
    // 认证错误
    {
      patterns: [
        /401/i, /403/i, /unauthorized/i, /auth/i, /forbidden/i,
        /认证失败/i, /无效.*key/i, /api.?key/i, /鉴权/i,
      ],
      category: ErrorCategory.Auth,
      friendlyError: {
        title: '认证失败',
        message: 'API 密钥无效或已过期',
        suggestion: '请前往设置更新 API 密钥',
        icon: '🔑',
        retryable: false,
      },
    },
    // 频率限制
    {
      patterns: [/429/i, /rate.?limit/i, /too many/i, /频率超限/i, /请求过于频繁/i, /throttle/i],
      category: ErrorCategory.RateLimit,
      friendlyError: {
        title: '请求过于频繁',
        message: 'AI 服务暂时繁忙',
        suggestion: '请等待片刻后重试',
        icon: '⏳',
        retryable: true,
        retryDelay: 10,
      },
    },
    // 服务端错误
    {
      patterns: [/500/i, /502/i, /503/i, /504/i, /server/i, /internal/i, /服务.*错误/i, /gateway/i],
      category: ErrorCategory.ServerError,
      friendlyError: {
        title: '服务暂时不可用',
        message: 'AI 服务正在维护中或暂时不可用',
        suggestion: '请稍后再试',
        icon: '🔧',
        retryable: true,
        retryDelay: 30,
      },
    },
  ];

  /**
   * 对错误进行分类，返回友好错误信息
   * @param rawError 原始错误信息
   * @param errorCategory 后端提供的错误分类（可选，优先使用）
   * @returns 友好错误信息
   */
  classify(rawError: string, errorCategory?: string | ErrorCategory): FriendlyError {
    // 优先使用后端提供的分类
    if (errorCategory) {
      return this.classifyByCategory(errorCategory, rawError);
    }
    // 回退到正则匹配
    for (const rule of this.rules) {
      if (rule.patterns.some(pattern => pattern.test(rawError))) {
        return {
          category: rule.category,
          ...rule.friendlyError,
        };
      }
    }
    return this.defaultError(rawError);
  }

  /**
   * 根据后端提供的分类直接返回友好错误
   * 支持字符串或 ErrorCategory 枚举值
   */
  private classifyByCategory(category: string | ErrorCategory, rawError: string): FriendlyError {
    // 统一转换为 ErrorCategory 进行比较
    const categoryKey = typeof category === 'string' ? category : category;
    const rule = this.rules.find(r => r.category === categoryKey);
    if (rule) {
      return { category: rule.category, ...rule.friendlyError };
    }
    return this.defaultError(rawError);
  }

  /**
   * 默认错误处理
   */
  private defaultError(_rawError: string): FriendlyError {
    return {
      category: ErrorCategory.Unknown,
      title: '出现问题',
      message: '请求处理时遇到了问题',
      suggestion: '请稍后重试，如问题持续请联系支持',
      icon: '❌',
      retryable: true,
      retryDelay: 5,
    };
  }

  /**
   * 注册自定义错误规则（新规则优先级更高）
   * @param rule 错误匹配规则
   */
  registerRule(rule: ErrorMatchRule): void {
    // 新规则优先级更高，插入到开头
    this.rules.unshift(rule);
  }

  /**
   * 获取所有已注册规则（用于调试）
   */
  getRules(): ErrorMatchRule[] {
    return [...this.rules];
  }
}

// 单例实例
export const errorClassifier = new ErrorClassifier();

/** 脱敏配置常量 */
const SANITIZE_CONFIG = {
  /** 最大错误长度限制（防止 ReDoS） */
  MAX_ERROR_LENGTH: 10000,
} as const;

/** 脱敏正则表达式模式 */
const SANITIZE_PATTERNS = {
  /** URL 中的域名 */
  URL: /https?:\/\/[^\s\/]+/gi,
  /** IP 地址 */
  IP: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,
  /** OpenAI API Key 格式 */
  OPENAI_API_KEY: /sk-[a-zA-Z0-9]{20,}/g,
  /** Bearer Token */
  BEARER_TOKEN: /Bearer\s+[a-zA-Z0-9\-_.]+/gi,
  /** AWS Access Key */
  AWS_KEY: /AKIA[A-Z0-9]{16}/g,
  /** Git URL 中的凭证 */
  GIT_CREDENTIALS: /https?:\/\/[^:]+:[^@]+@/gi,
  /** Email 地址 */
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /** Windows 文件路径（限制长度防止贪婪匹配） */
  WINDOWS_PATH: /[A-Z]:\\[^\s]{1,500}/gi,
  /** Unix 文件路径（使用非贪婪匹配并限制长度） */
  UNIX_PATH: /\/[^\s]{1,100}?\/[^\s]{1,100}?/g,
  /** 通用密钥格式（32位以上字母数字） */
  GENERIC_SECRET: /['"][a-zA-Z0-9]{32,}['"]/g,
} as const;

/** 脱敏替换值 */
const SANITIZE_REPLACEMENTS = {
  URL: '[URL]',
  IP: '[IP]',
  API_KEY: '[API_KEY]',
  BEARER_TOKEN: 'Bearer [TOKEN]',
  AWS_KEY: '[AWS_KEY]',
  GIT_CREDENTIALS: 'https://[CREDENTIALS]@',
  EMAIL: '[EMAIL]',
  PATH: '[PATH]',
  SECRET: '[SECRET]',
} as const;

/**
 * 敏感信息脱敏工具
 * 用于在错误提示中移除敏感信息
 * 安全特性：限制输入长度，防止 ReDoS 攻击
 */
export function sanitizeError(error: string): string {
  // 限制输入长度，防止正则表达式拒绝服务攻击
  let sanitized = error;
  if (sanitized.length > SANITIZE_CONFIG.MAX_ERROR_LENGTH) {
    sanitized = sanitized.slice(0, SANITIZE_CONFIG.MAX_ERROR_LENGTH) + '...[截断]';
  }

  return sanitized
    // 移除 URL 中的域名
    .replace(SANITIZE_PATTERNS.URL, SANITIZE_REPLACEMENTS.URL)
    // 移除 IP 地址
    .replace(SANITIZE_PATTERNS.IP, SANITIZE_REPLACEMENTS.IP)
    // 移除可能的 API Key（OpenAI 格式）
    .replace(SANITIZE_PATTERNS.OPENAI_API_KEY, SANITIZE_REPLACEMENTS.API_KEY)
    // 移除 Bearer Token
    .replace(SANITIZE_PATTERNS.BEARER_TOKEN, SANITIZE_REPLACEMENTS.BEARER_TOKEN)
    // 移除 AWS Key
    .replace(SANITIZE_PATTERNS.AWS_KEY, SANITIZE_REPLACEMENTS.AWS_KEY)
    // 移除 Git URL 中的凭证
    .replace(SANITIZE_PATTERNS.GIT_CREDENTIALS, SANITIZE_REPLACEMENTS.GIT_CREDENTIALS)
    // 移除 Email 地址
    .replace(SANITIZE_PATTERNS.EMAIL, SANITIZE_REPLACEMENTS.EMAIL)
    // 移除文件路径（Windows 风格）
    .replace(SANITIZE_PATTERNS.WINDOWS_PATH, SANITIZE_REPLACEMENTS.PATH)
    // 移除文件路径（Unix 风格）
    .replace(SANITIZE_PATTERNS.UNIX_PATH, SANITIZE_REPLACEMENTS.PATH)
    // 移除可能的密钥格式（通用）
    .replace(SANITIZE_PATTERNS.GENERIC_SECRET, SANITIZE_REPLACEMENTS.SECRET);
}
