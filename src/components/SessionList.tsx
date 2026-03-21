// 会话列表组件 - 全页面进出式设计
import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Search, Trash2, Plus, MessageSquare, Download, ClipboardCheck } from 'lucide-react';
import { Session, getSessionMessages } from '../services/sessionManager';
import { ExportDialog } from './export/ExportDialog';

interface SessionListProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (session: Session) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onSearch: (keyword: string) => void;
  onBack: () => void;
  onReview?: (sessionId: string, sessionTitle: string) => void;
}

// 相对时间格式化函数
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

export function SessionList({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onSearch,
  onBack,
  onReview,
}: SessionListProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportSession, setExportSession] = useState<Session | null>(null);
  const [exportMessageCount, setExportMessageCount] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // 搜索框防抖逻辑
  const handleSearchChange = (value: string) => {
    setSearchKeyword(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      onSearch(value);
    }, 300);
  };

  // 删除确认
  const handleDelete = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingId === sessionId) {
      // 二次点击确认删除
      onDeleteSession(sessionId);
      setDeletingId(null);
    } else {
      // 首次点击，进入确认状态
      setDeletingId(sessionId);
      // 3秒后自动取消确认状态
      setTimeout(() => {
        setDeletingId((prev) => (prev === sessionId ? null : prev));
      }, 3000);
    }
  };

  // 处理导出
  const handleExport = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const messages = await getSessionMessages(session.id);
      setExportSession(session);
      setExportMessageCount(messages.length);
    } catch (error) {
      console.error('加载会话消息失败:', error);
    }
  };

  // 关闭导出对话框
  const handleCloseExport = () => {
    setExportSession(null);
    setExportMessageCount(0);
  };

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
            onClick={onBack}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-200/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700" />
          </button>
          <span className="text-xs font-medium text-amber-800 tracking-wide">会话历史</span>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="flex-shrink-0 p-3 border-b border-amber-200 bg-amber-100/30">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜索会话..."
            className="w-full pl-9 pr-3 py-2 bg-white/80 border border-amber-300 rounded-lg text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
          />
        </div>
      </div>

      {/* 会话列表 - 可滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-3 space-y-2">
        {sessions.length === 0 ? (
          // 空状态提示
          <div className="flex flex-col items-center justify-center h-full text-amber-500">
            <MessageSquare className="w-12 h-12 mb-3 opacity-40" />
            <span className="text-sm">暂无会话历史</span>
            <span className="text-xs mt-1 text-amber-400">点击下方按钮开始新对话</span>
          </div>
        ) : (
          // 会话卡片列表
          sessions.map((session) => {
            const isActive = session.id === currentSessionId;
            const isDeleting = deletingId === session.id;
            
            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session)}
                className={`relative group p-3 rounded-xl border cursor-pointer transition-all duration-150 overflow-visible ${
                  isActive
                    ? 'bg-amber-200/80 border-amber-400 shadow-sm'
                    : 'bg-amber-100/50 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
                }`}
              >
                {/* 标题行 */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`text-sm font-medium truncate flex-1 ${
                    isActive ? 'text-amber-900' : 'text-amber-800'
                  }`}>
                    {session.title || '新会话'}
                  </h3>
                  <span className="text-[10px] text-amber-500 whitespace-nowrap flex-shrink-0">
                    {formatRelativeTime(session.updated_at)}
                  </span>
                </div>
                
                {/* 消息预览 */}
                {session.preview && (
                  <p className="mt-1.5 text-xs text-amber-600 truncate leading-relaxed">
                    {session.preview.slice(0, 50)}
                  </p>
                )}

                {/* 复盘评分标签 */}
                {session.review_status === 'completed' && session.overall_score != null && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReview?.(session.id, session.title || '会话');
                    }}
                    className={`absolute left-3 bottom-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      session.overall_score >= 80 ? 'bg-green-100 text-green-700 border border-green-200' :
                      session.overall_score >= 60 ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                      'bg-red-100 text-red-600 border border-red-200'
                    }`}
                    title="查看复盘报告"
                  >
                    {session.overall_score}分
                  </button>
                )}

                {/* 操作按钮组 */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {/* 复盘按钮 - 未复盘时显示 */}
                  {session.review_status !== 'completed' && onReview && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onReview(session.id, session.title || '会话');
                      }}
                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-200/80 text-amber-600 border border-amber-300 opacity-0 group-hover:opacity-100 transition-all duration-150 hover:bg-amber-500 hover:text-white hover:border-amber-500"
                      title="复盘"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* 导出按钮 */}
                  <button
                    onClick={(e) => handleExport(session, e)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-200/80 text-amber-600 border border-amber-300 opacity-0 group-hover:opacity-100 transition-all duration-150 hover:bg-amber-300 hover:text-amber-800"
                    title="导出会话"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDelete(session.id, e)}
                    className={`flex items-center justify-center w-7 h-7 rounded-lg border transition-all duration-150 ${
                      isDeleting
                        ? 'bg-red-100 text-red-500 border-red-300 opacity-100'
                        : 'bg-amber-200/80 text-amber-600 border-amber-300 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 hover:border-red-300'
                    }`}
                    title={isDeleting ? '再次点击确认删除' : '删除会话'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部新建会话按钮 */}
      <div className="flex-shrink-0 p-3 border-t border-amber-200 bg-amber-100/50">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors duration-150 border border-amber-700"
        >
          <Plus className="w-4 h-4" />
          <span>新建会话</span>
        </button>
      </div>

      {/* 导出对话框 */}
      {exportSession && (
        <ExportDialog
          isOpen={!!exportSession}
          onClose={handleCloseExport}
          session={exportSession}
          messageCount={exportMessageCount}
        />
      )}
    </div>
  );
}

export default SessionList;
