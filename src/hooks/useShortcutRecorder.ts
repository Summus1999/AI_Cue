// 快捷键录入 Hook - 用于捕获用户按键组合
import { useState, useEffect, useCallback } from 'react';

// 支持的修饰键
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

// 键名映射（用于显示友好名称）
const KEY_DISPLAY_MAP: Record<string, string> = {
  Control: 'Ctrl',
  Meta: 'Win',  // Windows 上 Meta 键是 Win 键
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

// 将 KeyboardEvent 转换为快捷键字符串（Tauri 格式）
function formatShortcut(event: KeyboardEvent): string {
  const parts: string[] = [];
  
  // 添加修饰键（按特定顺序）
  if (event.ctrlKey || event.metaKey) {
    parts.push('CommandOrControl');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  
  // 获取主键
  let key = event.key;
  
  // 忽略单独的修饰键
  if (MODIFIER_KEYS.includes(key)) {
    return '';
  }
  
  // 规范化键名
  if (key.length === 1) {
    key = key.toUpperCase();
  } else if (key === ' ') {
    key = 'Space';
  } else if (key === 'Enter') {
    key = 'Enter';
  } else if (key.startsWith('Arrow')) {
    key = key.replace('Arrow', '');
  } else if (key.startsWith('F') && /^F\d+$/.test(key)) {
    // F1-F12 保持原样
  } else {
    // 首字母大写
    key = key.charAt(0).toUpperCase() + key.slice(1);
  }
  
  parts.push(key);
  
  return parts.join('+');
}

// 将快捷键字符串转换为显示友好格式
export function formatShortcutForDisplay(shortcut: string): string {
  if (!shortcut) return '';
  
  return shortcut
    .replace('CommandOrControl', 'Ctrl')
    .split('+')
    .map(part => KEY_DISPLAY_MAP[part] || part)
    .join(' + ');
}

// Hook 返回类型
interface UseShortcutRecorderReturn {
  // 当前录入的快捷键
  recordedShortcut: string;
  // 是否正在录入
  isRecording: boolean;
  // 开始录入
  startRecording: () => void;
  // 停止录入
  stopRecording: () => void;
  // 重置
  reset: () => void;
  // 错误信息
  error: string | null;
}

/**
 * 快捷键录入 Hook
 * @param onComplete 录入完成回调
 * @param existingShortcuts 已存在的快捷键（用于冲突检测）
 */
export function useShortcutRecorder(
  onComplete?: (shortcut: string) => void,
  existingShortcuts?: string[]
): UseShortcutRecorderReturn {
  const [recordedShortcut, setRecordedShortcut] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    setRecordedShortcut('');
    setError(null);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
  }, []);

  const reset = useCallback(() => {
    setRecordedShortcut('');
    setIsRecording(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      // Escape 取消录入
      if (event.key === 'Escape') {
        setIsRecording(false);
        setRecordedShortcut('');
        setError(null);
        return;
      }
      
      const shortcut = formatShortcut(event);
      
      // 忽略单独的修饰键
      if (!shortcut) return;
      
      // 至少需要一个修饰键
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setError('快捷键需要包含 Ctrl/Alt/Shift 修饰键');
        return;
      }
      
      // 检查冲突
      if (existingShortcuts?.includes(shortcut)) {
        setError('此快捷键已被使用');
        return;
      }
      
      setRecordedShortcut(shortcut);
      setError(null);
      setIsRecording(false);
      
      if (onComplete) {
        onComplete(shortcut);
      }
    };

    // 阻止默认行为
    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [isRecording, existingShortcuts, onComplete]);

  return {
    recordedShortcut,
    isRecording,
    startRecording,
    stopRecording,
    reset,
    error,
  };
}
