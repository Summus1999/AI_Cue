import { ExportData, ExportOptions } from '../../types/export';
import { ExportStrategy, ExportFormat } from './types';

/**
 * JSON 导出器
 */
export class JSONExporter implements ExportStrategy {
  readonly format: ExportFormat = 'json';
  readonly fileExtension = '.json';
  readonly mimeType = 'application/json';

  async export(data: ExportData, options: ExportOptions): Promise<string> {
    const exportObj = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      metadata: {
        session_id: data.metadata.sessionId,
        session_title: data.metadata.sessionTitle,
        exported_at: data.metadata.exportedAt,
        created_at: data.metadata.createdAt,
        updated_at: data.metadata.updatedAt,
        message_count: data.metadata.messageCount,
        provider: data.metadata.provider,
        model: data.metadata.model,
        prompt_template_id: data.metadata.promptTemplateId,
        prompt_template_name: data.metadata.promptTemplateName,
        prompt_content: options.includePromptContent ? data.metadata.promptContent : undefined,
        interview_context: data.metadata.interviewContext,
      },
      messages: data.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        has_image: msg.hasImage,
        image_data: options.includeImages ? msg.imageData : undefined,
      })),
    };

    return JSON.stringify(exportObj, null, 2);
  }

  getDefaultFileName(sessionTitle: string): string {
    const safeTitle = this.sanitizeFilename(sessionTitle);
    const date = new Date().toISOString().split('T')[0];
    return `${safeTitle}_${date}.json`;
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  }
}
