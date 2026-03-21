import { useState, useCallback } from 'react';
import { X, FileText, FileJson, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { ExportFormat, ExportOptions } from '../../types/export';
import { exportService } from '../../services/export/exportService';
import { Session } from '../../services/sessionManager';
import { MessageSelector } from './MessageSelector';
import { getSessionMessages, SessionMessage } from '../../services/sessionManager';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session;
  messageCount: number;
}

const formatOptions: { value: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'markdown', label: 'Markdown', icon: <FileText className="w-4 h-4" />, desc: '适合编辑和二次加工' },
  { value: 'pdf', label: 'PDF', icon: <Printer className="w-4 h-4" />, desc: '适合打印和分享' },
  { value: 'json', label: 'JSON', icon: <FileJson className="w-4 h-4" />, desc: '完整数据，便于导入其他工具' },
];

export function ExportDialog({ isOpen, onClose, session, messageCount }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includePromptContent, setIncludePromptContent] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [imageHandling, setImageHandling] = useState<'embed' | 'extract'>('embed');
  const [exportMode, setExportMode] = useState<'all' | 'selected'>('all');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [showMessageSelector, setShowMessageSelector] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [messages, setMessages] = useState<SessionMessage[]>([]);

  // 加载消息列表
  const loadMessages = useCallback(async () => {
    try {
      const msgs = await getSessionMessages(session.id);
      setMessages(msgs);
    } catch (error) {
      console.error('加载消息失败:', error);
    }
  }, [session.id]);

  // 打开消息选择器
  const handleOpenMessageSelector = useCallback(async () => {
    await loadMessages();
    setShowMessageSelector(true);
  }, [loadMessages]);

  // 处理导出
  const handleExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    try {
      const options: Partial<ExportOptions> & { format: ExportFormat } = {
        format,
        includeMetadata,
        includePromptContent,
        includeImages,
        imageHandling,
      };

      if (exportMode === 'selected' && selectedMessageIds.length > 0) {
        options.selectedMessageIds = selectedMessageIds;
      }

      const result = await exportService.exportSession(
        session.id,
        session.title,
        options
      );

      if (result.success) {
        onClose();
      } else {
        alert(`导出失败: ${result.error}`);
      }
    } catch (error) {
      alert(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
    }
  }, [
    isExporting, format, includeMetadata, includePromptContent,
    includeImages, imageHandling, exportMode, selectedMessageIds,
    session.id, session.title, onClose
  ]);

  // 处理消息选择确认
  const handleMessageSelectConfirm = useCallback((ids: string[]) => {
    setSelectedMessageIds(ids);
    setShowMessageSelector(false);
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-amber-50 rounded-xl shadow-xl w-[480px] max-h-[90vh] flex flex-col border border-amber-200">
          {/* 标题栏 */}
          <div className="flex items-center justify-between p-4 border-b border-amber-200">
            <h3 className="text-sm font-medium text-amber-900">导出会话</h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-amber-100 rounded transition-colors"
            >
              <X className="w-4 h-4 text-amber-600" />
            </button>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 导出格式 */}
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-2">导出格式</label>
              <div className="space-y-2">
                {formatOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      format === opt.value
                        ? 'bg-amber-200/60 border-amber-400'
                        : 'bg-amber-100/30 border-amber-200 hover:bg-amber-100/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="format"
                      value={opt.value}
                      checked={format === opt.value}
                      onChange={(e) => setFormat(e.target.value as ExportFormat)}
                      className="sr-only"
                    />
                    <div className="text-amber-600">{opt.icon}</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-amber-900">{opt.label}</div>
                      <div className="text-xs text-amber-600">{opt.desc}</div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      format === opt.value ? 'border-amber-600' : 'border-amber-300'
                    }`}>
                      {format === opt.value && <div className="w-2 h-2 rounded-full bg-amber-600" />}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 导出选项 */}
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-2">导出选项</label>
              <div className="bg-amber-100/30 rounded-lg border border-amber-200 p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeMetadata}
                    onChange={(e) => setIncludeMetadata(e.target.checked)}
                    className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs text-amber-800">包含元数据头（时间、模型、面试背景等）</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePromptContent}
                    onChange={(e) => setIncludePromptContent(e.target.checked)}
                    className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs text-amber-800">包含 System Prompt 内容</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeImages}
                    onChange={(e) => setIncludeImages(e.target.checked)}
                    className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs text-amber-800">包含截图图片</span>
                </label>
              </div>
            </div>

            {/* 消息范围 */}
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-2">消息范围</label>
              <div className="bg-amber-100/30 rounded-lg border border-amber-200 p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="exportMode"
                    value="all"
                    checked={exportMode === 'all'}
                    onChange={() => setExportMode('all')}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs text-amber-800">导出全部消息 ({messageCount}条)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="exportMode"
                    value="selected"
                    checked={exportMode === 'selected'}
                    onChange={() => setExportMode('selected')}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs text-amber-800">选择性导出</span>
                </label>
                {exportMode === 'selected' && (
                  <div className="pl-5">
                    <button
                      onClick={handleOpenMessageSelector}
                      className="text-xs text-amber-600 hover:text-amber-800 underline"
                    >
                      {selectedMessageIds.length > 0
                        ? `已选择 ${selectedMessageIds.length} 条消息`
                        : '选择消息...'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 高级选项（可折叠） */}
            <div>
              <button
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800"
              >
                {showAdvancedOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                高级选项
              </button>
              {showAdvancedOptions && (
                <div className="mt-2 bg-amber-100/30 rounded-lg border border-amber-200 p-3">
                  <label className="block text-xs font-medium text-amber-800 mb-2">图片处理方式</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="imageHandling"
                        value="embed"
                        checked={imageHandling === 'embed'}
                        onChange={() => setImageHandling('embed')}
                        className="text-amber-600 focus:ring-amber-500"
                        disabled={!includeImages}
                      />
                      <span className={`text-xs ${includeImages ? 'text-amber-800' : 'text-amber-400'}`}>
                        内嵌到文档（Base64）
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="imageHandling"
                        value="extract"
                        checked={imageHandling === 'extract'}
                        onChange={() => setImageHandling('extract')}
                        className="text-amber-600 focus:ring-amber-500"
                        disabled={!includeImages}
                      />
                      <span className={`text-xs ${includeImages ? 'text-amber-800' : 'text-amber-400'}`}>
                        提取为独立文件
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 p-4 border-t border-amber-200">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || (exportMode === 'selected' && selectedMessageIds.length === 0)}
              className="px-4 py-2 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  导出中...
                </>
              ) : (
                '导出...'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 消息选择器 */}
      <MessageSelector
        messages={messages}
        isOpen={showMessageSelector}
        onClose={() => setShowMessageSelector(false)}
        onConfirm={handleMessageSelectConfirm}
      />
    </>
  );
}
