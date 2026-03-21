// 会话导出功能类型定义

/**
 * 导出格式枚举
 */
export type ExportFormat = 'markdown' | 'pdf' | 'json' | 'review_pdf';

/**
 * 面试背景信息
 */
export interface InterviewContext {
  company: string;
  position: string;
  jdHighlights: string;
}

/**
 * 导出元数据
 */
export interface ExportMetadata {
  // 基础信息
  sessionId: string;
  sessionTitle: string;
  exportedAt: number;          // 导出时间戳
  exportFormat: ExportFormat;
  appVersion: string;

  // 会话信息
  createdAt: number;
  updatedAt: number;
  messageCount: number;

  // AI 配置（来自 session 或当前配置）
  provider?: string;
  model?: string;
  promptTemplateId?: string;
  promptTemplateName?: string;  // 模板显示名称
  promptContent?: string;       // 完整 Prompt 内容（可选导出）

  // 面试背景
  interviewContext?: InterviewContext;
}

/**
 * 导出消息项
 */
export interface ExportMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // 图片处理
  hasImage: boolean;
  imageData?: string;          // Base64 数据（内嵌模式）
  imagePath?: string;          // 相对路径（外部文件模式）
}

/**
 * 统一导出数据结构
 */
export interface ExportData {
  metadata: ExportMetadata;
  messages: ExportMessage[];
}

/**
 * 图片处理方式
 */
export type ImageHandling = 'embed' | 'extract';

/**
 * 导出配置选项
 */
export interface ExportOptions {
  format: ExportFormat;
  includeMetadata: boolean;       // 是否包含元数据头
  includePromptContent: boolean;  // 是否导出 Prompt 内容
  includeImages: boolean;         // 是否包含图片
  imageHandling: ImageHandling;   // 图片处理方式
  selectedMessageIds?: string[];  // 选择性导出的消息 ID
  outputPath?: string;            // 输出路径（未指定则弹出对话框）
}

/**
 * 导出结果
 */
export interface ExportResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

/**
 * 消息选择状态
 */
export interface MessageSelection {
  sessionId: string;
  selectedIds: Set<string>;      // 已选中的消息 ID
  selectAll: boolean;            // 全选状态
}
