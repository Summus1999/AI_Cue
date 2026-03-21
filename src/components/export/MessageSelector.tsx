import { useState, useCallback } from 'react';
import { X, CheckSquare, Square } from 'lucide-react';
import { SessionMessage } from '../../services/sessionManager';

interface MessageSelectorProps {
  messages: SessionMessage[];
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedIds: string[]) => void;
}

export function MessageSelector({ messages, isOpen, onClose, onConfirm }: MessageSelectorProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // 生成消息 ID（如果没有）
  const getMessageId = (msg: SessionMessage, index: number): string => {
    return msg.id || `${msg.session_id}_${index}_${msg.created_at}`;
  };

  // 切换选中状态
  const toggleSelection = useCallback((id: string, isShiftClick: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      
      if (isShiftClick && lastClickedId) {
        // 范围选择
        const ids = messages.map((m, i) => getMessageId(m, i));
        const startIdx = ids.indexOf(lastClickedId);
        const endIdx = ids.indexOf(id);
        
        if (startIdx !== -1 && endIdx !== -1) {
          const min = Math.min(startIdx, endIdx);
          const max = Math.max(startIdx, endIdx);
          for (let i = min; i <= max; i++) {
            newSet.add(ids[i]);
          }
        }
      } else {
        // 普通切换
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        setLastClickedId(id);
      }
      
      return newSet;
    });
  }, [lastClickedId, messages]);

  // 全选
  const selectAll = useCallback(() => {
    const allIds = messages.map((m, i) => getMessageId(m, i));
    setSelectedIds(new Set(allIds));
  }, [messages]);

  // 取消全选
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // 确认选择
  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selectedIds));
  }, [selectedIds, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
      <div className="bg-amber-50 rounded-xl shadow-xl w-[500px] max-h-[80vh] flex flex-col border border-amber-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-amber-200">
          <h3 className="text-sm font-medium text-amber-900">选择要导出的消息</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-amber-100 rounded transition-colors"
          >
            <X className="w-4 h-4 text-amber-600" />
          </button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200 bg-amber-100/30">
          <button
            onClick={selectAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 rounded transition-colors"
          >
            <CheckSquare className="w-3 h-3" />
            全选
          </button>
          <button
            onClick={deselectAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 rounded transition-colors"
          >
            <Square className="w-3 h-3" />
            取消全选
          </button>
          <span className="ml-auto text-xs text-amber-600">
            已选择 {selectedIds.size}/{messages.length} 条
          </span>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.map((msg, index) => {
            const id = getMessageId(msg, index);
            const isSelected = selectedIds.has(id);
            const roleLabel = msg.role === 'user' ? '用户' : 'AI';
            const timeStr = msg.created_at 
              ? new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              : '';
            
            return (
              <div
                key={id}
                onClick={(e) => toggleSelection(id, e.shiftKey)}
                className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-amber-200/60' : 'bg-amber-100/30 hover:bg-amber-100/60'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                  isSelected ? 'bg-amber-600 border-amber-600' : 'border-amber-400'
                }`}>
                  {isSelected && <CheckSquare className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-amber-600 mb-1">
                    <span className={`px-1.5 py-0.5 rounded ${
                      msg.role === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {roleLabel}
                    </span>
                    {timeStr && <span>{timeStr}</span>}
                  </div>
                  <p className="text-xs text-amber-800 truncate">
                    {msg.content.slice(0, 100)}{msg.content.length > 100 ? '...' : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-amber-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="px-4 py-2 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            确认 ({selectedIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}
