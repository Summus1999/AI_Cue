/**
 * 消息搜索引擎
 * 提供纯函数式的搜索能力，无 UI 依赖
 */
import { createLogger } from './logger';

const log = createLogger('SearchEngine');

// 消息接口（与 App.tsx 中 Message 保持一致）
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isComplete?: boolean;
}

// 内容段接口（与 MessageContent.tsx 中 ContentSegment 一致）
export interface ContentSegment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

// 单个匹配区间
export interface MatchRange {
  start: number;  // 匹配起始位置（相对于段落内容）
  end: number;    // 匹配结束位置
}

// 单条搜索结果
export interface SearchMatch {
  messageId: string;           // 所属消息 ID
  messageIndex: number;        // 消息在列表中的索引
  segmentIndex: number;        // 内容段索引（0=第一个文本/代码段）
  segmentType: 'text' | 'code'; // 段类型
  matchRanges: MatchRange[];    // 该段内所有匹配区间
}

// 搜索结果汇总
export interface SearchResult {
  keyword: string;             // 搜索关键词
  totalMatches: number;        // 总匹配数
  matches: SearchMatch[];       // 所有匹配项
}

// 搜索配置选项
export interface SearchOptions {
  caseSensitive?: boolean;     // 大小写敏感，默认 false
  wholeWord?: boolean;         // 全词匹配，默认 false
  regex?: boolean;             // 正则模式，默认 false
  maxResults?: number;         // 最大结果数，默认无限制
}

/**
 * 搜索引擎核心类
 * 提供纯函数式的搜索能力，无副作用
 */
export class SearchEngine {
  /**
   * 在消息列表中搜索关键词
   * @param messages - 消息列表
   * @param keyword - 搜索关键词
   * @param options - 搜索选项
   * @returns 搜索结果
   */
  static search(
    messages: Message[],
    keyword: string,
    options: SearchOptions = {}
  ): SearchResult {
    // 空关键词直接返回空结果
    if (!keyword || keyword.trim().length === 0) {
      return { keyword: '', totalMatches: 0, matches: [] };
    }

    const {
      caseSensitive = false,
      wholeWord = false,
      regex = false,
      maxResults,
    } = options;

    const matches: SearchMatch[] = [];
    let totalMatches = 0;

    // 构建搜索模式
    const pattern = this.buildPattern(keyword, { caseSensitive, wholeWord, regex });
    if (!pattern) {
      return { keyword, totalMatches: 0, matches: [] };
    }

    // 遍历消息
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex];
      
      // 跳过未完成的流式消息
      if (message.isComplete === false) {
        continue;
      }

      // 解析消息内容为段落
      const segments = this.parseContent(message.content);

      // 遍历段落
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segment = segments[segmentIndex];
        const matchRanges = this.findMatches(segment.content, pattern);

        if (matchRanges.length > 0) {
          matches.push({
            messageId: message.id,
            messageIndex,
            segmentIndex,
            segmentType: segment.type,
            matchRanges,
          });
          totalMatches += matchRanges.length;

          // 检查是否达到最大结果数
          if (maxResults && totalMatches >= maxResults) {
            return { keyword, totalMatches, matches };
          }
        }
      }
    }

    return { keyword, totalMatches, matches };
  }

  /**
   * 构建搜索正则模式
   * @param keyword - 搜索关键词
   * @param options - 搜索选项
   * @returns 正则表达式或 null
   */
  private static buildPattern(
    keyword: string,
    options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  ): RegExp | null {
    try {
      let pattern: string;

      if (options.regex) {
        // 正则模式：直接使用用户输入（需要转义校验）
        pattern = keyword;
      } else {
        // 普通模式：转义正则特殊字符
        pattern = this.escapeRegExp(keyword);
      }

      if (options.wholeWord) {
        // 全词匹配：添加单词边界
        pattern = `\\b${pattern}\\b`;
      }

      const flags = options.caseSensitive ? 'g' : 'gi';
      return new RegExp(pattern, flags);
    } catch (error) {
      // 正则语法错误时返回 null
      log.warn('无效的搜索模式:', error);
      return null;
    }
  }

  /**
   * 转义正则表达式特殊字符
   * @param str - 原始字符串
   * @returns 转义后的字符串
   */
  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 在文本中查找所有匹配
   * @param text - 待搜索文本
   * @param pattern - 搜索模式
   * @returns 匹配区间数组
   */
  private static findMatches(text: string, pattern: RegExp): MatchRange[] {
    const ranges: MatchRange[] = [];
    let match: RegExpExecArray | null;

    // 重置正则状态
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });

      // 防止空匹配导致的无限循环
      if (match[0].length === 0) {
        pattern.lastIndex++;
      }
    }

    return ranges;
  }

  /**
   * 解析消息内容为段落（与 MessageContent.tsx 的 parseContent 保持一致）
   * @param content - 消息原始内容
   * @returns 内容段数组
   */
  static parseContent(content: string): ContentSegment[] {
    const segments: ContentSegment[] = [];
    const codeBlockRegex = /```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;

    for (const match of content.matchAll(codeBlockRegex)) {
      const matchIndex = match.index ?? 0;
      
      // 代码块之前的文本
      if (matchIndex > lastIndex) {
        segments.push({
          type: 'text',
          content: content.slice(lastIndex, matchIndex),
        });
      }

      // 代码块
      segments.push({
        type: 'code',
        language: match[1] || undefined,
        content: match[2].replace(/^\n/, '').replace(/\n$/, ''),
      });

      lastIndex = matchIndex + match[0].length;
    }

    // 最后的文本
    if (lastIndex < content.length) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex),
      });
    }

    return segments.length > 0 ? segments : [{ type: 'text', content }];
  }

  /**
   * 获取指定消息和段落的高亮区间
   * 用于 UI 层按需获取高亮信息
   * @param result - 搜索结果
   * @param messageId - 消息 ID
   * @param segmentIndex - 段索引
   * @returns 匹配区间数组
   */
  static getHighlightRanges(
    result: SearchResult,
    messageId: string,
    segmentIndex: number
  ): MatchRange[] {
    const match = result.matches.find(
      m => m.messageId === messageId && m.segmentIndex === segmentIndex
    );
    return match?.matchRanges || [];
  }

  /**
   * 获取结果中第 N 个匹配的位置信息
   * 用于导航跳转
   * @param result - 搜索结果
   * @param index - 匹配索引（从 0 开始）
   * @returns 匹配位置信息或 null
   */
  static getMatchAtIndex(
    result: SearchResult,
    index: number
  ): { messageId: string; messageIndex: number; segmentIndex: number; rangeIndex: number } | null {
    let currentIndex = 0;

    for (const match of result.matches) {
      for (let rangeIndex = 0; rangeIndex < match.matchRanges.length; rangeIndex++) {
        if (currentIndex === index) {
          return {
            messageId: match.messageId,
            messageIndex: match.messageIndex,
            segmentIndex: match.segmentIndex,
            rangeIndex,
          };
        }
        currentIndex++;
      }
    }

    return null;
  }
}
