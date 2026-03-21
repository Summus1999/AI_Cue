import { invoke } from '@tauri-apps/api/core';

// 面试背景信息
export interface InterviewContext {
  company: string;
  position: string;
  jdHighlights: string;
}

// 扩展现有 Message 类型，增加持久化字段
export interface SessionMessage {
  id?: string;           // UUID
  session_id?: string;   // 会话 ID
  role: 'user' | 'assistant';
  content: string;
  image?: string;        // base64 图片数据
  created_at?: number;   // Unix 时间戳(毫秒)
}

// 会话元数据（增强版）
export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preview?: string;      // 最后一条消息预览（前端计算，不存数据库）
  // 新增元数据字段（可为空，兼容历史数据）
  provider?: string;
  model?: string;
  prompt_template_id?: string;
  prompt_content?: string;
  interview_context?: InterviewContext;
}

// 创建新会话
export async function createSession(): Promise<Session> {
  return await invoke('create_session');
}

// 列出所有会话（按更新时间降序）
export async function listSessions(): Promise<Session[]> {
  return await invoke('list_sessions');
}

// 获取会话的所有消息
export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  return await invoke('get_session_messages', { sessionId });
}

// 保存消息到数据库
export async function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  image?: string,
): Promise<SessionMessage> {
  return await invoke('save_message', { sessionId, role, content, image: image || null });
}

// 更新会话标题
export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  return await invoke('update_session_title', { sessionId, title });
}

// 删除会话及其所有消息
export async function deleteSession(sessionId: string): Promise<void> {
  return await invoke('delete_session', { sessionId });
}

// 搜索会话（按消息内容关键词）
export async function searchSessions(keyword: string): Promise<Session[]> {
  return await invoke('search_sessions', { keyword });
}

// 获取最近活跃的会话
export async function getLastActiveSession(): Promise<Session | null> {
  return await invoke('get_last_active_session');
}
