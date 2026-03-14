/**
 * AI 对话服务 - 调用千问 API 生成回答
 * 通过 Tauri Rust 后端调用，绕过 CORS 限制
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { AppConfig } from '../store/config';
import { PROMPT_TEMPLATES } from '../store/config';

/** 聊天消息结构 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 流式事件 payload */
interface StreamEvent {
  content: string;
  done: boolean;
}

/**
 * 获取系统提示词
 * 根据配置返回预设模板或自定义 prompt
 */
function getSystemPrompt(config: AppConfig): string {
  // 如果是自定义模式，使用用户输入的 prompt
  if (config.promptTemplateId === 'custom') {
    // 如果自定义 prompt 为空，回退到默认模板
    if (config.customPrompt?.trim()) {
      return config.customPrompt;
    }
    return PROMPT_TEMPLATES[0].prompt;
  }
  
  // 查找对应的预设模板
  const template = PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId);
  return template?.prompt || PROMPT_TEMPLATES[0].prompt;
}

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

  // 获取系统提示词
  const systemPrompt = getSystemPrompt(config);

  // 构建消息列表
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
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

/**
 * 流式发送消息给千问 AI 并通过回调获取回答
 * 
 * @param question 用户的问题
 * @param config 应用配置
 * @param onChunk 每次收到新内容时的回调
 * @param history 可选的历史对话记录
 * @returns 清理函数
 */
export async function sendToQwenStream(
  question: string,
  config: AppConfig,
  onChunk: (content: string, done: boolean) => void,
  history: ChatMessage[] = []
): Promise<UnlistenFn> {
  if (!config.apiKey?.trim()) {
    throw new Error('请先在设置中配置 DashScope API Key');
  }

  // 获取系统提示词
  const systemPrompt = getSystemPrompt(config);

  // 构建消息列表
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question }
  ];

  // 用于控制输出速度的队列和定时器
  const charQueue: string[] = [];
  let isProcessing = false;
  let isDone = false;
  const CHAR_DELAY = 30; // 每个字符的延迟(ms)，用于减慢输出速度

  const processQueue = () => {
    if (isProcessing || charQueue.length === 0) {
      if (isDone && charQueue.length === 0) {
        onChunk('', true);
      }
      return;
    }
    
    isProcessing = true;
    const char = charQueue.shift()!;
    onChunk(char, false);
    
    setTimeout(() => {
      isProcessing = false;
      processQueue();
    }, CHAR_DELAY);
  };

  // 监听流式事件
  const unlisten = await listen<StreamEvent>('qwen-stream', (event) => {
    if (event.payload.done) {
      isDone = true;
      if (charQueue.length === 0) {
        onChunk('', true);
      }
    } else if (event.payload.content) {
      // 将内容拆分成单个字符加入队列
      for (const char of event.payload.content) {
        charQueue.push(char);
      }
      processQueue();
    }
  });

  try {
    // 调用 Rust 后端流式接口
    await invoke('qwen_chat_stream', {
      apiKey: config.apiKey,
      model: config.model || 'qwen-turbo',
      messages,
    });
  } catch (error) {
    unlisten();
    throw error;
  }

  return unlisten;
}
