// Provider 插件相关类型定义 - 与后端 ProviderDescriptor 对齐

/**
 * 认证类型
 */
export type AuthType = 'bearer' | 'api_key_header' | 'api_key_query' | 'none';

/**
 * SSE 流式响应格式
 */
export type SseFormat = 'openai' | 'claude' | 'custom';

/**
 * 请求转换配置
 */
export interface RequestTransform {
  chatEndpoint?: string;
  modelField?: string;
  messagesField?: string;
  streamField?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

/**
 * 响应转换配置
 */
export interface ResponseTransform {
  contentPath?: string;
}

/**
 * 模型描述符
 */
export interface ModelDescriptor {
  id: string;
  name: string;
  description?: string;
  supportsVision?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Provider 能力
 */
export interface Capabilities {
  streaming?: boolean;
  vision?: boolean;
  functionCalling?: boolean;
}

/**
 * 健康检查配置
 */
export interface HealthCheckConfig {
  endpoint?: string;
  method?: 'GET' | 'HEAD' | 'POST';
  expectedStatus?: number[];
}

/**
 * 速率限制配置
 */
export interface RateLimit {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

/**
 * Provider 描述符 - 用于动态 Provider 配置
 */
export interface ProviderDescriptor {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  homepage?: string;
  baseUrl: string;
  supportsCustomUrl?: boolean;
  authType: AuthType;
  authHeader?: string;
  authPrefix?: string;
  sseFormat: SseFormat;
  requestTransform?: RequestTransform;
  responseTransform?: ResponseTransform;
  models: ModelDescriptor[];
  capabilities?: Capabilities;
  healthCheck?: HealthCheckConfig;
  rateLimit?: RateLimit;
}

/**
 * 扩展的 Provider 类型
 */
export type ExtendedProviderType =
  | { type: 'builtin'; id: 'qwen' | 'openai_compat' | 'claude' }
  | { type: 'dynamic'; id: string };

/**
 * Provider 元信息（前端展示用）
 */
export interface ProviderMeta {
  id: string;
  name: string;
  description?: string;
  providerType: string;  // "qwen" | "openai_compat" | "claude" | "dynamic:xxx"
  defaultBaseUrl: string;
  supportsCustomUrl: boolean;
  models: ModelInfo[];
  isBuiltin: boolean;
}

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  supportsVision?: boolean;
}

/**
 * 连通性测试结果
 */
export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  modelUsed: string;
  message: string;
}

/**
 * 日志导出结果
 */
export interface LogExportResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

/**
 * 验证 Provider 描述符
 */
export function validateProviderDescriptor(
  descriptor: Partial<ProviderDescriptor>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!descriptor.id || !/^[a-z][a-z0-9_]{2,31}$/.test(descriptor.id)) {
    errors.push('id 必须是 3-32 位小写字母开头的标识符');
  }
  if (!descriptor.name || descriptor.name.length > 64) {
    errors.push('name 必填且不超过 64 字符');
  }
  if (!descriptor.version || !/^\d+\.\d+\.\d+$/.test(descriptor.version)) {
    errors.push('version 必须是语义化版本号 (x.y.z)');
  }
  if (!descriptor.baseUrl) {
    errors.push('baseUrl 必填');
  }
  if (!descriptor.authType) {
    errors.push('authType 必填');
  }
  if (!descriptor.sseFormat) {
    errors.push('sseFormat 必填');
  }
  if (!descriptor.models || descriptor.models.length === 0) {
    errors.push('至少需要定义一个模型');
  }

  // 验证模型
  if (descriptor.models) {
    descriptor.models.forEach((model, index) => {
      if (!model.id) {
        errors.push(`模型 ${index + 1}: id 必填`);
      }
      if (!model.name) {
        errors.push(`模型 ${index + 1}: name 必填`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 判断是否为内置 Provider
 */
export function isBuiltinProvider(providerType: string): boolean {
  return ['qwen', 'openai_compat', 'claude'].includes(providerType);
}

/**
 * 从 providerType 提取 ID
 */
export function extractProviderId(providerType: string): string {
  if (providerType.startsWith('dynamic:')) {
    return providerType.substring(8);
  }
  return providerType;
}
