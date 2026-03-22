// RAG 状态管理

import { create } from 'zustand';
import { ragService, SearchResult, RagStats } from '../services/ragService';

interface RagState {
  // 状态
  isSearching: boolean;
  isEmbedding: boolean;
  searchResults: SearchResult[];
  ragEnabled: boolean;
  embeddingProgress: number;
  stats: RagStats | null;
  error: string | null;
  
  // 操作
  search: (query: string, limit?: number, sessionId?: string) => Promise<void>;
  getContext: (query: string, maxTokens?: number) => Promise<string>;
  embedMessage: (messageId: string, content: string) => Promise<void>;
  getStats: () => Promise<void>;
  clearResults: () => void;
  setEnabled: (enabled: boolean) => void;
  clearError: () => void;
}

export const useRagStore = create<RagState>((set, get) => ({
  // 初始状态
  isSearching: false,
  isEmbedding: false,
  searchResults: [],
  ragEnabled: true,
  embeddingProgress: 0,
  stats: null,
  error: null,
  
  // 语义检索
  search: async (query: string, limit = 10, sessionId?: string) => {
    if (!query.trim()) {
      set({ searchResults: [], error: null });
      return;
    }
    
    set({ isSearching: true, error: null });
    
    try {
      const results = await ragService.search(query, limit, sessionId);
      set({ searchResults: results, isSearching: false });
    } catch (err) {
      const error = err instanceof Error ? err.message : '搜索失败';
      set({ error, isSearching: false });
    }
  },
  
  // 获取 RAG 上下文
  getContext: async (query: string, maxTokens = 2000) => {
    try {
      return await ragService.getContext(query, maxTokens);
    } catch (err) {
      const error = err instanceof Error ? err.message : '获取上下文失败';
      set({ error });
      throw new Error(error);
    }
  },
  
  // 向量化消息
  embedMessage: async (messageId: string, content: string) => {
    set({ isEmbedding: true, error: null });
    
    try {
      await ragService.embedMessage(messageId, content);
      set({ isEmbedding: false, embeddingProgress: 100 });
      // 刷新统计
      get().getStats();
    } catch (err) {
      const error = err instanceof Error ? err.message : '向量化失败';
      set({ error, isEmbedding: false });
    }
  },
  
  // 获取统计信息
  getStats: async () => {
    try {
      const stats = await ragService.getStats();
      set({ stats });
    } catch (err) {
      console.error('获取 RAG 统计失败:', err);
    }
  },
  
  // 清除搜索结果
  clearResults: () => {
    set({ searchResults: [], error: null });
  },
  
  // 设置启用状态
  setEnabled: (enabled: boolean) => {
    set({ ragEnabled: enabled });
  },
  
  // 清除错误
  clearError: () => {
    set({ error: null });
  }
}));

export default useRagStore;
