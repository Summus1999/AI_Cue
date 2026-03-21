/**
 * 复制服务 - 处理代码复制功能
 * 支持纯代码、Markdown、HTML 格式复制
 */

export type CopyFormat = 'plain' | 'markdown' | 'html';

export interface CopyResult {
  success: boolean;
  format: CopyFormat;
  fallback: boolean;   // 是否使用了降级方案
  error?: string;
}

class CopyService {
  // 复制纯代码（去除所有 Markdown 标记）
  async copyPlainCode(code: string): Promise<CopyResult> {
    const normalizedCode = this.normalizeIndentation(code);
    return this.copyToClipboard(normalizedCode, 'plain');
  }

  // 复制为 Markdown 代码块
  async copyAsMarkdown(code: string, language: string): Promise<CopyResult> {
    const markdown = `\`\`\`${language}\n${code}\n\`\`\``;
    return this.copyToClipboard(markdown, 'markdown');
  }

  // 复制为 HTML（带基础样式）
  async copyAsHtml(code: string, language: string): Promise<CopyResult> {
    const html = `<pre><code class="language-${language}">${this.escapeHtml(code)}</code></pre>`;
    return this.copyToClipboard(html, 'html');
  }

  // 核心复制方法
  private async copyToClipboard(text: string, format: CopyFormat): Promise<CopyResult> {
    // 尝试使用 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return { success: true, format, fallback: false };
      } catch {
        // Clipboard API 失败，尝试降级方案
      }
    }
    
    // 降级方案
    const success = this.fallbackCopy(text);
    return { success, format, fallback: true };
  }

  // 降级方案：使用 textarea + execCommand
  // 注意：Tauri WebView 已内置 Clipboard API，document.execCommand('copy') 已弃用
  // 优先使用 navigator.clipboard.writeText()，此方法仅作为最终回退
  private fallbackCopy(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';
    textarea.setAttribute('readonly', '');
    
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  // 清理代码：去除行首公共缩进
  private normalizeIndentation(code: string): string {
    const lines = code.split('\n');
    
    // 找出最小非空行缩进
    let minIndent = Infinity;
    for (const line of lines) {
      if (line.trim()) {
        const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
        minIndent = Math.min(minIndent, indent);
      }
    }
    
    if (minIndent === Infinity || minIndent === 0) {
      return code;
    }
    
    // 移除公共缩进
    return lines
      .map(line => line.slice(minIndent))
      .join('\n');
  }

  // HTML 转义
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export const copyService = new CopyService();
