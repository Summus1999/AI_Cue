// 导出服务入口

// 导出核心类型（从 types/export）
export type {
  ExportFormat,
  ExportMetadata,
  ExportMessage,
  ExportData,
  ImageHandling,
  ExportOptions,
  ExportResult,
  InterviewContext,
  MessageSelection,
} from '../../types/export';

// 导出导出器相关类型
export { ExporterFactory } from './types';
export type { ExportStrategy, ExportFormat as ExporterFormat } from './types';

// 导出图片处理器
export { ImageHandler } from './imageHandler';
export type { ImageHandlerOptions, ProcessedImage } from './imageHandler';

// 导出导出器
export { MarkdownExporter } from './markdownExporter';
export { PDFExporter } from './pdfExporter';
export { JSONExporter } from './jsonExporter';
export { ReviewPdfExporter } from './reviewPdfExporter';
export type { ReviewExportData } from './reviewPdfExporter';

// 导出服务
export { ExportService, exportService } from './exportService';
