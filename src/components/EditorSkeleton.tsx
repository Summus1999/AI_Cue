/**
 * 编辑器骨架屏组件
 * 模拟代码行的加载状态
 */

import { useMemo } from 'react';

export function EditorSkeleton() {
  // 使用 useMemo 固定随机宽度，避免每次渲染闪烁
  const lineWidths = useMemo(
    () => Array.from({ length: 12 }, () => 30 + Math.random() * 50),
    []
  );

  return (
    <div className="flex flex-col h-full bg-stone-50 p-3 animate-pulse">
      {/* 模拟代码行 */}
      {lineWidths.map((width, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          {/* 行号 */}
          <div className="w-6 h-4 bg-stone-200 rounded" />
          {/* 代码内容 */}
          <div
            className="h-4 bg-stone-200 rounded"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </div>
  );
}
