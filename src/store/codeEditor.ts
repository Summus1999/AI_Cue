/**
 * 代码编辑器状态管理
 * 管理 Monaco Editor 的状态和配置
 */

import { create } from 'zustand';

export type EditorTheme = 'vs' | 'vs-dark' | 'ai-cue-light' | 'ai-cue-dark';
export type InsertMode = 'replace' | 'append';

interface CodeEditorState {
  // 编辑器显示状态
  showEditor: boolean;
  editorWidth: number;         // 百分比，默认 40
  
  // 编辑器内容
  content: string;
  language: string;
  
  // 编辑器配置
  theme: EditorTheme;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  
  // 代码模式
  codeModeEnabled: boolean;
  codeModeAutoDetect: boolean;  // 是否自动检测代码模式
  
  // 插入模式
  insertMode: InsertMode;
  
  // Actions
  setShowEditor: (show: boolean) => void;
  toggleEditor: () => void;
  setEditorWidth: (width: number) => void;
  setContent: (content: string) => void;
  setLanguage: (language: string) => void;
  setTheme: (theme: EditorTheme) => void;
  setFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setCodeModeAutoDetect: (autoDetect: boolean) => void;
  setInsertMode: (mode: InsertMode) => void;
  insertCode: (code: string, language: string, mode?: InsertMode) => void;
  resetEditor: () => void;
}

const DEFAULT_STATE = {
  showEditor: false,
  editorWidth: 40,
  content: '',
  language: 'javascript',
  theme: 'vs' as EditorTheme,
  fontSize: 13,
  tabSize: 2,
  wordWrap: true,
  codeModeEnabled: false,
  codeModeAutoDetect: true,
  insertMode: 'replace' as InsertMode,
};

export const useCodeEditor = create<CodeEditorState>((set) => ({
  ...DEFAULT_STATE,
  
  setShowEditor: (show) => set({ showEditor: show }),
  
  toggleEditor: () => set((state) => ({ showEditor: !state.showEditor })),
  
  setEditorWidth: (width) => set({ editorWidth: Math.min(80, Math.max(20, width)) }),
  
  setContent: (content) => set({ content }),
  
  setLanguage: (language) => set({ language }),
  
  setTheme: (theme) => set({ theme }),
  
  setFontSize: (fontSize) => set({ fontSize: Math.min(24, Math.max(10, fontSize)) }),
  
  setTabSize: (tabSize) => set({ tabSize: Math.min(8, Math.max(2, tabSize)) }),
  
  setWordWrap: (wordWrap) => set({ wordWrap }),
  
  setCodeModeAutoDetect: (codeModeAutoDetect) => set({ codeModeAutoDetect }),
  
  setInsertMode: (insertMode) => set({ insertMode }),
  
  insertCode: (code, language, mode) => set((state) => {
    const currentMode = mode || state.insertMode;
    const newContent = currentMode === 'replace'
      ? code
      : state.content.trim()
        ? state.content + '\n\n' + code
        : code;
    return {
      content: newContent,
      language,
      showEditor: true,
    };
  }),
  
  resetEditor: () => set(DEFAULT_STATE),
}));
