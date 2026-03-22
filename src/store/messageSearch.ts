/**
 * 消息搜索状态管理
 * 使用 Zustand 管理搜索状态
 */

import { create } from 'zustand';
import { SearchEngine, SearchResult, SearchOptions, MatchRange, Message } from '../services/searchEngine';

// 搜索模式
type SearchMode = 'plain' | 'regex' | 'wholeWord';

interface MessageSearchState {
  // 搜索 UI 状态
  isSearchOpen: boolean;
  
  // 搜索参数
  keyword: string;
  searchMode: SearchMode;
  
  // 搜索结果
  results: SearchResult | null;
  
  // 导航状态
  currentIndex: number;  // 当前焦点在所有匹配中的索引
  
  // 性能优化
  lastSearchTime: number;  // 上次搜索时间戳
  
  // Actions
  openSearch: () => void;
  closeSearch: () => void;
  setKeyword: (keyword: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  executeSearch: (messages: Message[]) => void;
  nextResult: () => void;
  prevResult: () => void;
  goToResult: (index: number) => void;
  clearResults: () => void;
  
  // 获取当前焦点的消息 ID
  getCurrentMessageId: () => string | null;
  
  // 获取指定消息的高亮区间
  getHighlightRanges: (messageId: string, segmentIndex: number) => MatchRange[];
  
  // 判断指定位置是否为当前焦点
  isCurrentHighlight: (messageId: string, segmentIndex: number, rangeIndex: number) => boolean;
}

export const useMessageSearch = create<MessageSearchState>((set, get) => ({
  // 初始状态
  isSearchOpen: false,
  keyword: '',
  searchMode: 'plain',
  results: null,
  currentIndex: 0,
  lastSearchTime: 0,
  
  // 打开搜索
  openSearch: () => set({ 
    isSearchOpen: true,
    // 打开时清空之前的搜索状态
    keyword: '',
    results: null,
    currentIndex: 0,
  }),
  
  // 关闭搜索
  closeSearch: () => set({ 
    isSearchOpen: false,
    // 关闭时清空结果以释放内存
    results: null,
    currentIndex: 0,
  }),
  
  // 设置关键词（不立即搜索，由组件防抖后调用 executeSearch）
  setKeyword: (keyword) => set({ keyword }),
  
  // 设置搜索模式
  setSearchMode: (searchMode) => set({ searchMode }),
  
  // 执行搜索
  executeSearch: (messages) => {
    const { keyword, searchMode } = get();
    
    // 空关键词时清空结果
    if (!keyword.trim()) {
      set({ results: null, currentIndex: 0 });
      return;
    }
    
    // 构建搜索选项
    const options: SearchOptions = {
      caseSensitive: false,
      wholeWord: searchMode === 'wholeWord',
      regex: searchMode === 'regex',
    };
    
    // 执行搜索
    const results = SearchEngine.search(messages, keyword, options);
    
    set({ 
      results,
      currentIndex: 0,  // 重置到第一个结果
      lastSearchTime: Date.now(),
    });
  },
  
  // 下一个结果
  nextResult: () => {
    const { results, currentIndex } = get();
    if (!results || results.totalMatches === 0) return;
    
    const newIndex = (currentIndex + 1) % results.totalMatches;
    set({ currentIndex: newIndex });
  },
  
  // 上一个结果
  prevResult: () => {
    const { results, currentIndex } = get();
    if (!results || results.totalMatches === 0) return;
    
    const newIndex = (currentIndex - 1 + results.totalMatches) % results.totalMatches;
    set({ currentIndex: newIndex });
  },
  
  // 跳转到指定结果
  goToResult: (index) => {
    const { results } = get();
    if (!results || results.totalMatches === 0) return;
    
    const normalizedIndex = Math.max(0, Math.min(index, results.totalMatches - 1));
    set({ currentIndex: normalizedIndex });
  },
  
  // 清空结果
  clearResults: () => set({ 
    results: null, 
    currentIndex: 0,
    keyword: '',
  }),
  
  // 获取当前焦点的消息 ID
  getCurrentMessageId: () => {
    const { results, currentIndex } = get();
    if (!results) return null;
    
    const match = SearchEngine.getMatchAtIndex(results, currentIndex);
    return match?.messageId || null;
  },
  
  // 获取指定消息段的高亮区间
  getHighlightRanges: (messageId, segmentIndex) => {
    const { results } = get();
    if (!results) return [];
    
    return SearchEngine.getHighlightRanges(results, messageId, segmentIndex);
  },
  
  // 判断是否为当前焦点
  isCurrentHighlight: (messageId, segmentIndex, rangeIndex) => {
    const { results, currentIndex } = get();
    if (!results) return false;
    
    const currentMatch = SearchEngine.getMatchAtIndex(results, currentIndex);
    if (!currentMatch) return false;
    
    return currentMatch.messageId === messageId &&
           currentMatch.segmentIndex === segmentIndex &&
           currentMatch.rangeIndex === rangeIndex;
  },
}));
