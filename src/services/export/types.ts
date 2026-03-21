import { ExportData, ExportOptions } from '../../types/export';

/**
 * 导出格式
 */
export type ExportFormat = 'markdown' | 'pdf' | 'json';

/**
 * 导出策略接口
 */
export interface ExportStrategy {
  readonly format: ExportFormat;
  readonly fileExtension: string;
  readonly mimeType: string;

  /**
   * 导出核心方法
   */
  export(data: ExportData, options: ExportOptions): Promise<string>;

  /**
   * 获取默认文件名
   */
  getDefaultFileName(sessionTitle: string): string;
}

/**
 * 导出器工厂
 */
export class ExporterFactory {
  private static exporters: Map<ExportFormat, ExportStrategy> = new Map();

  /**
   * 注册导出器
   */
  static register(exporter: ExportStrategy): void {
    this.exporters.set(exporter.format, exporter);
  }

  /**
   * 获取导出器
   */
  static getExporter(format: ExportFormat): ExportStrategy {
    const exporter = this.exporters.get(format);
    if (!exporter) {
      throw new Error(`不支持的导出格式: ${format}`);
    }
    return exporter;
  }

  /**
   * 获取支持的格式列表
   */
  static getSupportedFormats(): ExportFormat[] {
    return Array.from(this.exporters.keys());
  }
}
