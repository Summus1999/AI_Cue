/**
 * 错误分类器服务
 * 将技术性错误转换为用户友好的提示信息
 */

/** 错误分类枚举。
 *  基础类型（Timeout/Network/Auth/RateLimit/ServerError）处理通用 API 错误。
 *  领域类型（RAG/Embedding/OCR/Export/Config）处理 AI_Cue 特有的功能错误，
 *  每种领域错误都有对应的 primaryAction 引导用户去正确的页面修复。 */
export enum ErrorCategory {
  Timeout = 'timeout',
  Network = 'network',
  Auth = 'auth',
  RateLimit = 'rate_limit',
  ServerError = 'server_error',
  RAG = 'rag',           // 知识库无可用文档
  Embedding = 'embedding', // 文档向量化失败
  OCR = 'ocr',           // Windows OCR 不可用
  Export = 'export',     // 导出失败（PDF/权限）
  Config = 'config',     // 模型配置错误/余额不足
  Unknown = 'unknown',
}

/** 面向用户的错误类型 —— FriendlyErrorCard 据此决定显示哪个操作按钮。
 *  例如 'missing_api_key' 会显示"前往设置"按钮，
 *  'rag_no_ready_documents' 会显示"打开知识库"按钮。 */
export type UserFacingErrorKind =
  | 'missing_api_key'
  | 'invalid_provider_config'
  | 'network_unavailable'
  | 'provider_rate_limited'
  | 'rag_no_ready_documents'
  | 'embedding_failed'
  | 'ocr_unavailable'
  | 'export_failed'
  | 'insufficient_balance'
  | 'unknown';

/** 友好错误信息结构 */
export interface FriendlyError {
  /** 错误分类 */
  category: ErrorCategory;
  /** 面向用户的错误类型（UI 据此显示不同的操作按钮） */
  userFacingKind: UserFacingErrorKind;
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
  /** 主要操作按钮配置。
   *  kind 决定按钮图标和目标：
   *  - 'retry': 重试当前操作
   *  - 'settings': 打开设置页（如配置 API Key）
   *  - 'knowledge': 打开知识库页（如导入文档）
   *  - 'dismiss': 仅关闭错误卡片 */
  primaryAction?: { label: string; kind: 'retry' | 'settings' | 'knowledge' | 'dismiss' };
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
        userFacingKind: 'network_unavailable',
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
        userFacingKind: 'network_unavailable',
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
        userFacingKind: 'missing_api_key',
        primaryAction: { label: '前往设置', kind: 'settings' },
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
        userFacingKind: 'provider_rate_limited',
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
        userFacingKind: 'unknown',
      },
    },
    // RAG 无可用文档
    {
      patterns: [/no ready documents/i, /无.*ready.*文档/i, /rag.*no.*doc/i, /知识库.*无.*文档/i],
      category: ErrorCategory.RAG,
      friendlyError: {
        title: '知识库无可用文档',
        message: '当前知识库中没有已完成索引的文档，RAG 检索增强无法生效',
        suggestion: '请先导入文档并等待索引完成，或切换到一个已有 ready 文档的知识库',
        icon: '📚',
        retryable: false,
        userFacingKind: 'rag_no_ready_documents',
        primaryAction: { label: '打开知识库', kind: 'knowledge' },
      },
    },
    // Embedding 失败
    {
      patterns: [/embed/i, /embedding.*fail/i, /向量化失败/i, /向量.*错误/i, /embed.*error/i],
      category: ErrorCategory.Embedding,
      friendlyError: {
        title: '文档向量化失败',
        message: '文档文本转换为向量的过程失败了，可能因为 Embedding 服务不可用或 API Key 无效',
        suggestion: '请检查 Embedding Provider 的 API Key 是否正确配置，或稍后重试重建索引',
        icon: '🧮',
        retryable: true,
        retryDelay: 10,
        userFacingKind: 'embedding_failed',
        primaryAction: { label: '前往设置', kind: 'settings' },
      },
    },
    // OCR 不可用
    {
      patterns: [/ocr/i, /光学.*识别/i, /windows.*ocr/i, /ocr.*fail/i, /文字识别失败/i],
      category: ErrorCategory.OCR,
      friendlyError: {
        title: '文字识别（OCR）不可用',
        message: 'Windows OCR 功能当前不可用，可能因为系统语言包未安装或服务未启动',
        suggestion: 'OCR 仅在 Windows 系统上可用。你可以在设置中关闭 OCR fallback 后重试导入',
        icon: '👁️',
        retryable: false,
        userFacingKind: 'ocr_unavailable',
        primaryAction: { label: '前往设置', kind: 'settings' },
      },
    },
    // 导出失败
    {
      patterns: [/export.*fail/i, /导出失败/i, /pdf.*fail/i, /pdf.*error/i, /权限不足/i, /permission.*denied/i, /file.*write/i],
      category: ErrorCategory.Export,
      friendlyError: {
        title: '导出失败',
        message: '会话导出过程中出现问题，可能是文件写入权限不足或 PDF 生成失败',
        suggestion: '请检查目标文件夹是否有写入权限，或尝试更换导出路径',
        icon: '📄',
        retryable: true,
        retryDelay: 3,
        userFacingKind: 'export_failed',
      },
    },
    // 配置错误
    {
      patterns: [/invalid.*config/i, /配置.*错误/i, /api.*key.*missing/i, /missing.*api.*key/i, /base.*url.*invalid/i, /model.*invalid/i, /余额不足/i, /insufficient.*balance/i, /quota/i],
      category: ErrorCategory.Config,
      friendlyError: {
        title: '模型配置有误',
        message: '当前的模型配置存在问题，可能是 API Key 缺失、Base URL 格式错误或账户余额不足',
        suggestion: '请前往设置检查模型配置，确保 API Key 和 Base URL 正确填写',
        icon: '⚙️',
        retryable: false,
        userFacingKind: 'missing_api_key',
        primaryAction: { label: '前往设置', kind: 'settings' },
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
      userFacingKind: 'unknown',
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
