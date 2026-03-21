import { ExportData, ExportOptions } from '../../types/export';
import { ExportStrategy, ExportFormat } from './types';

/**
 * PDF 导出器（生成 HTML 中间产物，由 Edge 转换为 PDF）
 */
export class PDFExporter implements ExportStrategy {
  readonly format: ExportFormat = 'pdf';
  readonly fileExtension = '.pdf';  // 最终输出为 PDF 文件
  readonly mimeType = 'application/pdf';

  async export(data: ExportData, options: ExportOptions): Promise<string> {
    return this.generatePrintableHTML(data, options);
  }

  private generatePrintableHTML(data: ExportData, options: ExportOptions): string {
    const styles = `
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        h1 {
          font-size: 24px;
          color: #1a1a1a;
          border-bottom: 2px solid #e0e0e0;
          padding-bottom: 10px;
          margin-bottom: 30px;
        }
        h2 {
          font-size: 16px;
          color: #555;
          margin-top: 30px;
          margin-bottom: 10px;
        }
        .metadata {
          background: #f5f5f5;
          border-left: 4px solid #2196F3;
          padding: 15px 20px;
          margin-bottom: 30px;
          border-radius: 4px;
          font-size: 13px;
          color: #666;
        }
        .metadata-item {
          margin: 5px 0;
        }
        .message {
          margin-bottom: 25px;
          page-break-inside: avoid;
        }
        .message-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
          font-size: 13px;
          color: #888;
        }
        .role-badge {
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
        }
        .role-user {
          background: #e3f2fd;
          color: #1976d2;
        }
        .role-assistant {
          background: #e8f5e9;
          color: #388e3c;
        }
        .message-content {
          background: #fafafa;
          padding: 15px;
          border-radius: 8px;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .message.user .message-content {
          background: #e3f2fd;
        }
        .message.assistant .message-content {
          background: #e8f5e9;
        }
        .screenshot {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          margin-top: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .prompt-section {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e0e0e0;
        }
        .prompt-section h2 {
          color: #666;
        }
        pre {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 4px;
          overflow-x: auto;
          font-size: 13px;
          line-height: 1.4;
        }
        @media print {
          body { padding: 20px; }
          .message { page-break-inside: avoid; }
        }
      </style>
    `;

    // 构建消息 HTML
    const messagesHtml = data.messages.map(msg => {
      const roleClass = msg.role === 'user' ? 'user' : 'assistant';
      const roleLabel = msg.role === 'user' ? '用户' : 'AI';
      const roleBadgeClass = msg.role === 'user' ? 'role-user' : 'role-assistant';
      const timestamp = new Date(msg.timestamp).toLocaleString('zh-CN');

      let contentHtml = msg.content.replace(/\n/g, '<br>');

      // 添加图片
      if (msg.hasImage && options.includeImages && msg.imageData) {
        contentHtml += `<br><img src="data:image/png;base64,${msg.imageData}" class="screenshot" alt="截图">`;
      }

      return `
        <div class="message ${roleClass}">
          <div class="message-header">
            <span class="role-badge ${roleBadgeClass}">${roleLabel}</span>
            <span>${timestamp}</span>
          </div>
          <div class="message-content">${contentHtml}</div>
        </div>
      `;
    }).join('');

    // 构建元数据 HTML
    let metadataHtml = '';
    if (options.includeMetadata) {
      const metaItems: string[] = [];
      metaItems.push(`<div class="metadata-item"><strong>导出时间：</strong>${new Date(data.metadata.exportedAt).toLocaleString('zh-CN')}</div>`);
      metaItems.push(`<div class="metadata-item"><strong>会话创建：</strong>${new Date(data.metadata.createdAt).toLocaleString('zh-CN')}</div>`);
      metaItems.push(`<div class="metadata-item"><strong>消息数量：</strong>${data.metadata.messageCount}</div>`);
      if (data.metadata.provider) {
        metaItems.push(`<div class="metadata-item"><strong>AI 提供商：</strong>${data.metadata.provider}</div>`);
      }
      if (data.metadata.model) {
        metaItems.push(`<div class="metadata-item"><strong>模型：</strong>${data.metadata.model}</div>`);
      }
      metadataHtml = `<div class="metadata">${metaItems.join('')}</div>`;
    }

    // 构建 Prompt 部分
    let promptSection = '';
    if (options.includePromptContent && data.metadata.promptContent) {
      promptSection = `
        <div class="prompt-section">
          <h2>附录：System Prompt</h2>
          <pre>${data.metadata.promptContent}</pre>
        </div>
      `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.metadata.sessionTitle}</title>
    ${styles}
</head>
<body>
    <h1>${data.metadata.sessionTitle}</h1>
    ${metadataHtml}
    ${messagesHtml}
    ${promptSection}
</body>
</html>`;
  }

  getDefaultFileName(sessionTitle: string): string {
    const safeTitle = this.sanitizeFilename(sessionTitle || '未命名会话');
    const date = new Date().toISOString().split('T')[0];
    return `${safeTitle}_${date}.pdf`;  // 直接输出 PDF 文件
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  }
}
