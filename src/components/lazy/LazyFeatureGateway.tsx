/**
 * 懒加载特性网关
 * 
 * 统一管理非核心面板的按需加载，提供统一的懒加载接口和 fallback 展示。
 * 使用 React.lazy + Suspense 实现，支持首屏不加载这些模块。
 */

import React, { lazy } from 'react';

// Fallback 加载态
interface LoadingFallbackProps {
  message?: string;
}

export function LoadingFallback({ message = '加载中...' }: LoadingFallbackProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-amber-600/60 text-sm animate-pulse">
        {message}
      </div>
    </div>
  );
}

// 懒加载的面板组件
export const LazySettingsPanel = lazy(() => 
  import('../SettingsPanel').then(module => ({ default: module.SettingsPanel }))
);

export const LazyShortcutSettingsPanel = lazy(() => 
  import('../ShortcutSettingsPanel').then(module => ({ default: module.ShortcutSettingsPanel }))
);

export const LazySessionList = lazy(() => 
  import('../SessionList').then(module => ({ default: module.default }))
);

export const LazyExportDialog = lazy(() => 
  import('../export/ExportDialog').then(module => ({ default: module.ExportDialog }))
);

export const LazyReviewDialog = lazy(() => 
  import('../review/ReviewDialog').then(module => ({ default: module.ReviewDialog }))
);

export const LazyCodeEditorPanel = lazy(() => 
  import('../CodeEditorPanel').then(module => ({ default: module.CodeEditorPanel }))
);

// 预加载函数
const preloadCache = new Set<string>();

export function preloadPanel(panel: 'settings' | 'shortcuts' | 'sessions' | 'export' | 'review' | 'codeEditor'): void {
  if (preloadCache.has(panel)) return;
  preloadCache.add(panel);
  
  switch (panel) {
    case 'settings':
      import('../SettingsPanel');
      break;
    case 'shortcuts':
      import('../ShortcutSettingsPanel');
      break;
    case 'sessions':
      import('../SessionList');
      break;
    case 'export':
      import('../export/ExportDialog');
      break;
    case 'review':
      import('../review/ReviewDialog');
      break;
    case 'codeEditor':
      import('../CodeEditorPanel');
      break;
  }
}

// 面板类型
export type PanelType = 'settings' | 'shortcuts' | 'sessions' | 'export' | 'review' | 'codeEditor';

// 鼠标悬停时预加载 hook
export function usePanelPreloader(panel: PanelType | null, hoverTime: number = 500): void {
  React.useEffect(() => {
    if (!panel) return;
    
    const timer = setTimeout(() => {
      preloadPanel(panel);
    }, hoverTime);
    
    return () => clearTimeout(timer);
  }, [panel, hoverTime]);
}

