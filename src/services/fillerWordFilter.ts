/**
 * 填充词识别与过滤服务
 * 用于过滤语音识别结果中的无意义填充词（如"嗯"、"那个"、"就是"等）
 * 仅在技术专家模式 (promptTemplateId === 'tech') 时生效
 */

import type { AppConfig } from '../store/config';

// ============== 类型定义 ==============

/**
 * 填充词匹配规则
 */
interface FillerWordRule {
  /** 匹配模式（正则表达式） */
  pattern: RegExp;
  /** 匹配类型 */
  type: 'exact' | 'contextual';
  /** 优先级（数值越大越先处理） */
  priority: number;
  /** 规则描述（调试用） */
  description?: string;
}

/**
 * 过滤器配置
 */
interface FilterConfig {
  /** 是否启用过滤 */
  enabled: boolean;
  /** 过滤规则集 */
  rules: FillerWordRule[];
  /** 是否保留原文（用于调试） */
  preserveOriginal?: boolean;
}

/**
 * 过滤结果
 */
export interface FilterResult {
  /** 过滤后文本 */
  filtered: string;
  /** 原始文本 */
  original: string;
  /** 被移除的词列表 */
  removedWords: string[];
  /** 是否实际应用了过滤 */
  filterApplied: boolean;
}

/**
 * 扩展的识别结果
 */
export interface RecognitionResult {
  /** 识别文本 */
  text: string;
  /** 过滤信息（如果有） */
  filterResult?: FilterResult;
}

// ============== 核心类 ==============

class FillerWordFilter {
  private rules: FillerWordRule[];

  constructor(customRules?: FillerWordRule[]) {
    this.rules = customRules || this.getDefaultRules();
    // 按优先级排序
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 过滤文本中的填充词
   */
  filter(text: string, config: FilterConfig): FilterResult {
    if (!config.enabled || !text.trim()) {
      return {
        filtered: text,
        original: text,
        removedWords: [],
        filterApplied: false,
      };
    }

    // 1. 合并规则：自定义规则优先
    const activeRules = config.rules?.length
      ? [...config.rules, ...this.rules]
      : this.rules;

    // 2. 执行规则匹配（按优先级排序）
    let result = text;
    const removedWords: string[] = [];

    for (const rule of activeRules.sort((a, b) => b.priority - a.priority)) {
      const matches = result.match(rule.pattern);
      if (matches) {
        removedWords.push(...matches);
        result = result.replace(rule.pattern, '');
      }
    }

    // 3. 后处理：清理多余空格
    result = this.cleanSpaces(result);

    // 4. 安全检查：过滤后不能为空
    if (!result.trim()) {
      return {
        filtered: text,
        original: text,
        removedWords: [],
        filterApplied: false,
      };
    }

    return {
      filtered: result,
      original: config.preserveOriginal ? text : '',
      removedWords: [...new Set(removedWords)],
      filterApplied: removedWords.length > 0,
    };
  }

  /**
   * 默认中文填充词规则集
   */
  private getDefaultRules(): FillerWordRule[] {
    return [
      // 精确匹配：独立的语气词
      {
        pattern: /(?<=[。，！？\s]|^)[嗯恩唔][嗯恩唔]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '独立语气词：嗯、恩、唔',
      },
      {
        pattern: /(?<=[。，！？\s]|^)[啊呀哦哇嘿][啊呀哦哇嘿]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '独立感叹词',
      },
      {
        pattern: /(?<=[。，！？\s]|^)[呃额][呃额]*(?=[。，！？\s]|$)/g,
        type: 'exact',
        priority: 100,
        description: '犹豫词：呃、额',
      },
      // 上下文匹配：句首填充短语
      {
        pattern: /(?<=[。！？]|^)\s*那个[，,]?\s*/g,
        type: 'contextual',
        priority: 80,
        description: '句首"那个"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*这个[，,]?\s*/g,
        type: 'contextual',
        priority: 80,
        description: '句首"这个"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*就是说?[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"就是/就是说"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*然后[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"然后"',
      },
      {
        pattern: /(?<=[。！？]|^)\s*所以说?[，,]?\s*/g,
        type: 'contextual',
        priority: 70,
        description: '句首"所以/所以说"',
      },
      // 句尾填充
      {
        pattern: /[，,]?\s*对吧[。？]?\s*$/g,
        type: 'contextual',
        priority: 60,
        description: '句尾"对吧"',
      },
      {
        pattern: /[，,]?\s*是吧[。？]?\s*$/g,
        type: 'contextual',
        priority: 60,
        description: '句尾"是吧"',
      },
      // 连续语气词
      {
        pattern: /嗯{2,}/g,
        type: 'exact',
        priority: 90,
        description: '连续"嗯"',
      },
      {
        pattern: /啊{2,}/g,
        type: 'exact',
        priority: 90,
        description: '连续"啊"',
      },
      {
        pattern: /呃{2,}/g,
        type: 'exact',
        priority: 90,
        description: '连续"呃"',
      },
      // 混合填充
      {
        pattern: /那个{2,}/g,
        type: 'exact',
        priority: 85,
        description: '连续"那个"',
      },
    ];
  }

  /**
   * 清理多余空格和标点
   */
  private cleanSpaces(text: string): string {
    return text
      .replace(/\s+/g, ' ') // 合并多余空格
      .replace(/^[，,。！？\s]+/g, '') // 清理句首无意义标点
      .replace(/[，,]{2,}/g, '，') // 合并连续逗号
      .trim();
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: FillerWordRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 从字符串数组创建精确匹配规则
   */
  addExactWords(words: string[], priority = 50): void {
    // 转义特殊正则字符
    const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(
      `(?<=[。，！？\\s]|^)(${escapedWords.join('|')})(?=[。，！？\\s]|$)`,
      'g'
    );
    this.addRule({
      pattern,
      type: 'exact',
      priority,
      description: `自定义词汇: ${words.join(', ')}`,
    });
  }

  /**
   * 获取当前规则数量
   */
  getRuleCount(): number {
    return this.rules.length;
  }
}

// ============== 导出函数 ==============

/**
 * 根据配置判断是否应启用填充词过滤
 */
export function shouldEnableFilter(config: AppConfig): boolean {
  const filterCfg = config.fillerWordFilter;
  if (!filterCfg?.enabled) return false;

  // 若配置了白名单模板，则按白名单判断
  if (filterCfg.enabledTemplates?.length) {
    return filterCfg.enabledTemplates.includes(config.promptTemplateId);
  }

  // 默认策略：仅 tech 模式
  return config.promptTemplateId === 'tech';
}

/**
 * 创建带配置的过滤器实例
 */
export function createFilter(config: AppConfig): FillerWordFilter {
  const filter = new FillerWordFilter();

  // 添加用户自定义填充词
  if (config.fillerWordFilter?.customWords?.length) {
    filter.addExactWords(config.fillerWordFilter.customWords);
  }

  return filter;
}

/**
 * 过滤文本中的填充词
 */
export function filterFillerWords(
  text: string,
  config: AppConfig,
  options?: { preserveOriginal?: boolean }
): FilterResult {
  if (!shouldEnableFilter(config)) {
    return {
      filtered: text,
      original: text,
      removedWords: [],
      filterApplied: false,
    };
  }

  const filter = createFilter(config);
  return filter.filter(text, {
    enabled: true,
    rules: [],
    preserveOriginal: options?.preserveOriginal,
  });
}

// ============== 导出 ==============

export type { FillerWordRule, FilterConfig };
export { FillerWordFilter };
