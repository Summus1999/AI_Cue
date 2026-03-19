// Provider 选择器组件 - 支持多 AI Provider 切换和配置
import { useState } from 'react';
import { ChevronDown, Check, Plug, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import type { ProviderType, ProviderConfig } from '../store/config';
import { PROVIDERS, PROVIDER_MODELS } from '../store/config';
import { testProviderConnection } from '../services/providerRegistry';

interface ProviderSelectorProps {
  activeProvider: ProviderType;
  providerConfig: ProviderConfig;
  onProviderChange: (provider: ProviderType) => void;
  onConfigChange: (config: ProviderConfig) => void;
}

export function ProviderSelector({
  activeProvider,
  providerConfig,
  onProviderChange,
  onConfigChange,
}: ProviderSelectorProps) {
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  const currentProvider = PROVIDERS.find(p => p.id === activeProvider);
  const availableModels = PROVIDER_MODELS[activeProvider] || [];
  const selectedModel = availableModels.find(m => m.id === providerConfig.model);

  const handleTestConnection = async () => {
    if (!providerConfig.apiKey?.trim()) {
      setTestResult({ success: false, message: '请先输入 API Key' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    
    const result = await testProviderConnection(activeProvider, providerConfig);
    
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      {/* Provider 选择 */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
          AI 模型提供商
        </label>
        <div className="relative">
          <button
            onClick={() => setIsProviderDropdownOpen(!isProviderDropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 hover:border-amber-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{currentProvider?.name}</span>
              <span className="text-xs text-amber-500">{currentProvider?.description}</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isProviderDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isProviderDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border border-amber-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => {
                    onProviderChange(provider.id);
                    setIsProviderDropdownOpen(false);
                    setTestResult(null);
                  }}
                  className={`w-full px-3 py-2.5 text-left transition-colors flex flex-col gap-0.5 ${
                    activeProvider === provider.id
                      ? 'bg-amber-100 text-amber-900'
                      : 'text-amber-800 hover:bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {activeProvider === provider.id && <Check className="w-4 h-4 text-amber-600" />}
                    <span className={activeProvider === provider.id ? 'font-medium' : 'pl-6'}>
                      {provider.name}
                    </span>
                  </div>
                  <span className={`text-xs ${activeProvider === provider.id ? 'text-amber-600' : 'text-amber-500'} ${activeProvider === provider.id ? '' : 'pl-6'}`}>
                    {provider.description}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 动态配置区 */}
      <div className="space-y-3 p-3 bg-amber-100/30 border border-amber-200 rounded-lg">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-amber-700">
            API Key <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={providerConfig.apiKey}
              onChange={(e) => onConfigChange({ ...providerConfig, apiKey: e.target.value })}
              placeholder={`输入 ${currentProvider?.name} 的 API Key`}
              className="w-full px-3 py-2 pr-10 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-amber-500 hover:text-amber-700 transition-colors"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Base URL（可选） */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-amber-700">
            Base URL <span className="text-amber-500 font-normal">(可选)</span>
          </label>
          <input
            type="text"
            value={providerConfig.baseUrl || ''}
            onChange={(e) => onConfigChange({ ...providerConfig, baseUrl: e.target.value })}
            placeholder={currentProvider?.defaultBaseUrl}
            className="w-full px-3 py-2 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
          />
          <p className="text-[10px] text-amber-500">
            留空使用默认地址，支持自定义私有化部署地址
          </p>
        </div>

        {/* 模型选择 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-amber-700">
            模型 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 hover:border-amber-400 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span>{selectedModel?.name || providerConfig.model}</span>
                {selectedModel && (
                  <span className="text-xs text-amber-500">{selectedModel.description}</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isModelDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border border-amber-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto scrollbar-hide">
                {availableModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onConfigChange({ ...providerConfig, model: model.id });
                      setIsModelDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left transition-colors flex flex-col gap-0.5 ${
                      providerConfig.model === model.id
                        ? 'bg-amber-100 text-amber-900'
                        : 'text-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {providerConfig.model === model.id && <Check className="w-4 h-4 text-amber-600" />}
                      <span className={providerConfig.model === model.id ? 'font-medium' : 'pl-6'}>
                        {model.name}
                      </span>
                    </div>
                    <span className={`text-xs ${providerConfig.model === model.id ? 'text-amber-600' : 'text-amber-500'} ${providerConfig.model === model.id ? '' : 'pl-6'}`}>
                      {model.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 连通性测试 */}
        <div className="pt-2 space-y-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !providerConfig.apiKey?.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-amber-200/80 hover:bg-amber-300/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-amber-800 transition-colors"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                测试中...
              </>
            ) : (
              <>
                <Plug className="w-4 h-4" />
                测试连接
              </>
            )}
          </button>

          {testResult && (
            <div className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${
              testResult.success
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-red-100 text-red-700 border border-red-200'
            }`}>
              {testResult.success ? (
                <Plug className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
