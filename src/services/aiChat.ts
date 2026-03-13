/**
 * AI 对话服务 - 调用千问 API 生成回答
 * 通过 Tauri Rust 后端调用，绕过 CORS 限制
 */

import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '../store/config';

/** 聊天消息结构 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 面试助手系统提示词 */
const SYSTEM_PROMPT = `你是一个专业的面试助手。用户会向你提供面试官的问题，你需要：
1. 理解问题的核心考察点
2. 给出清晰、有条理的回答要点
3. 回答应简洁有力，突出重点
4. 如果是技术问题，给出准确的技术解答
5. 如果是行为面试问题，使用 STAR 法则组织回答

请用中文回答，保持专业但友好的语气。`;

/**
 * 发送消息给千问 AI 并获取回答
 * 
 * @param question 用户的问题（面试官的问题）
 * @param config 应用配置（包含 API Key 和模型选择）
 * @param history 可选的历史对话记录
 * @returns AI 的回答
 */
export async function sendToQwen(
  question: string,
  config: AppConfig,
  history: ChatMessage[] = []
): Promise<string> {
  if (!config.apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  // 构建消息列表
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: question }
  ];

  // 调用 Rust 后端
  const result = await invoke<string>('qwen_chat', {
    apiKey: config.apiKey,
    model: config.model || 'qwen-turbo',
    messages,
  });

  return result;
}
