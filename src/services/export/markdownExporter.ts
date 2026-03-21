import { ExportData, ExportOptions } from '../../types/export';
import { ExportStrategy, ExportFormat } from './types';

/**
 * Markdown 导出器
 */
export class MarkdownExporter implements ExportStrategy {
  readonly format: ExportFormat = 'markdown';
  readonly fileExtension = '.md';
  readonly mimeType = 'text/markdown';

  async export(data: ExportData, options: ExportOptions): Promise<string> {
    const lines: string[] = [];

    // 生成元数据头（YAML Front Matter 格式）
    if (options.includeMetadata) {
      lines.push('---');
      lines.push(`title: ${data.metadata.sessionTitle}`);
      lines.push(`exported_at: ${this.formatDate(data.metadata.exportedAt)}`);
      lines.push(`created_at: ${this.formatDate(data.metadata.createdAt)}`);
      lines.push(`message_count: ${data.metadata.messageCount}`);

      if (data.metadata.provider) {
        lines.push(`provider: ${data.metadata.provider}`);
      }
      if (data.metadata.model) {
        lines.push(`model: ${data.metadata.model}`);
      }
      if (data.metadata.promptTemplateName) {
        lines.push(`prompt_template: ${data.metadata.promptTemplateName}`);
      }

      // 面试背景
      if (data.metadata.interviewContext) {
        lines.push('interview_context:');
        lines.push(`  company: ${data.metadata.interviewContext.company}`);
        lines.push(`  position: ${data.metadata.interviewContext.position}`);
        if (data.metadata.interviewContext.jdHighlights) {
          lines.push(`  jd_highlights: |`);
          const highlights = data.metadata.interviewContext.jdHighlights.split('\n');
          highlights.forEach(h => lines.push(`    ${h}`));
        }
      }

      lines.push('---');
      lines.push('');
    }

    // 标题
    lines.push(`# ${data.metadata.sessionTitle}`);
    lines.push('');

    // 消息内容
    for (const msg of data.messages) {
      const roleLabel = msg.role === 'user' ? '用户' : 'AI';
      const timestamp = this.formatTime(msg.timestamp);

      lines.push(`## ${roleLabel} [${timestamp}]`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      // 处理图片
      if (msg.hasImage && options.includeImages && msg.imageData) {
        lines.push(`![截图](data:image/png;base64,${msg.imageData})`);
        lines.push('');
      }
    }

    // 可选：导出 Prompt 内容
    if (options.includePromptContent && data.metadata.promptContent) {
      lines.push('---');
      lines.push('');
      lines.push('## 附录：System Prompt');
      lines.push('');
      lines.push('```');
      lines.push(data.metadata.promptContent);
      lines.push('```');
    }

    return lines.join('\n');
  }

  getDefaultFileName(sessionTitle: string): string {
    const safeTitle = this.sanitizeFilename(sessionTitle);
    const date = new Date().toISOString().split('T')[0];
    return `${safeTitle}_${date}.md`;
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString().split('T')[0];
  }

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN');
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  }
}
