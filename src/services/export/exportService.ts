import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { ExportOptions, ExportResult, ExportFormat } from '../../types/export';
import { ExporterFactory } from './types';
import { MarkdownExporter } from './markdownExporter';
import { PDFExporter } from './pdfExporter';
import { JSONExporter } from './jsonExporter';

/**
 * 后端导出结果
 */
interface BackendExportResult {
  success: boolean;
  file_path?: string;
  file_size?: number;
  error?: string;
  content?: string;
}

/**
 * 导出服务
 */
export class ExportService {
  constructor() {
    // 注册导出器
    ExporterFactory.register(new MarkdownExporter());
    ExporterFactory.register(new PDFExporter());
    ExporterFactory.register(new JSONExporter());
  }

  /**
   * 导出会话
   */
  async exportSession(
    sessionId: string,
    sessionTitle: string,
    options: Partial<ExportOptions> & { format: ExportFormat }
  ): Promise<ExportResult> {
    try {
      // 获取导出器
      const exporter = ExporterFactory.getExporter(options.format);

      // 构建完整选项
      const exportOptions: ExportOptions = {
        format: options.format,
        includeMetadata: options.includeMetadata ?? true,
        includePromptContent: options.includePromptContent ?? false,
        includeImages: options.includeImages ?? true,
        imageHandling: options.imageHandling ?? 'embed',
        selectedMessageIds: options.selectedMessageIds,
        outputPath: options.outputPath,
      };

      // 获取默认文件名
      const defaultFileName = exporter.getDefaultFileName(sessionTitle);

      // 调用后端导出命令
      const result = await invoke<BackendExportResult>('export_session', {
        options: {
          session_id: sessionId,
          format: options.format,
          include_metadata: exportOptions.includeMetadata,
          include_prompt_content: exportOptions.includePromptContent,
          include_images: exportOptions.includeImages,
          image_handling: exportOptions.imageHandling,
          selected_message_ids: exportOptions.selectedMessageIds,
        },
      });

      if (!result.success || !result.content) {
        return {
          success: false,
          error: result.error || '导出失败',
        };
      }

      // 弹出保存对话框
      let filePath: string | undefined = options.outputPath;
      if (!filePath) {
        const savedPath = await save({
          defaultPath: defaultFileName,
          filters: [{
            name: this.getFilterName(options.format),
            extensions: [exporter.fileExtension.slice(1)],
          }],
        });
        filePath = savedPath || undefined;
      }

      if (!filePath) {
        return { success: false, error: '用户取消了导出' };
      }

      // 写入文件（PDF 格式需要特殊处理）
      if (options.format === 'pdf') {
        // PDF 导出新流程：使用 Edge headless 模式转换
        // 1. 生成临时 HTML 文件路径（和最终 PDF 同目录）
        const tempHtmlPath = filePath.replace(/\.pdf$/i, '_temp.html');
        
        // 2. 写入临时 HTML 文件
        await invoke('write_text_file', {
          path: tempHtmlPath,
          content: result.content,
        });
        
        try {
          // 3. 调用 Edge headless 将 HTML 转换为 PDF
          await invoke('convert_html_to_pdf', {
            htmlPath: tempHtmlPath,
            pdfPath: filePath,
          });
        } finally {
          // 4. 清理临时 HTML 文件（无论成功失败都删除）
          try {
            await invoke('delete_file', { path: tempHtmlPath });
          } catch (e) {
            console.warn('清理临时文件失败:', e);
          }
        }
        
        // 5. 打开生成的 PDF 文件
        try {
          await invoke('open_file_with_default_app', { path: filePath });
        } catch (e) {
          console.warn('无法自动打开 PDF:', e);
        }
      } else {
        // 其他格式（Markdown、JSON）直接写入
        await invoke('write_text_file', {
          path: filePath,
          content: result.content,
        });
      }

      return {
        success: true,
        filePath,
        fileSize: result.content.length,  // PDF 在转换后大小会变化，这里只是估算
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 在文件夹中显示文件
   */
  async showInFolder(filePath: string): Promise<void> {
    await invoke('show_in_folder', { path: filePath });
  }

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats(): ExportFormat[] {
    return ExporterFactory.getSupportedFormats();
  }

  /**
   * 获取过滤器名称
   */
  private getFilterName(format: ExportFormat): string {
    const names: Record<ExportFormat, string> = {
      markdown: 'Markdown 文件',
      pdf: 'PDF 文件',
      json: 'JSON 文件',
    };
    return names[format];
  }

}

// 导出单例
export const exportService = new ExportService();
