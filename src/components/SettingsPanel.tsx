// 设置面板组件 - 全页面进出式设计
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, ChevronDown, Check, AlertCircle, FolderOpen } from 'lucide-react';
import { setWindowOpacity, enableHoverRestore } from '../services/windowManager';
import { ProviderSelector } from './ProviderSelector';
import { loadConfig, saveConfig, NLS_REGIONS, PROMPT_TEMPLATES, AppConfig, DEFAULT_CONFIG, validateConfig, ProviderType, ProviderConfig, PromptMode } from '../store/config';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  // 配置状态
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // 下拉框展开状态
  const [isNlsRegionDropdownOpen, setIsNlsRegionDropdownOpen] = useState(false);
  const [isPromptDropdownOpen, setIsPromptDropdownOpen] = useState(false);

  // 面板打开时加载配置
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      loadConfig().then((loaded) => {
        setConfig(loaded);
        setIsLoading(false);
      });
      setSaveStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen]);

  // 保存配置
  const handleSave = async () => {
    // 验证配置
    const validation = validateConfig(config);
    if (!validation.valid) {
      setSaveStatus('error');
      setErrorMessage(validation.message || '配置无效');
      return;
    }

    setSaveStatus('saving');
    setErrorMessage('');
    try {
      await saveConfig(config);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
        onClose();
      }, 500);
    } catch (err) {
      console.error('保存失败详情:', err);
      setSaveStatus('error');
      setErrorMessage('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 处理 Provider 切换
  const handleProviderChange = (newProvider: ProviderType) => {
    setConfig(prev => ({
      ...prev,
      activeProvider: newProvider,
    }));
    if (errorMessage) setErrorMessage('');
  };

  // 处理 Provider 配置变更
  const handleProviderConfigChange = (newConfig: ProviderConfig) => {
    setConfig(prev => ({
      ...prev,
      providerConfigs: {
        ...prev.providerConfigs,
        [prev.activeProvider]: newConfig,
      },
    }));
    if (errorMessage) setErrorMessage('');
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col w-full h-full bg-amber-50 text-amber-900 overflow-hidden rounded-2xl">
      {/* 标题栏 - 支持拖拽 */}
      <div
        data-tauri-drag-region
        className="flex-shrink-0 flex items-center justify-between h-10 px-4 bg-amber-100/80 border-b border-amber-200 select-none"
      >
        {/* 返回按钮 + 标题 */}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700" />
          </button>
          <span className="text-xs font-medium text-amber-800 tracking-wide">设置</span>
        </div>
      </div>

      {/* 设置内容 - 可滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* AI Provider 选择（新增） */}
            <ProviderSelector
              activeProvider={config.activeProvider}
              providerConfig={config.providerConfigs[config.activeProvider]}
              onProviderChange={handleProviderChange}
              onConfigChange={handleProviderConfigChange}
            />

            {/* 分隔线 */}
            <div className="border-t border-amber-200" />

            {/* Prompt 设置 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                Prompt 设置
              </label>
              
              {/* 模板选择下拉框 */}
              <div className="relative">
                <button
                  onClick={() => setIsPromptDropdownOpen(!isPromptDropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 hover:border-amber-400 transition-colors"
                >
                  <span>{PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId)?.name || '通用面试助手'}</span>
                  <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isPromptDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Prompt 模板下拉菜单 */}
                {isPromptDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border border-amber-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto scrollbar-hide">
                    {PROMPT_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => {
                          setConfig(prev => ({ ...prev, promptTemplateId: template.id }));
                          setIsPromptDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                          config.promptTemplateId === template.id 
                            ? 'bg-amber-100 text-amber-900' 
                            : 'text-amber-800 hover:bg-amber-50'
                        }`}
                      >
                        {config.promptTemplateId === template.id && <Check className="w-4 h-4 text-amber-600" />}
                        <span className={config.promptTemplateId === template.id ? '' : 'pl-6'}>{template.name}</span>
                        {template.id !== 'custom' && (
                          template.mode === 'interviewer' ? (
                            <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-amber-600/20 text-amber-700 font-medium">面试官</span>
                          ) : (
                            <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-500">助手</span>
                          )
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* 模板描述 */}
              {config.promptTemplateId !== 'custom' && (
                <div className="space-y-1.5">
                  <p className="text-xs text-amber-600 leading-relaxed">
                    {PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId)?.description}
                  </p>
                  {PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId)?.mode === 'interviewer' && (
                    <p className="text-xs text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
                      💡 AI 将作为面试官向你提问，面试结束后可生成复盘报告
                    </p>
                  )}
                </div>
              )}
              
              {/* 自定义 Prompt 输入框 */}
              {config.promptTemplateId === 'custom' && (
                <div className="space-y-2">
                  {/* 面试官模式切换开关 */}
                  <div className="flex items-center justify-between py-2 px-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="text-sm text-amber-800">
                      启用面试官模式（AI提问，你回答）
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const newMode: PromptMode = config.customPromptMode === 'interviewer' ? 'assistant' : 'interviewer';
                        setConfig(prev => ({ ...prev, customPromptMode: newMode }));
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                        config.customPromptMode === 'interviewer' ? 'bg-amber-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                          config.customPromptMode === 'interviewer' ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  {config.customPromptMode === 'interviewer' && (
                    <p className="text-xs text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
                      💡 AI 将作为面试官向你提问，面试结束后可生成复盘报告
                    </p>
                  )}
                  <textarea
                    value={config.customPrompt}
                    onChange={(e) => setConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="描述你希望AI如何帮助你回答面试问题..."
                    rows={6}
                    className="w-full px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors resize-none"
                  />
                  <p className="text-[10px] text-amber-600">
                    自定义提示词帮助AI更好地理解你的面试场景和需求
                  </p>
                </div>
              )}
            </div>

            {/* 分隔线 */}
            <div className="border-t border-amber-200" />

            {/* 对话上下文设置 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                对话上下文
              </label>
              
              {/* 上下文轮数设置 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-amber-800">上下文轮数</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConfig(prev => ({ 
                        ...prev, 
                        contextWindowSize: Math.max(0, (prev.contextWindowSize ?? 5) - 1) 
                      }))}
                      className="w-7 h-7 flex items-center justify-center bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition-colors"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={config.contextWindowSize ?? 5}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        setConfig(prev => ({ 
                          ...prev, 
                          contextWindowSize: Math.max(0, Math.min(40, isNaN(value) ? 5 : value))
                        }));
                      }}
                      className="w-14 px-2 py-1 text-center bg-white/80 border border-amber-300 rounded text-sm text-amber-900"
                    />
                    <button
                      onClick={() => setConfig(prev => ({ 
                        ...prev, 
                        contextWindowSize: Math.min(40, (prev.contextWindowSize ?? 5) + 1) 
                      }))}
                      className="w-7 h-7 flex items-center justify-center bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="text-xs text-amber-600">
                  每次发送消息时携带最近 {(config.contextWindowSize ?? 5)} 轮对话历史（范围：0-40，0 表示不传递历史）
                </p>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-amber-200" />

            {/* NLS 语音识别配置 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                语音识别（NLS）
              </label>
              <div className="space-y-2">
                <input
                  type="text"
                  value={config.nlsAppKey}
                  onChange={(e) => setConfig(prev => ({ ...prev, nlsAppKey: e.target.value }))}
                  placeholder="Appkey"
                  className="w-full px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={config.nlsAccessKeyId}
                  onChange={(e) => setConfig(prev => ({ ...prev, nlsAccessKeyId: e.target.value }))}
                  placeholder="AccessKey ID"
                  className="w-full px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="password"
                  value={config.nlsAccessKeySecret}
                  onChange={(e) => setConfig(prev => ({ ...prev, nlsAccessKeySecret: e.target.value }))}
                  placeholder="AccessKey Secret"
                  className="w-full px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500"
                />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsNlsRegionDropdownOpen(!isNlsRegionDropdownOpen)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 hover:border-amber-400"
                  >
                    <span>{NLS_REGIONS.find(r => r.id === config.nlsRegion)?.name || config.nlsRegion}</span>
                    <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isNlsRegionDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isNlsRegionDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border border-amber-200 rounded-lg shadow-lg z-10">
                      {NLS_REGIONS.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setConfig(prev => ({ ...prev, nlsRegion: r.id }));
                            setIsNlsRegionDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                            config.nlsRegion === r.id ? 'bg-amber-100 text-amber-900' : 'text-amber-800 hover:bg-amber-50'
                          }`}
                        >
                          {config.nlsRegion === r.id && <Check className="w-4 h-4 text-amber-600" />}
                          <span className={config.nlsRegion === r.id ? '' : 'pl-6'}>{r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-amber-600">
                智能语音交互控制台获取 Appkey，RAM 获取 AccessKey
              </p>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-amber-200" />

            {/* 本地题解文档 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                本地题解文档（Markdown）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.localDocPath}
                  onChange={(e) => setConfig(prev => ({ ...prev, localDocPath: e.target.value }))}
                  placeholder="本地 .md 文件路径，支持 ## 到 ###### 的题号标题，如 #### 16.最接近的三数之和"
                  className="flex-1 px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const selected = await open({
                      multiple: false,
                      directory: false,
                      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
                    });
                    if (selected && typeof selected === 'string') {
                      setConfig(prev => ({ ...prev, localDocPath: selected }));
                    }
                  }}
                  className="flex-shrink-0 px-3 py-2.5 bg-amber-200/80 border border-amber-300 rounded-lg text-sm text-amber-800 hover:bg-amber-300/80 transition-colors flex items-center gap-1.5"
                  title="选择文件"
                >
                  <FolderOpen className="w-4 h-4" />
                  选择
                </button>
              </div>
              <p className="text-[10px] text-amber-600">
                优先在本地文档中按题号检索；支持 `##` 到 `######` 标题，命中后直接使用文档代码，仅生成说明
              </p>
            </div>

            {/* 高质量题解仓库 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                高质量题解仓库（GitHub）
              </label>
              <textarea
                value={config.highQualityRepoUrls}
                onChange={(e) => setConfig(prev => ({ ...prev, highQualityRepoUrls: e.target.value }))}
                placeholder={"每行一个 GitHub 仓库 URL，例如：\nhttps://github.com/doocs/leetcode\nhttps://github.com/wisdompeak/LeetCode"}
                rows={5}
                className="w-full px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors resize-none"
              />
              <p className="text-[10px] text-amber-600">
                仅会在你填写的仓库中抓取题解内容；每行一个 URL
              </p>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-amber-200" />

            {/* 语音识别阈值设置 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                语音识别阈值
              </label>
              
              {/* 滑块控件 */}
              <div 
                className="px-1"
                style={{ '--threshold-percent': `${config.speechThreshold}%` } as React.CSSProperties}
              >
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={config.speechThreshold}
                  onChange={(e) => {
                    setConfig(prev => ({ ...prev, speechThreshold: parseInt(e.target.value, 10) }));
                  }}
                  className="threshold-slider"
                />
              </div>
              
              {/* 数值显示和场景标签 */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-900 font-mono">
                  {config.speechThreshold}%
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  config.speechThreshold <= 30 
                    ? 'bg-green-500/10 text-green-400' 
                    : config.speechThreshold <= 60 
                      ? 'bg-yellow-500/10 text-yellow-400' 
                      : 'bg-red-500/10 text-red-400'
                }`}>
                  {config.speechThreshold <= 30 ? '低' : config.speechThreshold <= 60 ? '中' : '高'}
                </span>
              </div>
              
              {/* 说明文字 */}
              <p className="text-xs text-amber-600 leading-relaxed">
                {config.speechThreshold <= 30 
                  ? '低阈值：容易触发识别，适合安静环境' 
                  : config.speechThreshold <= 60 
                    ? '中阈值：平衡灵敏度与准确性，推荐' 
                    : '高阈值：需较大音量触发，适合嘈杂环境'}
              </p>
            </div>

            {/* 窗口外观设置 */}
            <div className="space-y-3 pt-3 border-t border-amber-200">
              <h3 className="text-sm font-semibold text-amber-800">窗口外观</h3>
              
              {/* 透明度滑块 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-amber-700">窗口透明度</label>
                  <span className="text-xs font-mono text-amber-600">{Math.round(config.window.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  step="5"
                  value={Math.round(config.window.opacity * 100)}
                  onChange={(e) => {
                    const percent = Number(e.target.value);
                    const opacity = percent / 100;
                    // 更新 CSS 变量用于滑块背景填充
                    e.target.style.setProperty('--opacity-percent', `${percent}%`);
                    // 实时预览
                    setWindowOpacity(opacity);
                    // 更新配置状态
                    setConfig(prev => ({ ...prev, window: { ...prev.window, opacity } }));
                  }}
                  className="opacity-slider w-full"
                  style={{ '--opacity-percent': `${Math.round(config.window.opacity * 100)}%` } as React.CSSProperties}
                />
                <div className="flex justify-between text-[10px] text-amber-500">
                  <span>20%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* 悬停恢复开关 - iOS 风格 */}
              <div className="flex items-center justify-between mt-4">
                <div>
                  <label className="text-xs font-medium text-amber-700">鼠标悬停恢复不透明</label>
                  <p className="text-[10px] text-amber-500 mt-0.5">鼠标移入窗口时自动恢复为完全不透明</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newEnabled = !config.window?.hoverRestore?.enabled;
                    setConfig(prev => ({
                      ...prev,
                      window: {
                        ...prev.window,
                        hoverRestore: { enabled: newEnabled }
                      }
                    }));
                    // 实时生效
                    enableHoverRestore(newEnabled, config.window?.opacity ?? 0.8);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ease-in-out ${
                    config.window?.hoverRestore?.enabled ? 'bg-amber-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-md ${
                      config.window?.hoverRestore?.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                    style={{
                      transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
                    }}
                  />
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {saveStatus === 'error' && errorMessage && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMessage}</span>
              </div>
            )}
            
            {/* 调试信息 */}
            <div className="text-[10px] text-amber-500 pt-4">
              提示: 按 F12 打开控制台查看详细日志
            </div>
          </>
        )}
      </div>

      {/* 底部保存按钮 */}
      <div className="flex-shrink-0 p-4 border-t border-amber-200 bg-amber-100/50">
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
            saveStatus === 'saved'
              ? 'bg-green-100 text-green-700 border border-green-300'
              : saveStatus === 'error'
              ? 'bg-red-100 text-red-600 border border-red-300'
              : 'bg-amber-600 text-white border border-amber-700 hover:bg-amber-700'
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
          ) : saveStatus === 'error' ? (
            '请完善信息'
          ) : (
            '保存设置'
          )}
        </button>
      </div>
    </div>
  );
}
