import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Briefcase, FileText } from 'lucide-react';

interface InterviewSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (jd: string, resume: string) => void;
}

export function InterviewSetupDialog({ isOpen, onClose, onSubmit }: InterviewSetupDialogProps) {
  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [jdError, setJdError] = useState('');
  const jdRef = useRef<HTMLTextAreaElement>(null);

  // 打开对话框时聚焦到 JD 输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => jdRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 重置表单
  useEffect(() => {
    if (isOpen) {
      setJd('');
      setResume('');
      setJdError('');
    }
  }, [isOpen]);

  // 验证并提交
  const handleSubmit = useCallback(() => {
    const trimmedJd = jd.trim();
    if (!trimmedJd) {
      setJdError('请输入岗位 JD');
      jdRef.current?.focus();
      return;
    }
    setJdError('');
    onSubmit(trimmedJd, resume.trim());
  }, [jd, resume, onSubmit]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Enter 快捷提交
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
    // Escape 关闭
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleSubmit, onClose]);

  // 点击遮罩层关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-amber-50 rounded-xl shadow-xl w-[560px] max-h-[90vh] flex flex-col border border-amber-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-amber-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-medium text-amber-900">面试设置</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-amber-100 rounded transition-colors"
          >
            <X className="w-4 h-4 text-amber-600" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 岗位 JD */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
              <FileText className="w-3.5 h-3.5" />
              岗位 JD
              <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={jdRef}
              value={jd}
              onChange={(e) => {
                setJd(e.target.value);
                if (jdError) setJdError('');
              }}
              placeholder="请粘贴完整的岗位描述（Job Description）..."
              rows={6}
              className={`w-full px-3 py-2 text-sm bg-amber-100/50 border rounded-lg resize-none placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 transition-colors ${
                jdError 
                  ? 'border-red-400 focus:ring-red-300' 
                  : 'border-amber-200 focus:ring-amber-300 focus:border-amber-300'
              }`}
            />
            {jdError && (
              <p className="mt-1 text-xs text-red-500">{jdError}</p>
            )}
          </div>

          {/* 个人简历 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
              <FileText className="w-3.5 h-3.5" />
              个人简历
              <span className="text-amber-400 text-[10px] ml-1">（可选）</span>
            </label>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="请粘贴你的简历内容（文字版）..."
              rows={8}
              className="w-full px-3 py-2 text-sm bg-amber-100/50 border border-amber-200 rounded-lg resize-none placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 transition-colors"
            />
          </div>

          {/* 提示文字 */}
          <div className="text-xs text-amber-600/80 bg-amber-100/30 rounded-lg p-3">
            <p>
              <span className="font-medium">提示：</span>
              填写完整的 JD 和简历后，AI 面试官将根据岗位要求针对性地进行提问，
              并结合你的项目经历深入追问。
            </p>
            <p className="mt-1 text-amber-500">
              快捷键：Ctrl+Enter 开始面试，Esc 关闭
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-amber-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5"
          >
            <Briefcase className="w-3.5 h-3.5" />
            开始面试
          </button>
        </div>
      </div>
    </div>
  );
}
