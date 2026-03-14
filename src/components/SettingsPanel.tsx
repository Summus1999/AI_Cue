// 设置面板组件 - 全页面进出式设计
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, ChevronDown, Check, AlertCircle, FolderOpen } from 'lucide-react';
import { loadConfig, saveConfig, QWEN_MODELS, NLS_REGIONS, PROMPT_TEMPLATES, AppConfig, DEFAULT_CONFIG, validateConfig } from '../store/config';

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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
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

  // 获取当前选中模型的描述
  const selectedModel = QWEN_MODELS.find(m => m.id === config.model);

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
            {/* API Key 设置（必填） */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                API Key <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) => {
                  setConfig(prev => ({ ...prev, apiKey: e.target.value }));
                  if (errorMessage) setErrorMessage('');
                }}
                placeholder="输入阿里云 DashScope API Key"
                className={`w-full px-3 py-2.5 bg-white/80 border rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors ${
                  saveStatus === 'error' && !config.apiKey 
                    ? 'border-red-400' 
                    : 'border-amber-300'
                }`}
              />
              <p className="text-[10px] text-amber-600">
                必填，请从阿里云 DashScope 控制台获取
              </p>
            </div>

            {/* 模型版本选择 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                千问模型 <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <button
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 hover:border-amber-400 transition-colors"
                >
                  <span>{selectedModel?.name || config.model}</span>
                  <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Model 下拉菜单 */}
                {isModelDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border border-amber-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto scrollbar-hide">
                    {QWEN_MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setConfig(prev => ({ ...prev, model: model.id }));
                          setIsModelDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                          config.model === model.id 
                            ? 'bg-amber-100 text-amber-900' 
                            : 'text-amber-800 hover:bg-amber-50'
                        }`}
                      >
                        {config.model === model.id && <Check className="w-4 h-4 text-amber-600" />}
                        <span className={config.model === model.id ? '' : 'pl-6'}>{model.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* 模型描述 */}
              {selectedModel && (
                <p className="text-xs text-amber-600 leading-relaxed">
                  {selectedModel.description}
                </p>
              )}
            </div>

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
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* 模板描述 */}
              {config.promptTemplateId !== 'custom' && (
                <p className="text-xs text-amber-600 leading-relaxed">
                  {PROMPT_TEMPLATES.find(t => t.id === config.promptTemplateId)?.description}
                </p>
              )}
              
              {/* 自定义 Prompt 输入框 */}
              {config.promptTemplateId === 'custom' && (
                <div className="space-y-2">
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
