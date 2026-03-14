import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Check, X } from 'lucide-react';

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface ScreenshotSelectorProps {
  sourcePath: string;
  logicalWidth: number;
  logicalHeight: number;
  physicalWidth: number;
  physicalHeight: number;
}

interface CropScreenshotResult {
  image_data: number[];
  debug_path: string;
}

const MIN_SELECTION_SIZE = 80;

export function ScreenshotSelector({
  sourcePath,
  logicalWidth,
  logicalHeight,
  physicalWidth,
  physicalHeight,
}: ScreenshotSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSelectionComplete, setIsSelectionComplete] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const [renderSize, setRenderSize] = useState({
    width: logicalWidth,
    height: logicalHeight,
  });

  const imageUrl = useMemo(() => convertFileSrc(sourcePath), [sourcePath]);

  const getNormalizedSelection = useCallback(() => {
    if (!selection) return null;
    return {
      x: Math.min(selection.startX, selection.endX),
      y: Math.min(selection.startY, selection.endY),
      width: Math.abs(selection.endX - selection.startX),
      height: Math.abs(selection.endY - selection.startY),
    };
  }, [selection]);

  const getPhysicalSelection = useCallback(() => {
    const normalized = getNormalizedSelection();
    if (!normalized || renderSize.width <= 0 || renderSize.height <= 0) {
      return null;
    }

    const scaleX = physicalWidth / renderSize.width;
    const scaleY = physicalHeight / renderSize.height;
    return {
      x: Math.round(normalized.x * scaleX),
      y: Math.round(normalized.y * scaleY),
      width: Math.round(normalized.width * scaleX),
      height: Math.round(normalized.height * scaleY),
    };
  }, [getNormalizedSelection, physicalHeight, physicalWidth, renderSize.height, renderSize.width]);

  const cancelAndClose = useCallback(async () => {
    try {
      await emit('screenshot-cancelled', {});
    } finally {
      try {
        await invoke('cancel_screenshot', { sourcePath });
      } catch {
        // Ignore cleanup failures.
      }
      const win = getCurrentWindow();
      await win.close();
    }
  }, [sourcePath]);

  const handleConfirm = useCallback(async () => {
    const physicalSelection = getPhysicalSelection();
    if (!physicalSelection) {
      return;
    }

    try {
      const result = await invoke<CropScreenshotResult>('crop_screenshot', {
        sourcePath,
        x: physicalSelection.x,
        y: physicalSelection.y,
        width: physicalSelection.width,
        height: physicalSelection.height,
      });

      await emit('screenshot-complete', {
        imageData: result.image_data,
        debugPath: result.debug_path,
      });

      const win = getCurrentWindow();
      await win.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSelectionError(message);
      setSelection(null);
      setIsSelectionComplete(false);
    }
  }, [getPhysicalSelection, sourcePath]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.button !== 0 || isSelectionComplete) return;

    setSelectionError('');
    setIsDragging(true);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selection || isSelectionComplete) return;
    setSelection({
      ...selection,
      endX: e.clientX,
      endY: e.clientY,
    });
  };

  const handleMouseUp = () => {
    if (!selection || isSelectionComplete) return;
    setIsDragging(false);

    const normalized = getNormalizedSelection();
    const physicalSelection = getPhysicalSelection();
    if (!normalized || !physicalSelection || normalized.width < 2 || normalized.height < 2) {
      setSelection(null);
      return;
    }

    if (
      physicalSelection.width < MIN_SELECTION_SIZE ||
      physicalSelection.height < MIN_SELECTION_SIZE
    ) {
      setSelectionError(`选区太小，请至少选择 ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE} 像素的区域`);
      setSelection(null);
      return;
    }

    setIsSelectionComplete(true);
  };

  useEffect(() => {
    const updateRenderSize = () => {
      if (!containerRef.current) {
        return;
      }
      setRenderSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };

    updateRenderSize();
    window.addEventListener('resize', updateRenderSize);
    return () => window.removeEventListener('resize', updateRenderSize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelAndClose();
      } else if (e.key === 'Enter' && isSelectionComplete) {
        e.preventDefault();
        handleConfirm();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSelectionComplete, cancelAndClose, handleConfirm]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    cancelAndClose();
  };

  const renderSelection = () => {
    const normalized = getNormalizedSelection();
    if (!normalized || (normalized.width < 2 && normalized.height < 2)) return null;

    const { x, y, width, height } = normalized;

    return (
      <>
        {/* 选区高亮框 */}
        <div
          className="absolute border-2 border-green-400"
          style={{
            left: x,
            top: y,
            width,
            height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />
        
        {/* 尺寸提示 */}
        <div
          className="absolute bg-black/80 text-white text-xs px-2 py-1 rounded"
          style={{
            left: x,
            top: Math.max(0, y - 28),
            pointerEvents: 'none',
          }}
        >
          {Math.round(width)} x {Math.round(height)}
        </div>

        {/* 四角标记 */}
        <div className="absolute w-2 h-2 bg-green-400" style={{ left: x - 3, top: y - 3, pointerEvents: 'none' }} />
        <div className="absolute w-2 h-2 bg-green-400" style={{ left: x + width - 5, top: y - 3, pointerEvents: 'none' }} />
        <div className="absolute w-2 h-2 bg-green-400" style={{ left: x - 3, top: y + height - 5, pointerEvents: 'none' }} />
        <div className="absolute w-2 h-2 bg-green-400" style={{ left: x + width - 5, top: y + height - 5, pointerEvents: 'none' }} />

        {/* 确认/取消工具栏 - 只在选区完成后显示 */}
        {isSelectionComplete && (
          <div
            className="absolute flex items-center gap-2 bg-gray-900 rounded-lg p-1.5 shadow-xl border border-gray-700"
            style={{
              left: Math.max(8, Math.min(x + width - 86, window.innerWidth - 96)),
              top: Math.min(y + height + 10, window.innerHeight - 60),
              zIndex: 9999,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cancelAndClose();
              }}
              className="flex items-center justify-center w-10 h-10 rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
              title="取消 (ESC)"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleConfirm();
              }}
              className="flex items-center justify-center w-10 h-10 rounded-md bg-green-600 hover:bg-green-500 text-white transition-colors cursor-pointer"
              title="确认 (Enter)"
            >
              <Check className="w-5 h-5" />
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 select-none overflow-hidden ${isSelectionComplete ? 'cursor-default' : 'cursor-crosshair'}`}
      style={{ background: '#000' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      <img
        src={imageUrl}
        alt="screenshot"
        className="absolute inset-0 w-full h-full"
        onLoad={() => {
          setImageLoaded(true);
          setLoadError(false);
        }}
        onError={() => {
          setLoadError(true);
        }}
        draggable={false}
      />
      {!selection && imageLoaded && <div className="absolute inset-0 bg-black/50 pointer-events-none" />}
      {renderSelection()}

      {/* 操作提示 */}
      <div 
        className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-sm px-4 py-2 rounded-lg shadow-lg"
        style={{ pointerEvents: 'none', zIndex: 9998 }}
      >
        {isSelectionComplete 
          ? '点击绿色按钮确认 · Enter确认 · ESC取消'
          : '拖拽选择主屏区域 · ESC取消'
        }
      </div>

      {selectionError && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 bg-red-600/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg"
          style={{ zIndex: 9999 }}
        >
          {selectionError}
        </div>
      )}

      {!imageLoaded && !loadError && (
        <div className="fixed inset-0 flex items-center justify-center bg-black" style={{ zIndex: 9999 }}>
          <div className="text-white text-lg">加载截图中...</div>
        </div>
      )}

      {loadError && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black" style={{ zIndex: 9999 }}>
          <div className="text-white text-lg mb-4">截图加载失败</div>
          <button 
            type="button"
            onClick={cancelAndClose}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer"
          >
            关闭 (ESC)
          </button>
        </div>
      )}

    </div>
  );
}

export default ScreenshotSelector;
