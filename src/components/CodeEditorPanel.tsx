/**
 * 代码编辑器面板组件
 * 集成 Monaco Editor，支持代码编辑、格式化、复制等功能
 */

import React, { Suspense, useCallback, useState, useEffect } from 'react';
import { X, Copy, Check, Wand2, ChevronDown, ArrowDownToLine } from 'lucide-react';
import { useCodeEditor } from '../store/codeEditor';
import { copyService } from '../services/copyService';
import { codeFormatter } from '../services/codeFormatter';
import { EditorSkeleton } from './EditorSkeleton';

// 懒加载 Monaco Editor
const MonacoEditor = React.lazy(() =>
  import('@monaco-editor/react').then(mod => ({ default: mod.Editor }))
);

// 模块级标志，确保主题只注册一次
let themesRegistered = false;

// 支持的语言列表
const SUPPORTED_LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
] as const;

interface CodeEditorPanelProps {
  className?: string;
  onClose?: () => void;
  onInsertToInput?: (code: string, language: string) => void;
}

export function CodeEditorPanel({
  className = '',
  onClose,
  onInsertToInput,
}: CodeEditorPanelProps) {
  const {
    content,
    language,
    theme,
    showEditor,
    setContent,
    setLanguage,
  } = useCodeEditor();
  
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [isFormatting, setIsFormatting] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [editorMounted, setEditorMounted] = useState(false);

  // 复制代码
  const handleCopy = useCallback(async () => {
    const result = await copyService.copyPlainCode(content);
    if (result.success) {
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }, [content]);

  // 格式化代码
  const handleFormat = useCallback(async () => {
    if (!codeFormatter.isSupported(language)) {
      setFormatError(`不支持 ${language} 格式化`);
      setTimeout(() => setFormatError(null), 3000);
      return;
    }
    
    setIsFormatting(true);
    setFormatError(null);
    
    try {
      const formatted = await codeFormatter.format(content, language);
      setContent(formatted);
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : '格式化失败');
      setTimeout(() => setFormatError(null), 3000);
    } finally {
      setIsFormatting(false);
    }
  }, [content, language, setContent]);

  // 插入到输入框
  const handleInsertToInput = useCallback(() => {
    onInsertToInput?.(content, language);
  }, [content, language, onInsertToInput]);

  // 编辑器挂载回调
  const handleEditorDidMount = useCallback(() => {
    setEditorMounted(true);
  }, []);

  // 注册自定义主题（只在首次挂载时注册一次）
  useEffect(() => {
    if (!editorMounted || themesRegistered) return;
    
    // 动态导入 monaco 来注册主题
    import('monaco-editor').then((monaco) => {
      // 防止并发注册
      if (themesRegistered) return;
      themesRegistered = true;
      
      // 咖啡色亮色主题
      monaco.editor.defineTheme('ai-cue-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '78716c' },   // stone-500
          { token: 'keyword', foreground: 'd97706' },   // amber-600
          { token: 'string', foreground: '059669' },    // emerald-600
          { token: 'number', foreground: 'dc2626' },    // red-600
        ],
        colors: {
          'editor.background': '#fffbeb',               // amber-50
          'editor.foreground': '#78350f',               // amber-900
          'editor.lineHighlightBackground': '#fef3c7',  // amber-100
          'editorLineNumber.foreground': '#d97706',     // amber-600
          'editorCursor.foreground': '#b45309',         // amber-700
        },
      });

      // 暗色主题
      monaco.editor.defineTheme('ai-cue-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1c1917',               // stone-900
          'editor.lineHighlightBackground': '#292524',  // stone-800
        },
      });
    });
  }, [editorMounted]);

  if (!showEditor) return null;

  // 获取 Monaco Editor 使用的主题
  const getMonacoTheme = () => {
    if (theme === 'ai-cue-light') return 'ai-cue-light';
    if (theme === 'ai-cue-dark') return 'ai-cue-dark';
    return theme;
  };

  return (
    <div className={`flex flex-col bg-amber-50 border-l border-amber-200 ${className}`}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-100/80 border-b border-amber-200">
        <div className="flex items-center gap-2">
          {/* 语言选择 */}
          <div className="relative">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="appearance-none px-2 py-1 pr-6 text-xs bg-white border border-amber-300 rounded-lg text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              {SUPPORTED_LANGUAGES.map(lang => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-amber-600 pointer-events-none" />
          </div>

          {/* 格式化按钮 */}
          <button
            onClick={handleFormat}
            disabled={isFormatting}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-200 hover:bg-amber-300 disabled:opacity-50 text-amber-800 rounded-lg transition-colors"
            title="格式化代码"
          >
            <Wand2 className={`w-3 h-3 ${isFormatting ? 'animate-spin' : ''}`} />
            格式化
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* 复制按钮 */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-200 hover:bg-amber-300 text-amber-800 rounded-lg transition-colors"
            title="复制代码"
          >
            {copyStatus === 'copied' ? (
              <>
                <Check className="w-3 h-3 text-green-600" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                复制
              </>
            )}
          </button>

          {/* 插入到输入框 */}
          {onInsertToInput && (
            <button
              onClick={handleInsertToInput}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-200 hover:bg-amber-300 text-amber-800 rounded-lg transition-colors"
              title="插入到输入框"
            >
              <ArrowDownToLine className="w-3 h-3" />
              插入
            </button>
          )}

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-200 rounded transition-colors"
            title="关闭编辑器"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 格式化错误提示 */}
      {formatError && (
        <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-b border-red-200">
          {formatError}
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Suspense fallback={<EditorSkeleton />}>
          <MonacoEditor
            value={content}
            language={language}
            theme={getMonacoTheme()}
            onChange={(value) => setContent(value || '')}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              folding: true,
              renderLineHighlight: 'line',
              selectOnLineNumbers: true,
              roundedSelection: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              smoothScrolling: true,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
