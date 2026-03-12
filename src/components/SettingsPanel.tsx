// 设置面板组件 - 侧边滑出式设计
import { useState, useEffect } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { loadConfig, saveConfig, QWEN_MODELS, AppConfig, DEFAULT_CONFIG } from '../store/config';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  // 配置状态
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // 下拉框展开状态
  const [openDropdown, setOpenDropdown] = useState<'provider' | 'model' | null>(null);

  // 面板打开时加载配置
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      loadConfig().then((loaded) => {
        setConfig(loaded);
        setIsLoading(false);
      });
      setSaveStatus('idle');
    }
  }, [isOpen]);

  // 保存配置
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveConfig(config);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
        onClose();
      }, 500);
    } catch {
      setSaveStatus('idle');
    }
  };

  // 获取当前选中模型的描述
  const selectedModel = QWEN_MODELS.find(m => m.id === config.model);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex justify-end">
      {/* 遮罩层 - 点击关闭 */}
      <div 
        className="absolute inset-0 bg-black/20 transition-opacity"
        onClick={onClose}
      />
      
      {/* 滑出面板 */}
      <div 
        className="relative h-full w-[280px] bg-slate-900/95 backdrop-blur-md border-l border-cyan-900/30 shadow-2xl animate-slide-in"
        style={{
          animation: 'slideIn 200ms ease-out forwards'
        }}
      >
        {/* 面板标题栏 */}
        <div className="flex items-center justify-between h-10 px-4 border-b border-cyan-900/20">
          <span className="text-sm font-medium text-cyan-100">设置</span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-cyan-900/20 transition-colors"
          >
            <X className="w-4 h-4 text-cyan-400/60" />
          </button>
        </div>

        {/* 设置内容 */}
        <div className="p-4 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* AI Provider 选择 */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-cyan-400/70 uppercase tracking-wider">
                  AI 模型
                </label>
                <div className="relative">
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'provider' ? null : 'provider')}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/50 border border-cyan-900/20 rounded-lg text-sm text-cyan-100 hover:border-cyan-700/30 transition-colors"
                  >
                    <span>千问 (Qwen)</span>
                    <ChevronDown className={`w-4 h-4 text-cyan-400/50 transition-transform ${openDropdown === 'provider' ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {/* Provider 下拉菜单 */}
                  {openDropdown === 'provider' && (
                    <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-slate-800 border border-cyan-900/20 rounded-lg shadow-lg z-10">
                      <div className="px-3 py-2 text-sm text-cyan-100 flex items-center gap-2 bg-cyan-900/20">
                        <Check className="w-4 h-4 text-cyan-400" />
                        <span>千问 (Qwen)</span>
                      </div>
                      <div className="px-3 py-2 text-xs text-cyan-400/40 border-t border-cyan-900/10 mt-1 pt-1">
                        更多模型即将支持
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 模型版本选择 */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-cyan-400/70 uppercase tracking-wider">
                  模型版本
                </label>
                <div className="relative">
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'model' ? null : 'model')}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/50 border border-cyan-900/20 rounded-lg text-sm text-cyan-100 hover:border-cyan-700/30 transition-colors"
                  >
                    <span>{selectedModel?.name || config.model}</span>
                    <ChevronDown className={`w-4 h-4 text-cyan-400/50 transition-transform ${openDropdown === 'model' ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {/* Model 下拉菜单 */}
                  {openDropdown === 'model' && (
                    <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-slate-800 border border-cyan-900/20 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto scrollbar-hide">
                      {QWEN_MODELS.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            setConfig(prev => ({ ...prev, model: model.id }));
                            setOpenDropdown(null);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                            config.model === model.id 
                              ? 'bg-cyan-900/20 text-cyan-100' 
                              : 'text-cyan-100/80 hover:bg-slate-700/50'
                          }`}
                        >
                          {config.model === model.id && <Check className="w-4 h-4 text-cyan-400" />}
                          <span className={config.model === model.id ? '' : 'pl-6'}>{model.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* 模型描述 */}
                {selectedModel && (
                  <p className="text-xs text-cyan-400/50 leading-relaxed">
                    {selectedModel.description}
                  </p>
                )}
              </div>

              {/* API Key 设置（可选） */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-cyan-400/70 uppercase tracking-wider">
                  API Key（可选）
                </label>
                <input
                  type="password"
                  value={config.apiKey || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="使用默认 Key 请留空"
                  className="w-full px-3 py-2.5 bg-slate-800/50 border border-cyan-900/20 rounded-lg text-sm text-cyan-100 placeholder:text-cyan-600/40 focus:outline-none focus:border-cyan-500/30 transition-colors"
                />
                <p className="text-[10px] text-cyan-400/40">
                  如需使用自己的阿里云 DashScope API Key，请在此输入
                </p>
              </div>
            </>
          )}
        </div>

        {/* 底部保存按钮 */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-cyan-900/20 bg-slate-900/95 backdrop-blur-md">
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              saveStatus === 'saved'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-cyan-500/10 text-cyan-400 border border-cyan-900/30 hover:bg-cyan-500/20'
            }`}
          >
            {saveStatus === 'saving' ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
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

      {/* 滑入动画样式 */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
