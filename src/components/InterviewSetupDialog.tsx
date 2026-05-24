import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Briefcase, FileText, Building2, Target } from 'lucide-react';

interface InterviewSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  // 新增 company 和 position 参数，用于个性化 prompt 注入
  onSubmit: (jd: string, resume: string, company: string, position: string) => void;
}

export function InterviewSetupDialog({ isOpen, onClose, onSubmit }: InterviewSetupDialogProps) {
  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [positionError, setPositionError] = useState('');
  const positionRef = useRef<HTMLInputElement>(null);

  // 打开对话框时聚焦到岗位输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => positionRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 重置表单
  useEffect(() => {
    if (isOpen) {
      setJd('');
      setResume('');
      setCompany('');
      setPosition('');
      setPositionError('');
    }
  }, [isOpen]);

  // 验证并提交，岗位必填，JD 改为可选
  const handleSubmit = useCallback(() => {
    const trimmedPosition = position.trim();
    if (!trimmedPosition) {
      setPositionError('请输入目标岗位');
      positionRef.current?.focus();
      return;
    }
    setPositionError('');
    onSubmit(jd.trim(), resume.trim(), company.trim(), trimmedPosition);
  }, [jd, resume, company, position, onSubmit]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
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
          {/* 目标公司 + 岗位 并排 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
                <Building2 className="w-3.5 h-3.5" />
                目标公司
                <span className="text-amber-400 text-[10px] ml-1">（可选）</span>
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="如：字节跳动、阿里、腾讯"
                className="w-full px-3 py-2 text-sm bg-amber-100/50 border border-amber-200 rounded-lg placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 transition-colors"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
                <Target className="w-3.5 h-3.5" />
                目标岗位
                <span className="text-red-500">*</span>
              </label>
              <input
                ref={positionRef}
                type="text"
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value);
                  if (positionError) setPositionError('');
                }}
                placeholder="如：高级后端工程师"
                className={`w-full px-3 py-2 text-sm bg-amber-100/50 border rounded-lg placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 transition-colors ${
                  positionError
                    ? 'border-red-400 focus:ring-red-300'
                    : 'border-amber-200 focus:ring-amber-300 focus:border-amber-300'
                }`}
              />
              {positionError && (
                <p className="mt-1 text-xs text-red-500">{positionError}</p>
              )}
            </div>
          </div>

          {/* 岗位 JD（改为可选） */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
              <FileText className="w-3.5 h-3.5" />
              岗位 JD
              <span className="text-amber-400 text-[10px] ml-1">（可选，建议填写）</span>
            </label>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="请粘贴完整的岗位描述（Job Description）..."
              rows={5}
              className="w-full px-3 py-2 text-sm bg-amber-100/50 border border-amber-200 rounded-lg resize-none placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 transition-colors"
            />
          </div>

          {/* 个人简历 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
              <FileText className="w-3.5 h-3.5" />
              个人简历
              <span className="text-amber-400 text-[10px] ml-1">（可选，强烈建议填写）</span>
            </label>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="请粘贴你的简历内容（文字版）..."
              rows={6}
              className="w-full px-3 py-2 text-sm bg-amber-100/50 border border-amber-200 rounded-lg resize-none placeholder:text-amber-400 text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 transition-colors"
            />
          </div>

          {/* 提示文字 */}
          <div className="text-xs text-amber-600/80 bg-amber-100/30 rounded-lg p-3">
            <p>
              <span className="font-medium">提示：</span>
              填写目标公司、岗位和简历后，AI 将根据你的背景给出个性化回答，
              并结合项目经历深入追问。岗位名称为必填。
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
