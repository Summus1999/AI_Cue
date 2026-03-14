// 快捷键设置面板组件
import { useState, useEffect } from 'react';
import { ArrowLeft, Edit3, Check, RotateCcw, AlertCircle } from 'lucide-react';
import { ShortcutConfig, DEFAULT_SHORTCUT_CONFIG, SHORTCUT_LABELS, loadConfig, saveConfig } from '../store/config';
import { useShortcutRecorder, formatShortcutForDisplay } from '../hooks/useShortcutRecorder';
import { updateShortcuts } from '../services/shortcutManager';

interface ShortcutSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutSettingsPanel({ isOpen, onClose }: ShortcutSettingsPanelProps) {
  // 快捷键配置状态
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUT_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // 当前编辑的快捷键
  const [editingKey, setEditingKey] = useState<keyof ShortcutConfig | null>(null);
  
  // 快捷键录入 Hook
  const {
    isRecording,
    startRecording,
    error: recorderError,
  } = useShortcutRecorder(
    (newShortcut) => {
      if (editingKey) {
        setShortcuts(prev => ({ ...prev, [editingKey]: newShortcut }));
        setEditingKey(null);
      }
    },
    // 排除当前正在编辑的快捷键，用于冲突检测
    Object.entries(shortcuts)
      .filter(([key]) => key !== editingKey)
      .map(([, value]) => value)
  );

  // 加载配置
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      loadConfig().then((config) => {
        setShortcuts(config.shortcutConfig);
        setIsLoading(false);
      });
      setSaveStatus('idle');
      setErrorMessage('');
      setEditingKey(null);
    }
  }, [isOpen]);

  // 开始编辑某个快捷键
  const handleEdit = (key: keyof ShortcutConfig) => {
    setEditingKey(key);
    startRecording();
  };

  // 恢复默认
  const handleResetToDefault = () => {
    setShortcuts(DEFAULT_SHORTCUT_CONFIG);
  };

  // 保存配置
  const handleSave = async () => {
    setSaveStatus('saving');
    setErrorMessage('');
    
    try {
      const config = await loadConfig();
      config.shortcutConfig = shortcuts;
      await saveConfig(config);
      
      // 更新全局快捷键
      await updateShortcuts(shortcuts);
      
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
        onClose();
      }, 500);
    } catch (err) {
      console.error('保存快捷键失败:', err);
      setSaveStatus('error');
      setErrorMessage('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      {/* 标题栏 - 支持拖拽 */}
      <div
        data-tauri-drag-region
        className="flex-shrink-0 flex items-center justify-between h-10 px-4 bg-amber-100/80 border-b border-amber-200 select-none"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700" />
          </button>
          <span className="text-xs font-medium text-amber-800 tracking-wide">快捷键设置</span>
        </div>
      </div>

      {/* 设置内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* 快捷键列表 */}
            <div className="space-y-4">
              {(Object.keys(shortcuts) as Array<keyof ShortcutConfig>).map((key) => (
                <div key={key} className="space-y-2">
                  <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                    {SHORTCUT_LABELS[key]}
                  </label>
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex-1 flex items-center justify-between px-3 py-2.5 bg-white/80 border rounded-lg text-sm ${
                        editingKey === key && isRecording
                          ? 'border-amber-500 ring-2 ring-amber-200'
                          : 'border-amber-300'
                      }`}
                    >
                      <span className={`font-mono ${editingKey === key && isRecording ? 'text-amber-500' : 'text-amber-900'}`}>
                        {editingKey === key && isRecording
                          ? '按下快捷键...'
                          : formatShortcutForDisplay(shortcuts[key])}
                      </span>
                    </div>
                    <button
                      onClick={() => handleEdit(key)}
                      disabled={isRecording && editingKey !== key}
                      className={`flex items-center justify-center w-10 h-10 rounded-lg border transition-colors ${
                        editingKey === key && isRecording
                          ? 'bg-amber-500 text-white border-amber-600'
                          : 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                      title="编辑快捷键"
                    >
                      {editingKey === key && isRecording ? (
                        <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Edit3 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 录入提示 */}
            <div className="text-xs text-amber-600 bg-amber-100/50 rounded-lg px-3 py-2">
              {isRecording ? (
                <span className="text-amber-700">请按下新的快捷键组合，按 Esc 取消</span>
              ) : (
                <span>点击编辑按钮后按下新的快捷键组合</span>
              )}
            </div>

            {/* 录入错误提示 */}
            {recorderError && (
              <div className="flex items-start gap-2 text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{recorderError}</span>
              </div>
            )}

            {/* 恢复默认按钮 */}
            <button
              onClick={handleResetToDefault}
              className="flex items-center gap-2 text-xs text-amber-600 hover:text-amber-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复默认快捷键</span>
            </button>

            {/* 错误提示 */}
            {saveStatus === 'error' && errorMessage && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMessage}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部保存按钮 */}
      <div className="flex-shrink-0 p-4 border-t border-amber-200 bg-amber-100/50">
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving' || isRecording}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
            saveStatus === 'saved'
              ? 'bg-green-100 text-green-700 border border-green-300'
              : saveStatus === 'error'
              ? 'bg-red-100 text-red-600 border border-red-300'
              : 'bg-amber-600 text-white border border-amber-700 hover:bg-amber-700 disabled:opacity-50'
          }`}
        >
          {saveStatus === 'saving' ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              保存中...
            </span>
          ) : saveStatus === 'saved' ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              已保存
            </span>
          ) : (
            '保存设置'
          )}
        </button>
      </div>
    </div>
  );
}
