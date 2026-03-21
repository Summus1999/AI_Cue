/**
 * 代码检测服务
 * 检测消息内容是否包含代码，用于自动切换代码模式
 */

export interface CodeBlockInfo {
  content: string;
  language: string;
  startIndex: number;
  endIndex: number;
}

export interface CodeDetectionResult {
  isCodeRelated: boolean;
  confidence: number;        // 0-1
  detectedLanguages: string[];
  codeBlockCount: number;
  codeBlocks: CodeBlockInfo[];
  totalCodeLength: number;
  suggestion: 'code_mode' | 'normal_mode' | 'no_change';
}

class CodeDetector {
  private static instance: CodeDetector;
  
  // 输入长度限制（100KB）
  private static readonly MAX_INPUT_LENGTH = 100 * 1024;
  
  static getInstance(): CodeDetector {
    if (!CodeDetector.instance) {
      CodeDetector.instance = new CodeDetector();
    }
    return CodeDetector.instance;
  }

  // 检测消息中的代码内容
  detect(content: string): CodeDetectionResult {
    // 输入长度限制，超出则截断
    const safeContent = content.length > CodeDetector.MAX_INPUT_LENGTH 
      ? content.slice(0, CodeDetector.MAX_INPUT_LENGTH) 
      : content;
    
    const codeBlocks = this.extractCodeBlocks(safeContent);
    const keywordScore = this.detectCodeKeywords(safeContent);
    const codeRatio = this.calculateCodeRatio(safeContent, codeBlocks);
    
    // 计算综合置信度
    let confidence = 0;
    
    // 规则1：包含代码块 (+0.4)
    if (codeBlocks.length >= 1) confidence += 0.4;
    
    // 规则2：多代码块加分 (+0.2)
    if (codeBlocks.length >= 3) confidence += 0.2;
    
    // 规则3：代码占比 > 50% (+0.2)
    if (codeRatio > 0.5) confidence += 0.2;
    
    // 规则4：代码关键词 (+0.1)
    if (keywordScore > 3) confidence += 0.1;
    
    // 规则5：用户意图关键词 (+0.1)
    if (this.hasUserIntentKeywords(content)) confidence += 0.1;
    
    confidence = Math.min(confidence, 1.0);
    
    return {
      isCodeRelated: confidence >= 0.4,
      confidence,
      detectedLanguages: [...new Set(codeBlocks.map(b => b.language).filter(Boolean))],
      codeBlockCount: codeBlocks.length,
      codeBlocks,
      totalCodeLength: codeBlocks.reduce((sum, b) => sum + b.content.length, 0),
      suggestion: confidence >= 0.6 ? 'code_mode' : 'no_change',
    };
  }

  // 提取代码块
  private extractCodeBlocks(content: string): CodeBlockInfo[] {
    const regex = /```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g;
    const blocks: CodeBlockInfo[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = regex.exec(content)) !== null) {
      blocks.push({
        content: match[2].trim(),
        language: (match[1] || 'plaintext').toLowerCase(),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
    
    return blocks;
  }

  // 检测代码关键词
  private detectCodeKeywords(content: string): number {
    const keywords = [
      'function', 'class', 'const', 'let', 'var', 'import', 'export',
      'def ', 'return', 'if ', 'else', 'for ', 'while',
      'public', 'private', 'static', 'void', 'int ', 'string',
      '=>', '===', '!==', '&&', '||',
    ];
    
    let score = 0;
    const lowerContent = content.toLowerCase();
    
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword)) score++;
    }
    
    return score;
  }

  // 计算代码占比
  private calculateCodeRatio(content: string, blocks: CodeBlockInfo[]): number {
    const totalCodeLength = blocks.reduce((sum, b) => sum + b.content.length, 0);
    return totalCodeLength / Math.max(content.length, 1);
  }

  // 检测用户意图关键词
  private hasUserIntentKeywords(content: string): boolean {
    const intentKeywords = ['代码', '编程', '算法', '函数', '实现', 'code', 'coding', 'algorithm'];
    const lowerContent = content.toLowerCase();
    return intentKeywords.some(k => lowerContent.includes(k));
  }

  // 基于截图 OCR 结果检测
  detectFromScreenshot(ocrText: string): CodeDetectionResult {
    // 截图场景下更宽松的检测
    const result = this.detect(ocrText);
    
    // 截图中如果有代码格式特征，降低阈值
    const hasCodeFormatting = /[{})\[\];]/.test(ocrText) && /\n\s+/.test(ocrText);
    if (hasCodeFormatting && result.confidence < 0.6) {
      result.confidence += 0.2;
      result.suggestion = result.confidence >= 0.6 ? 'code_mode' : 'no_change';
    }
    
    return result;
  }
}

export const codeDetector = CodeDetector.getInstance();
